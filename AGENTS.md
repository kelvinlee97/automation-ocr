# AGENTS.md - AI Agent 操作指南

本文件专为 AI Agent 提供项目操作规范。代码风格、技术偏好等通用规则见 `CLAUDE.md`，本文件不重复。

---

## 0. 文件访问边界（最高优先级）

**项目根目录**：`/Users/kelvinlee/Documents/projects/automation-ocr/`

**规则：**

- ✅ 允许读写项目根目录及其所有子目录下的文件
- ❌ 禁止访问项目目录以外的任何文件或路径（包括 `~/.ssh`、`~/.env`、其他项目目录、系统文件等）
- ⚠️ 如有充分理由必须访问项目目录以外的路径，**必须先暂停，向用户说明原因并请求明确授权**，未经授权不得执行

**请求授权格式**：

> 「我需要访问 `<路径>` 以 `<具体原因>`。是否授权？」

收到明确的「是」或「允许」才可继续，模糊回应视为拒绝。

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
- 任何「我看页面上…」「为什么显示…」类的问题

### 排查步骤

```
1. browser_navigate  → 打开目标页面（本地默认 http://localhost:3000）
2. browser_snapshot  → 获取 a11y 树，定位问题元素（优先于截图）
3. browser_evaluate / browser_console_messages → 检查 JS 错误
4. browser_network_requests → 检查接口请求和响应状态
5. browser_take_screenshot  → 记录视觉现象（需要截图存证时使用）
```

### 输出要求

排查完成后，必须给出：
- **现象**：Playwright 实际观察到的内容（截图 / 控制台输出 / 网络请求）
- **根因**：问题出在哪个环节（前端渲染 / 接口返回 / 状态异常）
- **修复建议**：基于实证的修改方案，不给猜测性结论
