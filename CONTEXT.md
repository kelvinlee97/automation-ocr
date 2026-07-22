# CONTEXT.md — ClaimFlow 域术语表

> 本文件是域语言的单一真相来源。只包含业务概念的定义，不含实现细节。
> 格式：每个术语一个 `##` 标题，定义 + 边界 + 与其他术语的关系。

---

## Receipt（收据记录）

**定义**：消费者通过 WhatsApp 发起的一次"提交收据"行为所产生的记录。一次提交对应一条 Receipt。

**边界**：
- 一条 Receipt 对应消费者发送的一张收据图片（或一条含图片的消息）
- Receipt 包含 `phone`（提交人手机号）、`name`（消费者姓名）、`ic`（身份证号，可为 null）、`image_filename`、`status`、`submitted_at` 等字段
- `name` 和 `ic` 可能在第一条 Receipt 创建时为 null，后续消费者发 IC/名字后回溯补填（同一 Session 内）
- Receipt 的生命周期：`pending_review` → `approved` / `rejected`

**与其他术语的关系**：
- 一个 Session 可以产多个 Receipt（用户同一天可以提交多次）
- Receipt 的审核动作发生在 Admin 后台，不在 Bot 对话流程内

---

## Session（对话流程）

**定义**：一个消费者手机号与 Bot 之间的一次活跃对话流程，从用户首次发消息开始，到流程完成（或超时）结束。

**边界**：
- Session 由 `phone` 唯一标识（主键）
- Session 有 `state` 字段，表示对话状态机当前状态
- 状态机：`WAITING_IC` → `WAITING_RECEIPT` → `DONE`（Bot 被动模式：不主动欢迎，但收到消息后仍有状态推进逻辑）
- Session 有 `receipt_count` 和 `receipt_count_date`，用于每日提交次数限制
- Session 超时或完成后，下次用户发消息会创建新 Session
- 同一 Session 内，消费者发 IC/名字后，系统回溯将本 Session 内 `ic=null`/`name=null` 的 Receipt 补填

**与其他术语的关系**：
- Session 持有当前用户的 `ic` 和 `name`，关联到该 Session 内提交的所有 Receipt
- Session 是 Bot 侧概念，Admin 后台不直接操作 Session

---

## Campaign / Activity（活动）

**定义**：品牌方发起的一次促销 Campaign（如"Samsung 6月促销"），是消费者参与收据提交的业务容器。

**边界**：
- 一个 Campaign = 一个品牌（1:1 关系）
- 一个 Campaign 有规则：品牌（brand）、最低金额（min_amount，固定 MYR）、有效时间窗口（start_date, end_date）、是否激活（is_active）
- Campaign 字段固定：`id, brand, start_date, end_date, min_amount, is_active`（`brand` 是自由文本，不预设列表）
- **Receipt 与 Campaign 的关联**：写入 Receipt 时系统查询 `campaigns` 表，找 `start_date <= NOW() <= end_date` 且 `is_active=1` 的 Campaign，取第一个，将 `campaign_id` 写入 Receipt 记录（**写入时确定，后续不改**）
- 无活跃 Campaign 时 Receipt 照常保存（`campaign_id = NULL`），Bot 不发送任何消息给消费者
- 同一时间只有一个活跃 Campaign（时间不重叠）；不同 Campaign 用不同 WhatsApp 号码区隔
- Campaign 可编辑、新增、删减（Super Admin 后台 CRUD 管理）
- Campaign 配置存入数据库（`campaigns` 表），不再用 `config.yaml` 静态配置
- Campaign 是高度客制化的——字段内容按具体客户需求填写，不追求通用化

**与其他术语的关系**：
- 一个 Deployment（部署实例）对应一个 WhatsApp 号码，对应一个 Campaign
- Receipt 表有 `campaign_id` 字段（外键关联 campaigns.id）
- Campaign 的规则（品牌、min_amount 等）决定 Receipt 是否有效

---

## Brand（品牌）

**定义**：活动所关联的品牌（如 Samsung、Philips），Receipt 上的商户品牌需与活动的品牌白名单匹配。

**边界**：
- Brand 是 Campaign 的属性（一个 Campaign 一个 Brand）
- 品牌白名单用于验证 Receipt 上的商户是否属于该品牌

---

## Admin（管理后台）

**定义**：运营人员用来审核 Receipt、管理用户、管理 Campaign、查看 WhatsApp 连接状态的内部 Web 界面。

