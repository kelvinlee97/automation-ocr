# 命令速查表（Cheat Sheet）

> 写给第一次接触这个项目的同学。
>
> **核心规则**：99% 的开发命令都在 `wa-bot/` 目录下跑。根目录的 `package.json` 几乎是空的，别在那里跑 `npm test`。

---

## 🟢 快速开始（第一次拉代码）

```bash
# 1. 进入子项目目录
cd wa-bot

# 2. 安装依赖（只需要做一次，或 package.json 改了之后再跑）
npm install

# 3. 跑一遍测试，确认环境 OK
npm test
```

看到 `Tests: 103 passed` 就代表环境没问题。

---

## 🧪 测试相关

| 想做什么 | 命令 | 说明 |
|---------|------|------|
| 跑全部测试 | `npm test` | 大约 1 秒跑完，103 个用例 |
| 监听文件变更自动重跑 | `npm run test:watch` | 开发时常开一个终端 |
| 看测试覆盖率 | `npm run test:coverage` | 报告生成在 `coverage/` 目录 |
| 只跑一个文件 | `npx jest src/sessionManager.test.js` | 调试单个测试时用 |
| 按名字过滤用例 | `npx jest -t "sendMessageToUser"` | 只跑名字含关键词的用例 |
| 看详细失败信息 | `npx jest --verbose` | 默认输出已经够详细，必要时再加 |

**注意**：所有测试都不需要真实的网络/数据库/WhatsApp 账号，全部 mock。可以放心跑。

---

## 🔍 代码规范（Lint）

| 想做什么 | 命令 |
|---------|------|
| 检查代码风格 | `npm run lint` |
| 自动修复能修的部分 | `npx eslint src --ext .js --fix` |

**预期**：`npm run lint` 没有任何输出 = 通过。

---

## 🚀 本地启动 Bot

```bash
cd wa-bot

# 普通启动
npm start

# 开发模式（文件改动自动重启）
npm run dev
```

**前置条件**：
1. 在 `wa-bot/` 下创建 `.env` 文件，至少包含 `GEMINI_API_KEY=xxx`
2. 第一次启动会弹出 WhatsApp 二维码，需要用手机扫码登录

---

## 🐳 Docker 相关

> 所有 docker 命令在**项目根目录**跑（`automation-ocr/`），不是 `wa-bot/`。

| 想做什么 | 命令 |
|---------|------|
| 拉镜像 + 启动容器 | `docker compose up -d` |
| 看实时日志 | `docker compose logs -f wa-bot` |
| 停掉容器 | `docker compose down` |
| 重启容器（拉新镜像） | `docker compose pull && docker compose up -d` |
| 进入容器内部排查 | `docker compose exec wa-bot sh` |

**数据存放位置**：
- 收据图片 / Excel：宿主机 `./data/`，容器内 `/opt/automation-ocr/data/`
- WhatsApp 登录凭据：`./data/wwebjs_auth/`（删除 = 强制重新扫码）

---

## 🌳 Git 常用

| 想做什么 | 命令 |
|---------|------|
| 看当前改了啥 | `git status` |
| 看改动的具体内容 | `git diff` |
| 查最近 5 条提交 | `git log --oneline -5` |
| 暂存所有改动 | `git add -A` |
| 提交 | `git commit -m "你的说明"` |
| 推送 | `git push` |
| 撤销未提交的改动（危险） | `git checkout -- <文件>` |

---

## 📋 一键自检（提交前跑一遍）

```bash
cd wa-bot && npm test && npm run lint
```

两个都过 → 可以放心提交。任一失败 → 先修，别提交。

---

## 📁 常用文件位置

| 想找什么 | 路径 |
|---------|------|
| 项目路线图 | `plan.md` |
| 项目规范 | `AGENTS.md` |
| Bot 主入口 | `wa-bot/src/index.js` |
| 管理后台代码 | `wa-bot/src/admin/`（已 Phase 4 拆分） |
| 配置文件 | `config/config.yaml` |
| 业务逻辑（service） | `wa-bot/src/services/` |
| 单元测试 | `wa-bot/src/**/__tests__/` 或 `*.test.js` |
| 命令速查（本文件） | `commands/cheatsheet.md` |

---

## ❓ 常见问题

**Q: `npm test` 跑不起来，报模块找不到？**
A: 先 `cd wa-bot && npm install`，根目录跑没用。

**Q: 改了代码但容器里没生效？**
A: 容器跑的是预构建镜像，本地改动不会同步。要么本地 `npm start` 跑，要么重新构建镜像。

**Q: 二维码扫了登录后又掉线？**
A: 检查 `data/wwebjs_auth/` 是否有写权限。Docker 模式下检查 volume 挂载是否正常。

**Q: 测试通过但 lint 失败？**
A: 跑 `npx eslint src --ext .js --fix` 让它自动修，剩下的看报错信息手动改。
