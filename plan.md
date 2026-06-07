# automation-ocr 项目优化计划

> **元数据**：本文件是 IDE plan 的人类与外部 LLM 可读镜像。权威执行状态以 IDE plan.json 为准；执行过程中两者同步更新。
>
> **版本**：v1.0
> **生成时间**：2026-05-07
> **作者**：AI Agent (CodeBuddy)
> **适用项目**：`/Users/kelvinlee/Documents/projects/automation-ocr`
> **当前分支**：main

---

## 总览状态

| Phase | 标题 | 状态 | 依赖 |
|-------|------|------|------|
| Phase 1 | 关键 Bug 修复 + 死代码清理 | ✅ done | 无 |
| Phase 2 | SQLite 数据层迁移 | ✅ done | Phase 1 |
| Phase 3 | 路由集成测试补全 | ✅ done | Phase 2 |
| Phase 4 | adminServer.js 拆分 | ✅ done（待人工视觉复核） | Phase 3 |
| Phase 5 | 安全加固 + 可观测性 | ⏳ pending | Phase 4 |
| Phase 6 | Agentic L3 自主闭环 | ⏳ pending | Phase 5 |

---

## Phase 1：关键 Bug 修复 + 死代码清理（约 0.5 天）

### 目标
零行为变更，修复 3 个严重 Bug + 清理 4 处死代码。CI 全绿即通过。

### 任务清单

- [x] **Bug 修复**：修复 `excelService.js` 的 `EXCEL_PATH`，改为读取 `process.env.DATA_DIR`（与 `receiptStore.js` 对齐），确保容器重建后 Excel 数据不丢失
- [x] **Bug 修复**：提供一次性迁移脚本 `wa-bot/scripts/migrate-excel-path.sh`，检测旧路径 `/app/data/excel/records.xlsx` 若存在则 mv 到新路径
- [x] **Bug 修复**：移除 `ci.yml` docker smoke test 末尾的 `|| true`，让测试真实失败可被暴露
- [x] **死代码清理**：删除 `adminServer.js` 中的 `_renderActions` 函数（约 60 行，已被 `renderInlineActions` + `buildExpandPanel` 取代）
- [x] **死代码清理**：删除 `receiptStore.js` 中的 `saveSentMessage` 函数（已标记 `@deprecated`）
- [x] **死代码清理**：删除根 `package.json` 中的 `playwright` devDependency（无任何使用点）
- [x] **死代码清理**：删除空文件 `config/messages.yaml`（注释说明 Bot 已静默化，无内容）
- [x] **测试基础设施**（计划外补充）：配置 Jest（`wa-bot/jest.config.js`）+ 根 `package.json` test 脚本指向 `wa-bot/`
- [x] **单元测试**（计划外补充）：新增 `receiptStore.test.js`（20 个用例，覆盖 CRUD + 全部状态流转）与 `excelService.test.js`（9 个用例，覆盖 DATA_DIR 路径策略 + 核心读写）

### 成功标准
- ✅ `npm test` 全绿（44 tests passed）
- `npm run lint` 无警告
- 本地启动后 Excel 写入路径在挂载卷内（非 `/app/data/`）

---

## Phase 2：SQLite 数据层迁移（约 1.5 天）

### 目标
用 `better-sqlite3` 替代 3 个 JSON 文件，解决并发写竞态与写非原子两个数据完整性 Bug。store 对外 API 签名保持不变，调用方零改动。

### 任务清单

- [x] **新增依赖**：在 `wa-bot/package.json` 中添加 `better-sqlite3`，更新 Dockerfile 安装 `build-essential`
- [x] **新建数据层**：`wa-bot/src/db/index.js`（SQLite 单例，PRAGMA journal_mode=WAL，PRAGMA foreign_keys=ON）
- [x] **新建 Schema**：新建 `wa-bot/src/db/schema.sql`（3 张表 + 索引）
  - `receipts(id TEXT PK, phone, ic, image_filename, status, submitted_at, ai_result_json, reviewed_at, review_note, sent_message, sent_at, previous_status)`
  - `sessions(phone TEXT PK, ic, state, created_at, updated_at, receipt_count, receipt_count_date)`
  - `admin_users(username TEXT PK, password_hash, created_at)`
  - 索引：`receipts(status)`, `receipts(submitted_at DESC)`, `receipts(phone)`
