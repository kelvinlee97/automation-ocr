# ClaimFlow 项目优化计划

## 总览状态

| Phase | 标题 | 状态 | 依赖 |
|-------|------|------|------|
| Phase 1 | 关键 Bug 修复 + 死代码清理 | ✅ done | 无 |
| Phase 2 | SQLite 数据层迁移 | ✅ done | Phase 1 |
| Phase 3 | 路由集成测试补全 | ✅ done | Phase 2 |
| Phase 4 | adminServer.js 拆分 | ✅ done（待人工视觉复核） | Phase 3 |
| Phase 5 | 安全加固 + 可观测性 + Campaign 功能 | ⏳ pending | Phase 4 |

---

## Phase 5：安全加固 + Campaign 功能（约 3-5 天）

### 目标
引入 Helmet/CSP/CSRF、Docker healthcheck、结构化指标，同时新增 Campaign 功能（活动管理、多活动支持、按活动隔离数据）。

### 任务清单

#### 5A：安全加固（约 1-2 天）
- [ ] **Helmet + CSP**：在 `admin/middleware/security.js` 中集成 helmet
  - CSP：`scriptSrc: ["'self'", nonce]`, `styleSrc: ["'self'", "'unsafe-inline'"]`（管理后台样式依赖内联）
  - X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin
- [ ] **CSP nonce 注入**：每个 GET 请求生成 `crypto.randomBytes(16).toString('base64')` 注入 `res.locals.cspNonce`
- [ ] **CSRF 保护**：新建 `wa-bot/src/utils/csrfToken.js`（double-submit cookie 模式）
  - GET 响应注入 `csrfToken` 到 cookie + session
  - POST 校验 `x-csrf-token` header 或 `form._csrf` 与 session 一致
  - 每个视图模板 form 加隐藏字段 `<input type="hidden" name="_csrf" value="${csrfToken}">`
- [ ] **Docker HEALTHCHECK**：在 Dockerfile 添加 `HEALTHCHECK CMD wget -q --spider http://127.0.0.1:3000/health || exit 1`
- [ ] **安全 CI**：
  - 新建 `.github/workflows/security.yml`：npm audit + gitleaks-action + dependency-review-action（PR 触发）
  - 更新 `ci.yml`：加 `npm audit --audit-level=high`
- [ ] **错误追踪**：Express 错误中间件中生成 `traceId`（`req.id = crypto.randomUUID()`），所有 winston 输出含 traceId
- [ ] **PII 脱敏完善**：views 层 IC 显示改为 `XXXXXX-XX-****`（Excel 导出明文不变，业务需要）
- [ ] **CSP Report-Only 阶段**：先以 `Content-Security-Policy-Report-Only` 模式上线，观察 24h 无 violation 后切换 enforce

#### 5B：Campaign 功能（约 2-3 天）
- [ ] **Campaign 数据库迁移**：
  - `campaigns` 表：`id` (PK), `name` (TEXT UNIQUE), `brand` (TEXT), `start_date` (TEXT), `end_date` (TEXT), `min_amount` (INTEGER), `is_active` (INTEGER DEFAULT 1), `created_at` (TEXT)
  - `receipts` 表新增 `name` 字段（加在 `ic` 前面）、`campaign_id` 字段（外键 -> campaigns.id，可为 NULL）
  - `messageHandler.js` 修复图文混发 bug（同一消息含图片+文字时，IC 文字被忽略）
  - `messageHandler.js` 修复乱序发送 bug（先发收据再发 IC 时，第一张收据 ic 字段为 NULL，需回溯补填同 Session 的所有 NULL ic 记录）
- [ ] **Campaign Admin 管理界面**：
  - 新增 "活动管理" 导航入口（仅 super admin 可见）
  - Campaign 列表页：显示所有活动、状态（active/ended/upcoming）、操作按钮（编辑/删除/切换活跃）
  - Campaign 新建/编辑页：表单字段（name, brand, start_date, end_date, min_amount）
  - 切换活跃 Campaign：将 `is_active=1` 的改为 0，当前选中的改为 1（单例模式）
- [ ] **Bot 按活动隔离**：
  - `receiptHandler.js` 保存 receipt 时写入当前活跃 campaign_id
  - `sessionManager.js` 按 campaign 隔离 session（或共享 session，但 receipt 按 campaign 过滤）
  - Admin 后台按 campaign 筛选 receipt 列表
- [ ] **AI 自动识别**：
  - `receiptHandler.js` 在保存 receipt 后自动调用 `aiService.js` 识别金额
  - 识别结果写入 `ai_result_json`（现有字段复用）
  - Admin 后台显示 AI 识别金额，若 < min_amount 显示 warning 标识
  - AI 识别失败不影响流程，Admin 可人工审核
- [ ] **消息模板管理**（Campaign 高级功能，可后续迭代）：
  - Campaign 配置中含 "Reject 模板"（多条）
  - Admin 审核 reject 时可选择模板发送 WhatsApp 消息

### 成功标准
- CSRF 伪造跨站表单 POST 返回 403
- `docker inspect` 显示 healthcheck `healthy`
- CSP Report-Only 运行 24h 无 violation 报错
- security.yml CI 全绿
- Campaign 功能手动验收通过：
  - 创建 2 个 Campaign，分别上传 receipt，后台按 Campaign 筛选显示正确
  - 无活跃 Campaign 时 receipt 照常保存，Admin 后台显示 "无关联活动"
  - AI 自动识别金额，min_amount warning 正确显示

---

## 技术约束（已确认）
| 约束项 | 决策 |
|-------|------|
| 存储底座 | 引入 SQLite（`better-sqlite3`），替代 JSON 文件 |
| PII 合规 | 弱（日志/UI 脱敏，磁盘明文可接受） |
| 模板引擎 | 不引入（避免 SSR 渲染开销） |
| 拆分原则 | 只搬不改，逐路由等价 |
| 回滚策略 | 每个 Phase 独立 PR，独立可回滚 |
| Campaign 多活动 | 单例活跃模式（同一时间只有一个活跃 Campaign） |
| Bot 自动消息 | **禁止**——所有发给消费者的消息必须由 Admin 手动点击发送 |
| AI 识别 | 自动触发（receipt 提交后），不依赖 Admin 手动点击 |

---

## 已识别风险与缓解
| 风险 | 缓解 |
|------|------|
| SQLite 迁移不可逆 | 提供 `--dry-run` + 自动备份到 `data/backup/<timestamp>/` |
| adminServer.js 拆分引入回归 | Phase 3 集成测试必须先于 Phase 4 |
| CSP nonce 实现复杂 | 先 Report-Only 模式，观察 24h 无 violation 再 enforce |
| Campaign 功能影响现有流程 | 默认 campaign_id = NULL 兼容旧数据，逐步迁移 |
| 图文混发 + 乱序发送 bug 修复 | 先写测试覆盖两种场景，再修改 messageHandler.js |
| AI 自动识别失败 | 不阻塞流程，Admin 可人工审核（approve/reject） |
