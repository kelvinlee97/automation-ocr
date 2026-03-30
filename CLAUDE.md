# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

WhatsApp OCR 收据验证自动化系统。用户通过 WhatsApp 提交马来西亚身份证号和收据截图，系统使用 Gemini AI 识别收据、验证资格（品牌白名单 + 金额门槛），结果写入 Excel。

**当前架构**：纯 Node.js 单服务，使用 Gemini 2.5 Flash Lite。移除 Redis，改为本地 JSON 文件存储会话。

## 常用命令

```bash
# 开发（文件变更自动重启）
cd wa-bot && npm run dev

# 生产启动
cd wa-bot && npm start

# 代码风格检查
cd wa-bot && npm run lint

# Docker（推荐，含持久化卷）
docker compose up -d --build
docker compose logs -f wa-bot   # 查看日志 / 首次扫码
docker compose down
```

### 接口

- **Health Check**: `GET /health` — 返回 `{ status, whatsapp, timestamp }`
- **Rate Limiting**: 登录 15 分钟 20 次，API 1 分钟 60 次

**首次启动**：访问 `http://<服务器 IP>/admin/qr` 扫码（Web UI），或在终端日志中查看 QR 码，凭证保存在 `wa-bot/.wwebjs_auth/`（已 gitignore，重启无需重新扫）。

## 代码架构

```
wa-bot/src/
├── adminServer.js          # 管理后台 Express 服务器（端口 3000，含认证、审核、WhatsApp 通知）
├── bot.js                  # Client 初始化、二维码、断线重连（指数退避）
├── messageHandler.js       # 消息入口：仅处理私聊图片，其他静默忽略
├── sessionManager.js       # 用户会话状态机（JSON 文件存储，TTL 30min）
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

- 状态存储在 `data/sessions.json`，Bot 重启后自动恢复
- 自动清理超时（30min）的 session

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

### `.env` — 必填环境变量

```bash
GEMINI_API_KEY=your_key_here

# 建议生产环境设置，防止重启后 cookie 签名失效。
# 注意：当前使用内存 session store，重启仍会清空所有 session，用户须重新登录；
# 如需重启后保持登录状态，需替换为持久化 store（如 session-file-store）。
SESSION_SECRET=your_random_secret_here
```

> `ADMIN_USER` / `ADMIN_PASS` 已从环境变量迁移到管理后台内置用户系统。首次访问 `/admin` 会自动引导创建管理员账号，凭据加密存储在 `data/admin_users.json`（scrypt 哈希，Docker volume 持久化）。

### 管理后台

部署后访问 `http://<服务器 IP>/admin`，首次访问自动进入初始化引导页创建管理员账号。

- **WhatsApp 扫码**：访问 `/admin/qr`（无需登录），页面展示 QR 码图像，扫码成功后自动跳转；导航栏显示连接状态（🟢/🔴）
- **收据审核**：查看所有收据，可手动通过/拒绝，审核后自动发 WhatsApp 通知给用户
- **注册用户**：查看所有注册用户
- **下载 Excel**：一键下载完整数据报表
- **用户管理**：`/admin/users` — 新建/删除管理员账号、重置任意用户密码
- **修改密码**：`/admin/change-password` — 修改当前登录账号密码

Receipts 表新增 3 列：`Review Status`（pending/approved/rejected）、`Reviewer Note`、`Reviewed At`。
旧 Excel 文件在下次启动时会自动追加这 3 列（无损迁移）。

## 部署

目标环境：Ubuntu，Docker 容器化。当前运行在 **AWS EC2**（`ap-southeast-1`，实例 `i-03cc623049dc8d891`，公网 IP `52.220.177.67`）。

**Security Group**：`sg-0839e7d276d8f6459`
- Port 22（SSH）：仅允许管理员本地 IP（动态 IP，换网络后需手动更新）
- Port 80/443：开放给所有（Admin Panel）

> SSH 规则更新命令（IP 变动时执行）：
> ```bash
> NEW_IP=$(curl -s https://checkip.amazonaws.com)
> # 先查旧规则 ID：aws ec2 describe-security-groups --group-ids sg-0839e7d276d8f6459 --region ap-southeast-1
> aws ec2 revoke-security-group-ingress --group-id sg-0839e7d276d8f6459 --protocol tcp --port 22 --cidr <旧IP>/32 --region ap-southeast-1
> aws ec2 authorize-security-group-ingress --group-id sg-0839e7d276d8f6459 --ip-permissions "[{\"IpProtocol\":\"tcp\",\"FromPort\":22,\"ToPort\":22,\"IpRanges\":[{\"CidrIp\":\"$NEW_IP/32\",\"Description\":\"SSH - home IP\"}]}]" --region ap-southeast-1
> ```

```bash
# 服务器上
git clone https://github.com/kelvinlee97/automation-ocr.git
# .env 只需包含 GEMINI_API_KEY
echo "GEMINI_API_KEY=xxx" > .env
docker compose up -d --build
docker compose logs -f wa-bot  # 等待 QR 码，手机扫码
# 首次访问 http://<IP>/admin 引导创建管理员账号
```

`wa-bot/.wwebjs_auth/` 通过 Docker volume 挂载持久化，重启不丢登录状态。

## 已知限制

- **无测试框架**：无单元测试 / 集成测试