- [x] **重写 receiptStore.js**：内部改用 SQLite，对外 API（`init`, `addPendingReceipt`, `getAll`, `getById`, `saveAiResult`, `confirmReceipt`, `rejectReceipt`, `sendMessageToUser`, `getImagePath`）不变
- [x] **重写 sessionManager.js**：内部改用 SQLite，对外 API 不变（修复模块级缓存与磁盘不同步问题）
- [x] **重写 adminUserService.js**：内部改用 SQLite，对外 API 不变（scrypt 哈希逻辑保留）
- [x] **迁移脚本**：新建 `wa-bot/scripts/migrate-json-to-sqlite.js`，支持 `--dry-run`（仅打印）与 `--apply`（自动备份 + 事务 INSERT）
  - 备份目录：`data/backup/<ISO timestamp>/`
  - 幂等设计：启动时若旧 JSON 存在但 DB 中无数据，自动触发迁移
- [x] **数据库初始化**：更新 `wa-bot/index.js`，启动时调用 `db.init()` 与 `migrate()`
- [x] **并发测试**：新建 `wa-bot/src/db/__tests__/db.test.js`，fork 100 个 worker 同时 INSERT 验证不丢数据

### 成功标准
- 现有 Jest 测试全绿
- 新增 `db.test.js` 并发测试 PASS
- `node wa-bot/scripts/migrate-json-to-sqlite.js --dry-run` 正常输出
- store 对外 API 签名零变更（grep 验证无 import 路径改动）

---

## Phase 3：路由集成测试补全（约 1 天）

### 目标
为 Phase 4 拆分提供安全网。用 supertest 覆盖管理后台所有核心路由，确保拆分前后行为等价。

### 任务清单

- [x] **新建测试文件**：`wa-bot/src/admin/__tests__/admin-routes.test.js`
- [x] **测试用例**（按路由覆盖）：
  - [x] `GET /health` → 返回 200 + JSON
  - [x] `GET /admin` 未登录 → 302 → /admin/login
  - [x] `POST /admin/setup`（首次） → 创建用户 → 302
  - [x] `POST /admin/login` 正确凭证 → session 写入 → 302 → /admin
  - [x] `POST /admin/login` 错误凭证 → loginPage with error
  - [x] `POST /admin/logout` → session 销毁
  - [x] `GET /admin/qr`（未连接） → 包含 QR placeholder
  - [x] `GET /admin/wa-status` → JSON `{connected, hasQR}`
  - [x] `POST /admin/request-pairing-code` 非法手机号 → 400
  - [x] `POST /admin/receipts/:id/ai-extract` 无该 ID → 404
  - [x] `POST /admin/receipts/:id/reject` → 数据库状态变化
  - [x] `POST /admin/receipts/:id/send-message` `_client=null` → 503
  - [x] `GET /admin/export` 未登录 → 302
  - [x] `GET /admin/images/:filename` 不存在 → 404
- [x] **Mock 策略**：用 `jest.mock` 替代 `_client.sendMessage` 与 `processReceipt`
- [x] **快照基线**：落 HTML 关键片段快照（页面 title、表单 action、状态徽标 class），用于 Phase 4 拆分前后等价性校验
- [x] **覆盖率报告**：路由层覆盖率满足要求（运行 `npm run test -- --coverage`）

### 成功标准
- 所有 14 条用例 PASS
- 路由层覆盖率 ≥80%
- 快照基线文件已生成

---

## Phase 4：adminServer.js 拆分（约 1.5 天）

