# AGENTS.md - AI Agent 操作指南

本文件专为 AI Agent 提供项目操作规范。代码风格、技术偏好等通用规则见 `CLAUDE.md`，本文件不重复。

---

## 0. 文件访问边界（最高优先级）

**项目根目录**：仓库根目录（即 `.git` 所在目录），本地路径为 `/Users/kelvinlee/Documents/projects/automation-ocr/`

**规则：**

- ✅ 允许读写项目根目录及其所有子目录下的文件
- ❌ 禁止主动读写项目目录以外的任何文件（包括 `~/.ssh`、`~/.env`、其他项目目录、系统文件等）
- ❌ 禁止执行可能影响项目目录以外资源的系统命令（对外网络请求除外）；如需执行，同样须请求授权
- ✅ Git 命令对 `~/.gitconfig` 等配置的隐式读取不受此规则约束，仅限 Agent 主动的文件读写操作
- ⚠️ 如有充分理由必须访问项目目录以外的路径，**必须先暂停，向用户说明原因并请求明确授权**，未经授权不得执行

**请求授权格式**：

> 「我需要访问 `<路径>` 以 `<具体原因>`。是否授权？」

收到含义为"同意/允许"的明确回应才可继续；若回应含义不明确，重新询问确认，不得自行推断为授权。

---

## 1. 项目概述

WhatsApp OCR 收据验证系统。用户通过 WhatsApp 提交马来西亚身份证号和收据截图，系统使用 Gemini AI 识别收据、验证资格，结果写入 Excel。

**数据存储路径**：

| 类型 | 路径 |
|------|------|
| 会话状态 | `data/sessions.json` |
| 收据图片 | `data/receipts/` |
| Excel 记录 | `data/excel/records.xlsx` |
| 管理凭据 | `data/admin_users.json` |
| WhatsApp 凭证 | `wa-bot/.wwebjs_auth/`（已 gitignore） |
| 业务配置 | `wa-bot/config/config.yaml` |
| 环境变量 | `wa-bot/.env`（需自建，参考 `.env.example`） |

---

## 2. 常用命令

```bash
# 开发模式（文件变更自动重启）
cd wa-bot && npm run dev

# 生产启动
cd wa-bot && npm start

# 测试
cd wa-bot && npm test
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

---

## 3. 代码架构

### 目录结构

```
wa-bot/src/
├── index.js                # 入口
├── bot.js                  # WhatsApp 客户端
├── adminServer.js          # 管理后台（Express）
├── sessionManager.js       # 会话状态机（JSON 文件存储）
├── messageHandler.js       # 消息路由
├── handlers/               # 业务处理器
├── services/               # 业务服务（gemini、excel 等）
└── utils/                  # 工具函数
```

### 会话状态机

```
        用户发起
           │
           ▼
        [IDLE]
           │  收到消息
           ▼
   [WAITING_IC]  ← 等待身份证号
           │  IC 验证通过
           ▼
[WAITING_RECEIPT] ← 等待收据截图
           │  收到图片
           ▼
    [PROCESSING]  ← Gemini OCR 处理中
           │
     ┌─────┴─────┐
     ▼           ▼
[COMPLETED]  [FAILED]
```

### 数据流（收据处理）

```
用户上传图片
  → messageHandler.js（路由分发）
  → handlers/receiptHandler.js（业务入口）
  → services/geminiService.js（OCR 识别）
  → services/excelService.js（写入记录）
  → sessionManager.js（更新会话状态）
  → 回复用户结果
```

---

## 4. Git Worktree 标准工作流

> **强制规则**：所有代码改动（功能开发 / bugfix / 重构）必须在独立 worktree 中进行。
> 禁止在主工作区（main 分支）直接修改代码。
> 目录约定：`.worktrees/<branch-name>`

### Step 1 — 创建 worktree

```bash
git fetch origin
git worktree add .worktrees/<branch-name> -b <branch-name> origin/main
```

### Step 2 — 进入 worktree 开发

```bash
cd .worktrees/<branch-name>
# 如有新增依赖
cd wa-bot && npm install
```

### Step 3 — 提交改动

```bash
# 在 worktree 目录内操作
git add <files>
git commit -m "feat/fix: 描述改动"
git push origin <branch-name>
```

### Step 4 — 创建 PR（强制）

```bash
gh pr create --title "..." --body "..."
# 等待 code review 通过后合并
```

### Step 5 — 清理 worktree

```bash
# PR 合并后，回到项目根目录执行
git worktree remove .worktrees/<branch-name>
git branch -d <branch-name>
```

### 禁止事项

- ❌ 在 `.worktrees/` 内执行 `git checkout` 切换分支
- ❌ 多个任务共用同一个 worktree
- ❌ 未清理旧 worktree 时重复创建同名分支
- ❌ 跳过 PR 直接合并到 main

---

## 5. 注意事项

1. WhatsApp 登录凭证存于 `wa-bot/.wwebjs_auth/`，已 gitignore，Docker 部署需挂载外部卷持久化
2. 会话数据 `data/sessions.json` 同上，Docker 需挂载外部卷
3. Gemini API 失败返回 `retryable: true`，代表可安全重试，不应标记为最终失败
4. 当 AI Agent 在当前会话消耗了 100,000 tokens 时，自动执行 compact

---

## 6. 浏览器排查规范（Playwright）

**触发条件**：凡用户询问任何可通过浏览器验证的问题，必须调用 Playwright 工具实地排查，不得仅凭代码推断。涵盖但不限于：

- 前端页面渲染异常（布局错位、元素不显示、样式问题）
- 管理后台（`adminServer.js` 提供的 Express 界面）功能是否正常
- 表单提交、按钮点击等交互行为
- API 接口的浏览器端请求/响应（Network 面板验证）
- 页面跳转、权限拦截、登录态校验
- Console 报错、JS 异常

**前置检查**：排查前先确认目标服务是否运行（`curl -s -o /dev/null -w "%{http_code}" http://localhost:<PORT>`）。若服务未启动，告知用户后停止，不继续走排查流程。若代码层面已能确定根因（如明确的语法错误），可跳过浏览器排查，但须说明理由。

**访问地址**：
- 本地开发（`npm run dev`）：`http://localhost:<PORT>`（端口查 `wa-bot/.env` 中的 `ADMIN_PORT`，默认 3000）
- Docker 生产环境：由宿主机 Nginx 反代，通过 `http://localhost:80` 或配置域名访问，不直连 3000 端口

### 排查步骤

1. **导航**：打开目标页面；若页面需要认证，从 `data/admin_users.json` 取测试凭据完成登录
2. **快照**：获取页面 a11y 树，定位问题元素（优先于截图，语义更精准）
3. **控制台**：读取已输出的错误/警告日志
4. **JS 探查**：主动执行 JS 检查运行时状态（如变量值、DOM 属性）
5. **网络**：检查接口请求和响应状态码/内容
6. **截图**：记录视觉现象（需存证时使用）

> 以上步骤对应当前环境挂载的 Playwright MCP 工具，Agent 按功能描述自行匹配可用工具名。

### 输出要求

排查完成后，必须给出：
- **现象**：Playwright 实际观察到的内容（截图 / 控制台输出 / 网络请求）
- **根因**：问题出在哪个环节（前端渲染 / 接口返回 / 状态异常）
- **修复建议**：基于实证的修改方案，不给猜测性结论
