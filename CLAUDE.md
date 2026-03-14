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
# 使用 ecosystem.config.js（含 venv 激活、日志路径、崩溃重启策略）
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

### 生产部署（Docker，推荐）
```bash
docker compose up -d              # 后台启动（ocr-service 健康后才启动 wa-bot）
docker compose logs -f wa-bot     # 实时查看 bot 日志
docker compose down               # 停止并移除容器（不删 volume）
docker compose up -d --build      # 代码变更后重新构建
```
关键 volume：
- `easyocr-models`（命名卷，~400MB 模型缓存，容器重建后无需重新下载）
- `./wa-bot/.wwebjs_auth` → `/app/.wwebjs_auth`（WhatsApp 登录凭证）
- `./config` → `/app/config:ro`（业务配置，只读挂载）
- `./data` → `/app/data`（Excel + 收据图片）

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

# Docker 环境等效命令
docker restart wa-bot                                  # 重置会话
docker exec wa-bot rm -rf /app/.wwebjs_auth && docker restart wa-bot  # 重新扫码
docker compose logs -f                                 # 查看全部日志
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

**数据输出：**
- `data/excel/records.xlsx`（Sheet1: Registrations, Sheet2: Receipts）
- `data/uploads/` — 收据图片存档

**环境变量：**
- `OCR_SERVICE_URL` — wa-bot 连接 OCR 服务的地址。Docker 部署由 compose 注入 `http://ocr-service:8000`，本地开发默认读 `config.yaml` 中的 `services.ocr_service_url`（`http://localhost:8000`）

**AWS 部署：** 详见 `deploy/README.md`
- CloudFormation 一键部署（`deploy/cloudformation.yaml`），EC2 启动时自动拉代码、构建镜像、启动服务
- 最低配置 t3.medium（~$34/月），推荐 t3.large（~$67/月）
- SSM Session Manager 管理（无需 SSH key / 22 端口）
- **数据卷 `DeletionPolicy: Retain`**：Stack 删除后 EBS 仍保留并持续计费，需手动清理

## 运行时行为

本章节记录跨文件的隐式行为契约，修改相关逻辑前必读。

### Bot 启动流程（`index.js`）

- 启动时主动探测 OCR 服务（`healthCheck()`），不可用时记录警告但**继续启动**（Bot 消息功能正常，OCR 收据功能降级）
- 每 60 秒心跳检测 OCR 服务（仅写日志，不中断服务，不影响用户会话）
- `uncaughtException` 触发后调用 `process.exit(1)`，依赖 PM2 的自动重启机制恢复；`unhandledRejection` 只记录日志，不退出

### WhatsApp 断线重连（`bot.js`）

- 最多重连 5 次（`MAX_RECONNECT_ATTEMPTS = 5`），每次延迟 `5000ms * 2^attempt`（即 5s → 10s → 20s → 40s → 80s）
- `isReconnecting` 标志防止 `disconnected` 事件重复触发导致并发重连
- 达到重连上限后调用 `process.exit(1)`，由 PM2 重启

### 会话重置关键词（`messageHandler.js`）

- 触发词：`['重新注册', '重新开始', 'restart', 'reset', 'start']`（`includes` 匹配，不区分大小写）
- **仅在 `WAITING_RECEIPT` 状态有效**；`DONE` 状态未处理重置（见下方已知 bug）
- 重置效果：`state → WAITING_IC`，`ic → null`，**`receiptCount` 不清空**（今日计数保留）

### 每日收据上限逻辑（`receiptHandler.js`）

- 双重检查：**提交前**检查上限（超限直接拒绝）→ OCR 处理 → **提交后再次检查**（刚好达上限则 `state → DONE`）
- 上限计数存在 session 的 `receiptCount` 字段，跨天自动重置（不需重启）
- `DONE` 状态用户当前**无法**通过关键词重新开始（见下方已知 bug）

### OCR 资格验证流程（`main.py` `_check_eligibility`）

四步验证，顺序执行，首个不通过即返回：
1. **置信度** — 低于 `ocr.confidence_threshold`（默认 0.5）则不合格
2. **品牌匹配** — `matched_brand` 为 None（rapidfuzz 未命中白名单）则不合格
3. **金额识别** — `amount` 为 None（无法从文本提取数字）则不合格
4. **金额门槛** — 金额 < `eligibility.minimum_amount`（默认 RM500）则不合格

