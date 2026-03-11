# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

WhatsApp 订单自动化处理系统：通过 WhatsApp 收集用户注册信息和消费收据，OCR 识别收据后验证资格，写入 Excel。

## 常用命令

### 安装依赖（首次）
```bash
# Python 环境
cd ocr-service && python -m venv .venv
source ocr-service/.venv/bin/activate
pip install -r ocr-service/requirements.txt

# Node.js 环境
cd wa-bot && npm install
```

### 启动服务（顺序重要：先 OCR 后 Bot）
```bash
# 终端 1 — OCR 服务（等看到"EasyOCR 模型加载完成"再启动 Bot）
cd ocr-service && source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000

# 终端 2 — WhatsApp Bot（首次运行需扫码登录）
cd wa-bot && npm start

# 开发模式（自动重载）
cd wa-bot && npm run dev
```

### 生产部署（PM2）
```bash
pm2 start "uvicorn main:app --port 8000" --name ocr-service --cwd ocr-service
pm2 start index.js --name wa-bot --cwd wa-bot
pm2 save && pm2 startup
```

### 手动测试 OCR 服务
```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/data/register \
  -H "Content-Type: application/json" \
  -d '{"phone": "60123456789", "ic_number": "123456-78-9012"}'
```

### 常见运维操作
```bash
# WhatsApp session 失效时重新扫码
rm -rf wa-bot/.wwebjs_auth && pm2 restart wa-bot

# 重置所有用户会话（内存存储，重启即清空）
pm2 restart wa-bot

# 查看实时日志
tail -f logs/wa-bot.log
pm2 logs ocr-service
```

## 架构

双进程微服务，通过 HTTP REST 通信（localhost:8000）：

| 服务 | 技术 | 职责 |
|------|------|------|
| `wa-bot/` | Node.js + whatsapp-web.js | 用户对话状态机、IC 验证、图片下载 |
| `ocr-service/` | Python FastAPI + EasyOCR | 图像识别、字段提取、Excel 写入 |

**通信接口：**
- `POST /data/register` — 注册用户（检查重复 + 写 Sheet1）
- `POST /ocr/receipt` — 处理收据图片（OCR + 验证 + 写 Sheet2）
- `GET /health` — 健康检查

**数据输出：** `data/excel/records.xlsx`（Sheet1: Registrations, Sheet2: Receipts）

## 关键模块

- **`wa-bot/src/sessionManager.js`** — 核心状态机，内存 Map 存储用户会话。状态流转：`WAITING_IC → WAITING_RECEIPT → DONE`，30 分钟超时自动清理。**重启后所有会话丢失**，如需持久化需改用 Redis/SQLite。

- **`wa-bot/src/ocrClient.js`** — HTTP 客户端，带指数退避重试（最多 3 次，等待 500ms/1s/2s）。4xx 错误不重试。

- **`ocr-service/src/ocr/engine.py`** — EasyOCR 单例（双重检查锁），FastAPI 启动时预热，避免首个用户等待 5-15 秒。

- **`ocr-service/src/ocr/extractor.py`** — 字段提取：金额优先找 Total/Jumlah 附近数字，降级取最大 RM 值；品牌用 rapidfuzz `partial_ratio` 模糊匹配（阈值 85%）。

- **`ocr-service/src/excel/writer.py`** — `asyncio.Lock()` 保证并发安全，防止多请求同时读写 xlsx 导致数据覆盖。

## 配置文件（改这里，不用改代码）

- **`config/config.yaml`** — 业务规则：品牌白名单、最低消费金额（默认 RM500）、模糊匹配阈值、会话超时、每日提交上限
- **`config/messages.yaml`** — 所有对用户可见的话术，支持 `{变量}` 占位符，修改后重启生效

修改品牌白名单示例：
```yaml
eligibility:
  eligible_brands: ["Samsung", "Apple", "Dyson", "LG"]  # 直接增减
  minimum_amount: 500.00
```

## 扩展指引

**增加新的对话状态：**
1. `sessionManager.js` 的 `SESSION_STATE` 增加新状态
2. `messageHandler.js` 的 `switch` 增加新 `case`
3. 新建 `handlers/xxxHandler.js`

**增加 Excel 新列：**
1. `config/config.yaml` 的 `excel.sheets.receipts.columns` 添加列名
2. `excel/writer.py` 的 `write_receipt` 函数中 `ws.append(...)` 对应位置添加字段
