# Project Gemini Context: WhatsApp OCR Verification System

本项目是一个 WhatsApp OCR 收据验证系统。AI Agent 在此项目中的操作必须遵守以下强制规范。

---

## 0. 文件访问边界 (最高优先级)

- **项目根目录**: `/Users/kelvinlee/Documents/projects/automation-ocr/`
- **规则**: 严禁读写项目目录以外的任何文件。如需执行影响外部资源的命令或访问外部路径，必须向用户说明原因并请求授权。

---

## 1. 技术栈与环境

- **语言**: Node.js ≥ 20 (原生 `--watch`)
- **AI**: @google/generative-ai (Gemini 2.0 Flash)
- **数据库**: 基于文件的 JSON 存储 (`data/sessions.json`, `data/admin_users.json`)
- **日志**: 使用 `winston` 库，禁止在业务逻辑中使用 `console.log`
- **测试**: Jest + supertest (外部依赖必须 mock)
- **沙盒限制**: **禁止执行 `docker` 相关命令** (沙盒环境不支持)，仅允许使用 `npm test` 和 `npm run lint` 进行验证。

---

## 2. 强制工作流: Git Worktree

所有代码改动（功能/bugfix/重构）必须在独立 worktree 中进行，禁止在 `main` 分支直接修改代码。

1. **创建**: `git worktree add .worktrees/<branch-name> -b <branch-name> origin/main`
2. **开发**: 进入 `.worktrees/<branch-name>` 目录
3. **提交**: 在 worktree 目录内提交并 push
4. **清理**: PR 合并后回到根目录执行 `git worktree remove`

---

## 3. 常用命令

- **测试**: `cd wa-bot && npm test`
- **Lint**: `cd wa-bot && npm run lint`
- **Docker**: `docker compose up -d --build`

---

## 4. 数据与配置路径

- **配置**: `wa-bot/config/config.yaml`
- **Excel 数据**: `data/excel/`
- **收据图片**: `data/receipts/`
- **敏感数据**: `wa-bot/.env` (参考 `.env.example`)

---

**备注**: 本文件补充并整合了 `AGENTS.md` 和 `CLAUDE.md` 的核心规范，Gemini CLI 将以此为准执行任务。