**边界**：
- 路径前缀 `/admin`
- 需要登录（用户名/密码），有 session 认证
- **权限分级**：
  - **Super Admin**：能操作所有功能（审核 Receipt、管理 Campaign、管理 AdminUser、配置消息模板）
  - **普通 Admin**：只能审核 Receipt（查看列表 + approve/reject + 手动发送消息），能看到当前 Campaign 信息（只读）和 Reject 模板内容（不能编辑）
- 普通 Admin 登录后，后台顶部显示当前 Campaign 名称 + 有效期，另有"活动信息"页面可查看详情（只读）
- 多 Campaign 切换：后台顶部有 Campaign 切换下拉菜单，选哪个 Campaign 就显示哪个的 Receipt 列表
- 核心操作：查看 Receipt 列表、AI 识别、人工审核（approve/reject）、手动发送 WhatsApp 消息给消费者、导出 Excel、管理 Campaign（Super Admin）、管理 AdminUser（Super Admin）、配置消息模板（Super Admin）

**与其他术语的关系**：
- Admin 操作的对象是 Receipt（审核）、AdminUser（用户管理）、Campaign（活动管理）、MessageTemplate（消息模板）
- Admin 不直接操作 Session（Session 是 Bot 侧概念）

---

## AdminUser（后台管理员）

**定义**：有权登录 Admin 后台的人员账号。

**边界**：
- 存储在 `admin_users` 表，字段：`username`（PK）、`password_hash`、`created_at`、`is_super_admin`（boolean，默认 false）
- 首个注册的 AdminUser 默认为 Super Admin（`is_super_admin = 1`）
- 密码使用 scrypt 哈希存储
- **权限分级**：
  - **Super Admin**（`is_super_admin = 1`）：能操作所有功能（审核 Receipt、管理 Campaign、管理 AdminUser、配置消息模板）
  - **普通 Admin**（`is_super_admin = 0`）：只能审核 Receipt（查看列表 + approve/reject + 手动发送消息），能看到当前 Campaign 信息和 Reject 模板内容（只读，不能编辑）
- 与业务侧的"消费者"无任何关联（消费者没有 AdminUser 账号）

**与其他术语的关系**：
- AdminUser 是 Admin 后台的登录主体
- Super Admin 能管理 Campaign 和 MessageTemplate
- 与 Receipt/Consumer 无直接关系

---

## Consumer（消费者）

**定义**：通过 WhatsApp 提交收据的个人，由手机号（`phone`）唯一标识。

**边界**：
- 手机号是 Consumer 的唯一标识，不考虑同一人换号的情况（业务上不处理）
- Consumer 不是独立表——Consumer 的信息分散在 `receipts`（提交记录）和 `sessions`（对话状态）里，通过 `phone` 关联
- Admin 后台可按手机号查看该消费者的所有 Receipt

**与其他术语的关系**：
- 一个 Consumer 可以有多个 Session（不同时间段的对话流程）
- 一个 Consumer 可以有多个 Receipt（多次提交）
- 一个 Consumer 的 Receipt 可属于不同 Campaign（不同时间参加不同活动）

---

## IC / 身份证号

**定义**：马来西亚身份证号（Identity Card number），格式为 `XXXXXX-XX-XXXX`（12位数字，用连字符分隔）。

**边界**：
- 消费者在 Bot 对话中通过发送 IC 图片或文字进行注册
- IC 被解析后存入 Session，并回溯关联到该 Session 内 `ic=null` 的所有 Receipt
- Admin 后台显示 IC 时会脱敏为 `XXXXXX-XX-****`（Phase 5 要求）

---

## AI Recognition（AI 识别）

**定义**：Receipt 提交后 Bot 自动触发的行为——对 Receipt 图片调用 Google Gemini Vision API，返回结构化识别结果（金额、日期、商户、收据号等）。

**边界**：
- Bot 在消费者提交收据图片后自动调用 AI 识别（不需要 Admin 手动触发）
- 识别结果存入 Receipt 的 `ai_result_json` 字段
- **Warning 自动检测**：系统自动检测以下问题并打 warning 标识：
  - W1：收据图片模糊
  - W2：收据信息不完整（缺少商户名/日期/金额等关键字段）
  - W3：缺少 IC（Receipt.ic = null 或 Session.ic = null）
  - W4：缺少收据号（AI 识别不到收据上的单号/参考号）
- Warning 是自动的，不需要 Admin 手动标记
- 识别失败不影响业务流程，Admin 可人工审核（approve/reject）
- AI 识别是辅助手段，最终审核决定权在 Admin 人工操作
- **所有 AI 识别字段都可编辑**：Admin 在 Receipt 列表页点"编辑"按钮，弹出表单修改（IC、名字、金额、商户名/品牌、收据日期、收据号）

