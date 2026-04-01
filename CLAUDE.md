# CLAUDE.md - 项目配置

通用规则（语言、风格、工作流、环境约定）见全局 `~/.claude/CLAUDE.md`，本文件只补充项目特有内容。

---

## 会话开始必读

**每次会话开始时，必须先读取 `AGENTS.md`**，其中包含文件访问边界、Git 工作流、浏览器排查等强制规范。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Node.js ≥ 20（使用原生 `--watch`，无需 nodemon） |
| WhatsApp | whatsapp-web.js |
| AI / OCR | @google/generative-ai（Gemini） |
| Excel | exceljs |
| Web 后台 | Express + express-session + session-file-store |
| 日志 | winston（不用 console.log） |
| 测试 | Jest + supertest |
| 配置 | js-yaml（读取 `wa-bot/config/config.yaml`） |

---

## 项目约束

- **日志**：业务逻辑一律用 `winston`，禁止 `console.log`（测试代码除外）
- **配置**：运行时参数从 `wa-bot/.env` 和 `wa-bot/config/config.yaml` 读取，不硬编码
- **数据持久化**：所有数据文件写入 `data/` 目录，路径通过 `DATA_DIR` 环境变量注入，支持 Docker 卷挂载
- **WhatsApp 凭证**：`wa-bot/.wwebjs_auth/` 已 gitignore，不能提交，Docker 需外部卷
- **端口**：管理后台端口由 `ADMIN_PORT` 环境变量控制，默认 3000；生产环境经 Nginx 反代，不直接暴露

---

## 测试

```bash
cd wa-bot
npm test               # 单次运行
npm run test:watch     # 监听模式
npm run test:coverage  # 覆盖率报告
```

- 测试文件与源文件同目录，命名 `*.test.js`
- 外部依赖（文件系统、Gemini API）必须 mock，不发真实请求
- 新功能必须附带测试，bugfix 必须附带回归测试

---

## 代码检查

```bash
cd wa-bot && npm run lint
```
