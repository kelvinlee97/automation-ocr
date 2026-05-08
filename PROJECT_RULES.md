# automation-ocr 项目规则

> 项目专属 AI 指示。通用行为准则见 `AGENTS.md`。

---

## 项目架构

```
automation-ocr/
├── wa-bot/                  # 主应用（Node.js）
│   ├── index.js             # 入口：启动顺序 db.init → migrate → sessionManager → Express → Bot
│   ├── src/
│   │   ├── db/
│   │   │   ├── index.js     # SQLite 单例（better-sqlite3，WAL 模式）
│   │   │   └── schema.sql   # 3 张表：receipts / sessions / admin_users
│   │   ├── adminServer.js   # Express 管理后台（单文件，Phase 4 才拆分）
│   │   ├── bot.js           # WhatsApp 客户端（whatsapp-web.js）
│   │   ├── sessionManager.js# 用户会话状态机（SQLite）
│   │   ├── messageHandler.js# WhatsApp 消息路由
│   │   ├── handlers/        # registrationHandler / receiptHandler
│   │   ├── services/
│   │   │   ├── receiptStore.js     # 收据 CRUD（SQLite）
│   │   │   ├── adminUserService.js # 管理员账户（SQLite + scrypt）
│   │   │   ├── aiService.js        # Gemini AI 调用
│   │   │   └── excelService.js     # Excel 导出（exceljs）
│   │   └── utils/logger.js  # Winston 日志
│   ├── scripts/
│   │   └── migrate-json-to-sqlite.js  # 一次性迁移脚本（--dry-run / --apply）
│   └── Dockerfile
├── config/config.yaml       # Bot 配置（session_timeout_minutes, max_receipts_per_day）
├── data/                    # 运行时数据（Docker volume 挂载，不提交）
│   ├── app.db               # SQLite 数据库
│   └── images/              # 收据图片
├── docker-compose.yml
└── plan.md                  # 项目优化计划（Phase 1-6）
```

**关键约定：**
- 数据目录通过 `process.env.DATA_DIR` 注入，本地回退为 `wa-bot/../data`
- 所有数据层共用同一个 SQLite 单例 `wa-bot/src/db/index.js`
- `adminServer.js` 当前为单文件（~2500 行），Phase 4 才拆分，**现在不要主动拆**

---

## Git 工作流

### 分支命名
- 功能：`feat/<简短描述>`（如 `feat/zod-validation`）
- 修复：`fix/<简短描述>`（如 `fix/lid-phone`）
- Phase 计划任务：`phase-<N>-<简短描述>`（如 `phase-3-route-tests`）
- **不直接在 main 上 commit**

### 完整流程
```bash
# 1. 同步 main 并创建分支
git checkout main && git pull origin main && git checkout -b feat/xxx

# 2. 开发 + 本地测试（必须全绿）
cd wa-bot && npm test

# 3. 原子提交（每个 commit 只做一件事）
git add ... && git commit -m "feat(scope): 描述"

# 4. push 分支
git push -u origin feat/xxx

# 5. 自查 diff
git diff main..feat/xxx --stat

# 6. merge 到 main（保留分支历史）
git checkout main && git merge --no-ff feat/xxx

# 7. push main
git push origin main

# 8. 删除已合并分支（远程 + 本地）
git push origin --delete feat/xxx
git branch -d feat/xxx
```

### commit message 格式（Conventional Commits）
- `feat(<scope>): <描述>`
- `fix(<scope>): <描述>`
- `chore(<scope>): <描述>`

### merge 前强制检查点
- `npm test` 全绿
- `git diff main..<branch> --stat` 确认改动范围符合预期
- 无不相关文件被修改

---

## 测试策略

- 测试框架：Jest，运行：`cd wa-bot && npm test`
- 测试文件放在源文件同级的 `__tests__/` 目录，命名 `*.test.js`
- **不使用 mock-fs**：`better-sqlite3` 是原生模块无法被拦截，改用 `os.tmpdir()` 真实临时目录，`afterAll` 清理
- 每个测试套件独立设置 `process.env.DATA_DIR`，`beforeAll` 调用 `store.init()` / `db.init()`
- 并发测试用 `worker_threads`
- 当前基线：44 tests passing，新改动不得破坏

---

## 安全约束

- **密码哈希**：scrypt（`crypto.scryptSync`），参数固定为 `{N:16384, r:8, p:1}`，不得改为其他算法
- **时序攻击防护**：密码比对必须用 `crypto.timingSafeEqual`，不得用 `===`
- **SQL 注入**：所有 SQL 必须用 prepared statements（`db.prepare(...).run(...)`），禁止字符串拼接
- **XSS 防护**：HTML 渲染时用户输入必须经过 `escapeHtml()` 处理
- **PII 脱敏**：日志/UI 中手机号显示 `****XXXX`，IC 号显示 `XXXXXX-XX-****`；Excel 导出明文不变

---

## 禁止修改清单

未经明确指示，以下内容**不得修改**：

| 文件 | 原因 |
|------|------|
| `wa-bot/src/db/schema.sql` | 表结构变更需配套迁移脚本 |
| `docker-compose.yml` | 生产挂载配置，影响数据持久化 |
| `config/config.yaml` | 运行时配置，影响 session 超时和每日限额 |
| `adminUserService.js` 中的 scrypt 参数 | 改动导致已有密码哈希全部失效 |
| `data/` 目录下任何文件 | 运行时数据，不属于代码库 |