---

## Review（审核）

**定义**：Admin 用户对 Receipt 进行的人工审核动作，结果为 `approved` 或 `rejected`。

**边界**：
- Approve：Receipt 状态变为 `approved`，**系统不自动发消息**给消费者（Admin 可手动发送）
- Reject：Receipt 状态变为 `rejected`，**系统不自动发消息**，Admin 需手动点击发送（使用预设 Reject 模板）
- 审核后 Receipt 状态不可再变更（当前实现）
- **Bot 绝对不能自动发消息给消费者**——所有发给消费者的消息必须由 Admin 手动点击发送

---

## Export（导出）

**定义**：Admin 用户将 Receipt 数据导出为 Excel 文件的操作。

**边界**：
- 导出格式为 `.xlsx`，包含 Receipt 的关键字段（含 IC 明文，业务需要）
- 导出操作本身不修改 Receipt 状态

---

## WhatsApp Client（WhatsApp 客户端）

**定义**：通过 `whatsapp-web.js` 库建立的 WhatsApp 连接，用于接收消费者消息。

**边界**：
- **多 Client 架构**：一个 Node.js 进程支持多个 WhatsApp Client 同时在线（每个 Campaign 一个 Client）
- 每个 Client 用独立的 `clientId`（LocalAuth 支持），session 文件存在 `.wwebjs_auth/session-<clientId>/`
- 连接状态按 Campaign 存储
- QR 码按 Campaign 独立显示（URL 带 `campaign_id` 参数）
- Bot **绝对不能自动发消息给消费者**——所有发给消费者的消息必须由 Admin 手动点击发送
- 使用非官方 WhatsApp Web 协议，存在封号风险（已在 plan.md A.5 注明）
- 同时运行 1-2 个 Client（小规模，内存够用）

---

## Deployment（部署实例）

**定义**：一套独立运行的 ClaimFlow 系统，支持多个 WhatsApp 号码、多个 Campaign、多租户数据隔离。

**边界**：
- 一套代码一个 Node.js 进程，支持多个 WhatsApp Client 同时在线（每个 Campaign 一个 Client）
- 不同 Campaign 用不同 WhatsApp 号码区隔（消费者加哪个号就参加哪个活动）
- 数据按 Campaign 隔离（`receipts.campaign_id` 关联 `campaigns.id`）
- 同一时间只有一个活跃 Campaign（时间不重叠）

---

## Message Template（消息模板）

**定义**：Admin 配置的、用于向消费者发送 WhatsApp 消息的预设模版。每个 Campaign 可以有自己的模板。

**边界**：
- 模板由 Admin 在后台配置，可编辑、可反复使用
- 模板与 Campaign 关联（不同 Campaign 可有不同模板）
- 当前确认的模板类型：**Reject 模板**（审核拒绝时 Admin 手动选择发送）
- Approve 不发送消息（不需要模板）
- 收到 Receipt 后 Bot 不发送确认消息（不需要模板）
- 所有发给消费者的消息必须由 Admin 手动点击发送，Bot 不能自动发送

---

## Receipt Modification（收据修改记录）

**定义**：Admin 手动编辑 Receipt 字段后，系统自动记录的修改历史。

**边界**：
- 存储在 `receipt_modifications` 表，字段：`id, receipt_id, modified_at, modified_by, field_name, old_value, new_value`
- 修改历史在 Receipt 列表页的展开面板（`buildExpandPanel`）里显示
- 不需要 M6（`note` 字段），Admin 不需要填修改原因

---

## 待确认 / 待设计

- **图文混发处理方案**——当前 `messageHandler.js` 不能处理图文混发（同一条消息含图片+文字），IC 文字会被忽略。Phase 5-6 需要修复，但具体修复方案（路由逻辑怎么改）尚未设计。
- **Reject 消息模板的编辑界面**——模板是纯固定文字（不支持变量），Super Admin 在 Campaign 管理页添加/编辑/删除 Reject 模板。具体 UI 设计尚未确认。
- **多 WhatsApp Client 架构的启动顺序**——多个 Client 同时初始化会不会互相影响（Chromium 资源竞争）？需要确认。
- **普通 Admin 能看到哪个 Campaign**——普通 Admin 登录后默认看到哪个 Campaign？是分配固定的，还是能看到所有 Campaign（只读）？尚未确认。
