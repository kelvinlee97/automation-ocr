# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

WhatsApp OCR 收据验证自动化系统。用户通过 WhatsApp 提交马来西亚身份证号和收据截图，系统使用 Gemini AI 识别收据、验证资格（品牌白名单 + 金额门槛），结果写入 Excel。

**当前架构**：纯 Node.js 单服务，使用 Gemini 1.5 Flash 替代原 Python EasyOCR 方案。README.md 中的架构图已过时（仍描述旧双进程方案）。

## 常用命令

```bash
# 开发（文件变更自动重启）
cd wa-bot && npm run dev

# 生产启动
cd wa-bot && npm start

# Docker（推荐，含持久化卷）
docker compose up -d --build
docker compose logs -f wa-bot   # 查看日志 / 首次扫码
docker compose down
```

**首次启动**：访问 `http://<服务器 IP>/admin/qr` 扫码（Web UI），或在终端日志中查看 QR 码，凭证保存在 `wa-bot/.wwebjs_auth/`（已 gitignore，重启无需重新扫）。

## 代码架构

```
wa-bot/src/
├── adminServer.js          # 管理后台 Express 服务器（端口 3000，含认证、审核、WhatsApp 通知）
├── bot.js                  # Client 初始化、二维码、断线重连（指数退避）
├── messageHandler.js       # 消息入口：仅处理私聊图片，其他静默忽略
├── sessionManager.js       # 用户会话状态机（内存 Map，TTL 30min）
├── handlers/
│   ├── receiptHandler.js   # 图片 → Gemini → 判定 → 写 Excel
│   └── registrationHandler.js  # IC 格式验证 → 写 Excel
├── services/
│   ├── aiService.js        # Gemini API 调用，prompt 工程，返回 JSON
│   └── excelService.js     # ExcelJS 读写两张表（Registrations / Receipts）+ 审核列
└── utils/
    ├── logger.js           # Winston（控制台 + 文件轮转，最多 5×10MB）
    └── icParser.js         # 马来西亚 IC 格式验证（XXXXXX-XX-XXXX）
```

### 会话状态机

```
新用户 → WAITING_IC → (IC 验证通过) → WAITING_RECEIPT → (收据处理完) → DONE
```

- 状态存在内存 Map，Bot 重启后丢失，用户需重新提交 IC
- 每 10 分钟自动清理超时（30min）的 session

### 数据流（收据处理）

```
用户发图片
→ messageHandler（路由）
→ receiptHandler（下载图片转 Base64）
→ aiService（Gemini 识别：收据号、品牌、金额、是否合格）
→ excelService（追加写入 xlsx）
→ 回复用户
```

## 配置

### `config/config.yaml` — 业务规则（唯一来源）

```yaml
eligibility:
  eligible_brands: [Samsung, Apple, Dyson, ...]  # 品牌白名单
  minimum_amount: 500.00                          # RM 最低消费

bot:
  session_timeout_minutes: 30
  max_receipts_per_day: 5                         # 防刷
```

> **注意**：`config.yaml` 中 `ocr.*`、`services.ocr_service_url`、`brand_match_threshold` 均为旧 Python OCR 遗留配置，当前代码不使用。

### `.env` — 必填环境变量

```bash
GEMINI_API_KEY=your_key_here
ADMIN_USER=your_admin_username
ADMIN_PASS=your_admin_password
```

### 管理后台

部署后访问 `http://<服务器 IP>/admin`，用 `ADMIN_USER` / `ADMIN_PASS` 登录。

- **WhatsApp 扫码**：访问 `/admin/qr`（无需登录），页面展示 QR 码图像，扫码成功后自动跳转；导航栏显示连接状态（🟢/🔴）
- **收据审核**：查看所有收据，可手动通过/拒绝，审核后自动发 WhatsApp 通知给用户
- **注册用户**：查看所有注册用户
- **下载 Excel**：一键下载完整数据报表

Receipts 表新增 3 列：`Review Status`（pending/approved/rejected）、`Reviewer Note`、`Reviewed At`。
旧 Excel 文件在下次启动时会自动追加这 3 列（无损迁移）。

## 部署

目标环境：Ubuntu，Docker 容器化。推荐 AWS Lightsail $5/月套餐（1GB RAM 足够）。

```bash
# 服务器上
git clone https://github.com/kelvinlee97/automation-ocr.git
# .env 需包含 GEMINI_API_KEY、ADMIN_USER、ADMIN_PASS
echo "GEMINI_API_KEY=xxx" > .env
echo "ADMIN_USER=admin" >> .env
echo "ADMIN_PASS=your_password" >> .env
docker compose up -d --build
docker compose logs -f wa-bot  # 等待 QR 码，手机扫码
```

`wa-bot/.wwebjs_auth/` 通过 Docker volume 挂载持久化，重启不丢登录状态。

## 已知限制

- **会话不持久**：重启丢失所有活跃会话
- **无测试框架**：无单元测试 / 集成测试
- **无 ESLint**：无代码风格检查
- **config.yaml 明文密码**：`dashboard.admin_password: password123` 需迁移到 .env
- **重试未实现**：config 配置了 `ocr_max_retries: 3`，但 aiService.js 未实现重试逻辑