### 目标
将 2551 行单文件按职责拆分为 20+ 个独立模块，行为逐路由等价。HTML/CSS/JS/i18n 全部分离，提升人类可读性与协作可维护性。

### 任务清单

- [x] **新建目录结构**：`wa-bot/src/admin/` 下建立 `middleware/`、`routes/`、`views/`、`static/`、`i18n/` 子目录
- [x] **拆分 server.js**：`wa-bot/src/admin/server.js` — 保留 `startAdminServer` + 中间件装配（约 150 行）
- [x] **拆分 state.js**：`wa-bot/src/admin/state.js` — 模块级 `_client` / `_qrBase64` / `_waConnected` 等状态 + setter
- [x] **拆分 middleware**：
  - [x] `admin/middleware/auth.js` — `requireAuth` / `requireSetup`
  - [x] `admin/middleware/rateLimit.js` — `authLimiter` / `apiLimiter`
  - [x] `admin/middleware/session.js` — FileStore 配置
  - [x] `admin/middleware/security.js` — Phase 5 安全中间件挂载点（helmet/CSP/CSRF 实现留到 Phase 5）
- [x] **拆分 routes**：
  - [x] `admin/routes/auth.js` — /admin/login, /admin/logout, /admin/setup
  - [x] `admin/routes/receipts.js` — /admin（列表）+ /admin/receipts/:id/*（ai-extract/send-message/reject）
  - [x] `admin/routes/users.js` — /admin/users/*
  - [x] `admin/routes/whatsapp.js` — /admin/qr, /admin/wa-status, /admin/request-pairing-code
  - [x] `admin/routes/export.js` — /admin/export
- [x] **拆分 views**：
  - [x] `admin/views/layout.js` — `htmlLayout` 骨架
  - [x] `admin/views/escapeHtml.js` — XSS 防护工具
  - [x] `admin/views/login.js` — loginPage + setupPage
  - [x] `admin/views/qr.js` — qrPage
  - [x] `admin/views/receipts.js` — receiptsPage + buildExpandPanel + renderInlineActions + buildPagination
  - [x] `admin/views/users.js` — usersPage + newUserPage
- [x] **拆分 static**：
  - [x] `admin/static/admin.css` — 抽出主后台布局 CSS
  - [x] `admin/static/admin.js` — toast / 灯箱 / 语言切换 / 主题切换
  - [x] `admin/static/qr.js` — tab 切换 / 配对码请求 / 状态轮询
  - [x] `admin/static/theme-init.js` — 防 FOUC 主题切换
- [x] **拆分 i18n**：
  - [x] `admin/i18n/index.js` — `t()` + `getLang()`
  - [x] `admin/i18n/zh.js` — 中文字典
  - [x] `admin/i18n/en.js` — 英文字典
- [x] **静态文件服务**：路由添加 `app.use('/admin/static', express.static(...))`
- [x] **兼容入口**：原 `wa-bot/src/adminServer.js` 仅保留一行 `module.exports = require('./admin/server')`，保持旧 import 路径兼容
- [x] **等价性验证**：运行 Phase 3 全部测试 + 快照，对比无差异

### 成功标准
- Phase 3 所有测试 PASS
- 快照对比零差异
- 手动验证 4 个核心页（登录/收据列表/用户管理/QR）视觉无差异
- `adminServer.js` 仅剩 1 行兼容导出

---

## Phase 5：安全加固 + 可观测性（约 1 天）

### 目标
引入 helmet、CSRF 保护、CSP nonce、Docker healthcheck 与结构化指标。合规要求为「弱」，重点在运行时健壮性与 CI 安全扫描。

### 任务清单

- [ ] **CSRF 保护**：新建 `wa-bot/src/utils/csrfToken.js`（double-submit cookie 模式）
  - GET 响应注入 `csrfToken` 到 cookie + session
  - POST 校验 `x-csrf-token` header 或 `form._csrf` 与 session 一致
  - 每个视图模板 form 加隐藏字段 `<input type="hidden" name="_csrf" value="${csrfToken}">`
- [ ] **Helmet + CSP**：在 `admin/middleware/security.js` 中集成 helmet
  - CSP：`scriptSrc: ["'self'", nonce]`, `styleSrc: ["'self'", "'unsafe-inline'"]`（管理后台样式依赖内联）
  - X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin
- [ ] **CSP nonce 注入**：每个 GET 请求生成 `crypto.randomBytes(16).toString('base64')` 注入 `res.locals.cspNonce`
- [ ] **Docker HEALTHCHECK**：在 Dockerfile 添加 `HEALTHCHECK CMD wget -q --spider http://127.0.0.1:3000/health || exit 1`
- [ ] **安全 CI**：
  - [ ] 新建 `.github/workflows/security.yml`：npm audit + gitleaks-action + dependency-review-action（PR 触发）
  - [ ] 更新 `ci.yml`：加 `npm audit --audit-level=high`
- [ ] **错误追踪**：Express 错误中间件中生成 `traceId`（`req.id = crypto.randomUUID()`），所有 winston 输出含 traceId
- [ ] **PII 脱敏完善**：views 层 IC 显示改为 `XXXXXX-XX-****`（Excel 导出明文不变，业务需要）
- [ ] **CSP Report-Only 阶段**：先以 `Content-Security-Policy-Report-Only` 模式上线，观察 24h 无 violation 后切换 enforce

### 成功标准
- CSRF 伪造跨站表单 POST 返回 403
- `docker inspect` 显示 healthcheck `healthy`
- CSP Report-Only 运行 24h 无 violation 报错
- security.yml CI 全绿

---

## Phase 6：Agentic L3 自主闭环（约 2 天）

### 目标
搭建从 Issue → 分支 → 实现 → 测试 → PR → 人工守门合并的自主闭环。保守模式：AI 只创建 PR 到 `dev` 分支，不触碰 `main`。

### 任务清单

- [ ] **分支策略**：新建 `dev` 分支 + GitHub 分支保护规则
  - `main`：require PR + 1 approver + no force push
  - `dev`：require status checks（CI 全绿）+ allow bot push + allow squash merge
- [ ] **CODEOWNERS**：新建 `.github/CODEOWNERS`，锁定 `.github/workflows/`、`infra/`、`docker-compose.yml` 由 owner 审批
- [ ] **Workflow 1：agentic-implement.yml**（`@claude` mention / issues assigned 触发）
  - 限定 `base_branch: dev`（永远 PR 到 dev）
  - 限制 permissions：`contents: write` + `pull-requests: write` + `issues: write`（禁止 main）
  - 限制 allowed tools：Read/Write/Edit/Bash（仅 npm test/lint）
  - 限制 disallowed tools：Bash(git push origin main), Bash(rm -rf*)
- [ ] **Workflow 2：agentic-review.yml**（PR 到 dev 触发）
  - AI 自动评论 review（代码质量 + 安全 + 测试覆盖变化）
  - 不阻塞 merge
- [ ] **Workflow 3：agentic-deps.yml**（cron 每周一）
  - `npm outdated` 扫描依赖
  - 对每个可升级依赖创建独立 PR 到 dev
- [ ] **Workflow 4：agentic-triage.yml**（issues opened 触发）
  - AI 自动打标签（bug/feature/question）+ 优先级建议
- [ ] **Provider 抽象层**：`agentic-implement.yml` 支持 `provider` input，默认 `claude`（Anthropic Claude Code Action），预留 `copilot` 和 `custom` 切换接口
- [ ] **AGENTS.md 增强**：补充「项目架构」「测试策略」「安全约束」「禁止修改清单」四节
- [ ] **`.claude/` 目录**：
  - `.claude/settings.json` — 默认禁用危险工具 + 默认 base branch=dev
  - `.claude/commands/fix-flaky-test.md` — slash command
  - `.claude/commands/add-route-test.md` — slash command
  - `.claude/commands/review-security.md` — slash command
  - `.claude/agents/code-reviewer.md` — subagent profile
  - `.claude/agents/test-writer.md` — subagent profile
- [ ] **失败自愈**：PR CI fail 时触发 `@claude fix the failing test` 评论，最多重试 3 次，超出则 @ 真人
- [ ] **Secrets 配置**：在 GitHub repo Secrets 中添加 `ANTHROPIC_API_KEY`（Claude Code Action 所需，用户自行提供）
- [ ] **端到端验证**：创建测试 issue（如「在 icParser 中支持西马旧 IC 格式」），AI 自主完成 PR 到 dev，CI 全绿

### 成功标准
- 给 repo 提一个测试 issue，AI 自主创建 PR 到 dev，CI 全绿
- `main` 分支无 AI 直接提交记录（git log 验证）
- 每周一自动出现至少 1 个依赖升级 PR 到 dev
- 所有 AI 创建的 PR 均带 `auto-generated` label

---

## 技术约束（已确认）

| 约束项 | 决策 |
|-------|------|
| 存储底座 | 引入 SQLite（`better-sqlite3`），替代 JSON 文件 |
| PII 合规 | 弱（日志/UI 脱敏，磁盘明文可接受） |
| Agentic Provider | 默认 Anthropic Claude Code Action，预留切换接口 |
| Agentic 守门 | 保守：AI 只 PR 到 dev，main 人工 merge |
| 模板引擎 | 不引入（避免 SSR 渲染开销） |
| 拆分原则 | 只搬不改，逐路由等价 |
| 回滚策略 | 每个 Phase 独立 PR，独立可回滚 |

---

## 已识别风险与缓解

| 风险 | 缓解 |
|------|------|
| SQLite 迁移不可逆 | 提供 `--dry-run` + 自动备份到 `data/backup/<timestamp>/` |
| adminServer.js 拆分引入回归 | Phase 3 集成测试必须先于 Phase 4 |
| Claude Code Action prompt injection | GITHUB_TOKEN 权限限定 + CODEOWNERS 锁定 workflows |
| dev 分支需新建 | 用户在 Phase 6 前完成 GitHub 分支保护配置 |
| Agentic API 配额自付 | 在 plan 中注明，用户自行管理 `ANTHROPIC_API_KEY` |

---

## 架构图

### Phase 依赖关系

```mermaid
flowchart LR
  P1[Phase 1<br/>关键 Bug + 死代码<br/>零风险] --> P2[Phase 2<br/>SQLite 数据层<br/>可独立回滚]
  P2 --> P3[Phase 3<br/>路由集成测试<br/>纯增量]
  P3 --> P4[Phase 4<br/>adminServer 拆分<br/>等价性由 P3 守护]
  P4 --> P5[Phase 5<br/>安全 + 可观测性<br/>独立模块]
  P5 --> P6[Phase 6<br/>Agentic L3<br/>需 P3 绿 CI 基线]
```

### 拆分后架构

```mermaid
graph TB
  subgraph Entry
    A[index.js]
  end
  subgraph Bot
    B[bot.js<br/>WhatsApp Client]
    M[messageHandler.js]
    H1[registrationHandler]
    H2[receiptHandler]
  end
  subgraph Admin
    S[admin/server.js]
    R1[routes/auth]
    R2[routes/receipts]
    R3[routes/users]
    R4[routes/whatsapp]
    R5[routes/export]
    V[views/*]
    ST[static/*]
    I[i18n/*]
    MW[middleware/*]
  end
  subgraph Data
    DB[(SQLite app.db)]
    RS[services/receiptStore]
    SM[sessionManager]
    AU[services/adminUserService]
    EX[services/excelService]
    AI[services/aiService]
  end
  A --> B
  A --> S
  B --> M --> H1 & H2
  H1 --> EX & SM
  H2 --> RS & SM
  S --> MW & R1 & R2 & R3 & R4 & R5
  R1 & R2 & R3 & R4 & R5 --> V --> I
  V --> ST
  R2 --> RS & AI
  R3 --> AU
  R5 --> EX & RS
  RS & SM & AU --> DB
  EX -.->|纯导出| DB
```

### Agentic L3 闭环时序

```mermaid
sequenceDiagram
  participant U as 人类
  participant GH as GitHub
  participant W as Workflow
  participant CC as Claude Code Action
  participant DEV as dev branch
  participant MAIN as main branch
  U->>GH: 创建 Issue + @claude
  GH->>W: trigger agentic-implement.yml
  W->>CC: 启动（限定 base=dev, 禁用敏感 tools）
  CC->>CC: 读 AGENTS.md + .claude/ 上下文
  CC->>DEV: 创建分支 ai/issue-NNN
  CC->>CC: 编写代码 + 跑测试
  alt 测试通过
    CC->>GH: 开 PR 到 dev
    W->>CC: trigger agentic-review.yml
    CC->>GH: 添加 review 评论
    U->>GH: 人工审阅 + merge to dev
    U->>GH: 周期性人工 PR dev → main
    GH->>MAIN: deploy.yml 自动部署
  else 测试失败
    CC->>GH: 评论失败原因
    CC->>CC: 自愈重试（≤3 次）
    alt 仍失败
      CC->>GH: @ 真人介入
    end
  end
```

---

## 附录 A：上线与售卖指南（新手执行版）

> 本附录用于回答「项目完成后如何上线并尝试出售」。它不改变 Phase 1-6 的技术路线，只作为商业化准备清单。

### A.1 商用上线前门槛

**正式商用建议门槛：完成 Phase 5 后再对外收费交付。**

原因：本项目会处理手机号、身份证号、收据图片等敏感信息。Phase 5 中的 CSRF、Helmet/CSP、Docker healthcheck、错误追踪、PII 脱敏与安全 CI，是对客户交付前的最低安全与可观测性基础。

Phase 5 完成前，只建议用于：

- 本地开发测试
- 内部 demo
- 小范围试点演示
- 与潜在客户沟通需求

Phase 5 完成后，才建议进入：

- 正式客户部署
- 收费试点
- 签合同交付
- 长期维护收费

### A.2 上线前检查清单

#### 产品功能

- [ ] 消费者完整流程跑通：发送 IC → 上传收据 → 后台看到记录 → 审核后收到 WhatsApp 消息
- [ ] 管理后台可登录、可审核、可导出 Excel
- [ ] AI 识别失败时，后台仍可人工处理，不阻塞业务
- [ ] `config/config.yaml` 中品牌白名单、最低金额、每日提交限制已按客户活动配置

#### 安全与账号

- [ ] 已完成 Phase 5 安全加固
- [ ] 管理员账号使用强密码
- [ ] `SESSION_SECRET` 固定且不提交到 Git
- [ ] `GEMINI_API_KEY` 只放在服务器 `.env` 或 CI Secret 中
- [ ] 使用专用 WhatsApp 号码，不使用个人主号或客户公司主号
- [ ] 明确告知客户：本项目使用 `whatsapp-web.js` 非官方库，存在 WhatsApp 账号限制或封号风险

#### 数据与运维

- [ ] `data/` 目录已持久化挂载
- [ ] 已配置 `data/` 定期备份
- [ ] 已确认容器重启后 WhatsApp 不需要重新扫码
- [ ] 已配置 HTTPS
- [ ] 已配置基础监控：服务是否在线、磁盘是否爆满、容器是否异常退出
- [ ] 已准备故障处理方式：如何看日志、如何重启、如何恢复备份

#### 客户交付资料

- [ ] 客户使用手册：登录、审核、导出、查看 QR
- [ ] 5 分钟以内演示视频
- [ ] 管理员账号交付方式明确，避免明文群发
- [ ] 维护范围说明：哪些算 bug，哪些算新需求
- [ ] 风险声明与合同条款已准备

### A.3 三种售卖模式比较

| 模式 | 说明 | 优点 | 风险 | 新手建议 |
|------|------|------|------|----------|
| 一次性买断 | 客户一次性付款，获得系统部署或源码 | 收款快，后续责任少 | 价格容易被压低；交源码后难持续收费 | 不优先推荐，除非客户预算高且边界清楚 |
| 部署费 + 月维护费 | 你帮客户部署，客户每月付维护费 | 最适合第一单；现金流稳定；责任边界容易写清楚 | 需要承担基础运维和响应 | **推荐作为第一阶段商业模式** |
| SaaS 订阅 | 多个客户共用平台，按月订阅 | 可规模化，长期收入更高 | 需要多租户、计费、隔离、客服、合规，复杂度高 | 暂不建议作为第一版目标 |

推荐路线：

1. 第一单采用「部署费 + 月维护费」模式。
2. 先服务 1 个真实客户，验证业务流程和维护成本。
3. 收集 1 个案例、1 段客户反馈、1 套真实问题清单。
4. 再判断是否值得做 SaaS 化。

可参考定价思路：

- 部署费：覆盖安装、配置、演示、首次培训
- 月维护费：覆盖小 bug、基础监控、简单配置调整
- 新功能：单独报价，不混入月维护费

### A.4 第一个客户获取路径

优先顺序：

1. **熟人网络**：朋友、亲戚、前同事中是否有人做零售、电器、促销活动、活动代理。
2. **本地促销代理公司**：寻找负责 rebate、campaign、receipt verification 的公司。
3. **小商家试点**：找愿意低价试用的商家，换取案例和反馈。
4. **线上展示**：做一个短 demo 视频，展示消费者发 WhatsApp、后台审核、Excel 导出的完整流程。

第一单目标不是赚最多钱，而是验证：

- 客户是否真的愿意用
- 客户是否愿意付费
- 你每月维护成本有多高
- WhatsApp 非官方方案是否能稳定支撑真实活动

第一单建议降低风险：

- 不承诺永久免费维护
- 不承诺 WhatsApp 账号永不封号
- 不承诺 100% AI 识别准确
- 不交付源码，除非额外收费且合同写明
- 只承诺明确范围内的功能

### A.5 合同与风险声明要点

> 以下不是法律意见，只是给合同/报价单准备时的检查清单。正式商用前建议找本地律师或有经验的合同模板确认。

#### 必写风险

- 本系统使用 WhatsApp Web 相关非官方自动化能力，存在账号被限制、登出、风控或封号风险。
- AI OCR 识别结果仅作辅助，最终审核责任由客户工作人员确认。
- 云服务商、WhatsApp、Google Gemini 等第三方服务异常，不应计入你的完全责任。

#### 数据归属

- 客户提交的手机号、IC、收据图片和审核记录归客户所有。
- 未经客户书面同意，不用于训练、展示或转卖。
- 合作终止后，数据导出、删除、保留周期需要提前写清楚。

#### 维护范围

月维护费建议只包含：

- 已上线功能的 bug 修复
- 小范围配置调整
- 基础服务器检查
- 简单使用答疑

不应默认包含：

- 新页面
- 新流程
- 新报表
- 多语言扩展
- 多客户/多活动隔离
- 第三方系统集成

#### SLA 边界

报价前先写清楚：

- 响应时间：例如工作日 24 小时内响应
- 修复时间：按严重程度区分
- 不包含范围：客户误操作、账号被封、第三方平台故障、服务器欠费、客户自行修改服务器

#### 付款建议

第一单建议：

- 50% 预付款后开始部署
- 40% 上线验收后支付
- 10% 试运行结束后支付
- 月维护费从正式上线次月开始收取

避免：

- 完成后才收全款
- 口头承诺长期免费维护
- 未签风险声明就让客户用于正式活动