验证失败**不抛异常**，返回 `qualified=False` + `disqualify_reason` 字符串，结果仍写入 Excel（Sheet2）供人工复核。

### ⚠ 已知 Bug

- **DONE 状态无法重置**：`messageHandler.js` 的 `DONE` case 回复了提示语，但未执行状态重置逻辑。用户达到每日上限后，当天无法通过重置关键词重新开始。需在 `DONE` case 中添加与 `WAITING_RECEIPT` 相同的重置检测逻辑。

## 关键模块

- **`wa-bot/src/sessionManager.js`** — 核心状态机，内存 Map 存储用户会话。状态流转：`WAITING_IC → WAITING_RECEIPT → DONE`。
  - Session 完整结构：`{ phone, ic, state, createdAt, updatedAt, receiptCount, receiptCountDate }`
  - `receiptCountDate`（格式 `YYYY-MM-DD`）用于跨天自动重置计数，无需重启
  - 清理任务每 10 分钟运行一次，TTL 读自 `config.bot.session_timeout_minutes`
  - **重启后所有会话丢失**，如需持久化需改用 Redis/SQLite

- **`wa-bot/src/ocrClient.js`** — HTTP 客户端，带指数退避重试。
  - 重试次数由 `config.bot.ocr_max_retries` 控制
  - 等待公式：`min(500ms * 2^attempt, 8000ms)`（首次失败等 500ms，上限 8s）
  - HTTP 4xx 错误不重试（`err.response.status < 500` 直接抛出）

- **`ocr-service/src/ocr/engine.py`** — EasyOCR 单例（双重检查锁），FastAPI 启动时预热，避免首个用户等待 5-15 秒。

- **`ocr-service/src/ocr/extractor.py`** — 字段提取：金额优先找 Total/Jumlah 附近数字，降级取最大 RM 值；品牌用 rapidfuzz `partial_ratio` 模糊匹配（阈值 85%）。

- **`ocr-service/src/excel/writer.py`** — `asyncio.Lock()` 保证并发安全，防止多请求同时读写 xlsx 导致数据覆盖。

## 配置文件（改这里，不用改代码）

两个配置文件均为**懒加载单例**（各模块首次调用时读取并缓存），**修改后必须重启**才能生效。

- **`config/config.yaml`** — 业务规则：品牌白名单、最低消费金额（默认 RM500）、模糊匹配阈值、会话超时、每日提交上限
  - `ocr.confidence_threshold: 0.5` — 低于此置信度的 OCR 文字块被丢弃，影响识别精度
- **`config/messages.yaml`** — 所有对用户可见的话术，支持 `{变量}` 占位符，修改后重启生效

修改品牌白名单示例：
```yaml
eligibility:
  eligible_brands: ["Samsung", "Apple", "Dyson", "LG"]  # 直接增减
  minimum_amount: 500.00
```

**⚠ 配置加载耦合警告：** Node.js 侧存在 6 个独立的配置加载函数（各自硬编码路径）：
- `_getConfig()`：`ocrClient.js`、`receiptHandler.js`、`sessionManager.js`（3 处）
- `_getMessages()`：`messageHandler.js`、`receiptHandler.js`、`registrationHandler.js`（3 处）

调整目录结构或配置文件名时需逐一修改。后续可考虑抽取为 `wa-bot/src/config.js` 统一加载。

## 扩展指引

**增加新的对话状态：**
1. `sessionManager.js` 的 `SESSION_STATE` 增加新状态
2. `messageHandler.js` 的 `switch` 增加新 `case`
3. 新建 `handlers/xxxHandler.js`
4. 注意：`WAITING_RECEIPT` 状态在处理图片前优先检测重置关键词，新状态若需类似逻辑需手动在 `case` 内复制该检测逻辑

**增加 Excel 新列：**
1. `config/config.yaml` 的 `excel.sheets.receipts.columns` 添加列名
2. `excel/writer.py` 的 `write_receipt` 函数中 `ws.append(...)` 对应位置添加字段
