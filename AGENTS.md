# AGENTS.md - 开发指南

本文件为 AI Agent 提供项目开发指南。

---

## 1. 项目概述

WhatsApp OCR 收据验证系统。用户通过 WhatsApp 提交马来西亚身份证号和收据截图，系统使用 Gemini AI 识别收据、验证资格，结果写入 Excel。

**技术栈**：
- Node.js ≥ 20（LTS）
- Express（Web 服务）
- whatsapp-web.js（WhatsApp 协议）
- @google/generative-ai（Gemini AI）
- exceljs（Excel 操作）
- winston（日志）
- express-rate-limit（限流）

**数据存储**：
- 会话：`data/sessions.json`（本地 JSON 文件）
- 收据图片：`data/receipts/`
- Excel：`data/excel/records.xlsx`
- 管理凭据：`data/admin_users.json`

---

## 2. 构建与运行命令

### 本地开发

```bash
# 安装依赖
cd wa-bot && npm install

# 开发模式（文件变更自动重启）
cd wa-bot && npm run dev

# 生产启动
cd wa-bot && npm start

# 代码风格检查
cd wa-bot && npm run lint
```

### Docker 部署

```bash
# 构建并启动
docker compose up -d --build

# 查看日志
docker compose logs -f wa-bot

# 停止
docker compose down
```

### 接口

- **Health Check**: `GET /health` — 返回 `{ status, whatsapp, timestamp }`
- **Rate Limiting**: 登录 15 分钟 20 次，API 1 分钟 60 次

### 常用环境变量

```bash
GEMINI_API_KEY=your_key_here    # 必需
NODE_ENV=production             # 可选
SESSION_SECRET=your_secret      # 可选（保持登录状态）
```

---

## 3. 代码风格指南

### 3.1 模块系统
- 使用 **CommonJS**（`require` / `module.exports`），不使用 ES Modules

### 3.2 导入顺序
1. Node.js 内置模块（fs, path, crypto...）
2. 第三方依赖（express, exceljs...）
3. 项目内部模块（./utils, ./services...）

### 3.3 命名约定
| 类型 | 规则 | 示例 |
|------|------|------|
| 文件 | kebab-case | `sessionManager.js` |
| 函数 | camelCase | `getOrCreateSession()` |
| 常量 | UPPER_SNAKE | `SESSION_STATE` |
| 私有函数 | `_prefix` | `_getConfig()` |

### 3.4 注释规范
- 公共函数使用 **JSDoc** 注释
- 私有函数可用中文简述

### 3.5 错误处理
- 使用 try-catch 捕获异步错误
- 记录日志时包含上下文信息
- 返回结构化错误对象 `{ success: false, message: '...' }`

### 3.6 日志规范
- 使用 winston logger
- 包含结构化元数据：`logger.info('事件', { key: value })`

### 3.7 配置管理
- 业务规则集中在 `config/config.yaml`
- 使用 js-yaml 读取，避免硬编码

### 3.8 异步模式
- 优先使用 async/await
- 文件 I/O 使用同步方法（简单可靠）

---

## 4. 项目结构

```
wa-bot/src/
├── index.js                # 入口
├── bot.js                  # WhatsApp 客户端
├── adminServer.js          # 管理后台（Express）
├── sessionManager.js       # 会话状态机（JSON 文件存储）
├── messageHandler.js       # 消息路由
├── handlers/               # 业务处理器
├── services/               # 业务服务
└── utils/                  # 工具函数
```

---

## 5. 注意事项

1. WhatsApp 登录凭证：`wa-bot/.wwebjs_auth/`（已 gitignore）
2. 会话数据：`data/sessions.json`（Docker 需挂载持久化）
3. 管理后台首次访问引导创建管理员账号
4. Gemini API 失败返回 `retryable: true`，前端可显示"重试"按钮
5. 所有代码改动必须通过 PR 处理
