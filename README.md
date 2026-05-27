# 📱 WhatsApp 收据审核系统

> 消费者通过 WhatsApp 提交收据截图，AI 自动识别金额和品牌，工作人员在管理后台一键审核并发送结果消息。

---

## 这个系统能做什么？

马来西亚促销活动（如电器返现）通常要求消费者提交收据证明资格。传统方式靠人工逐张核对，费时且容易出错。

**这个系统把流程变成：**

1. **消费者** 在 WhatsApp 发送身份证号和收据截图
2. **系统** 自动保存并用 AI（Gemini 2.5）识别收据中的品牌和金额
3. **工作人员** 登录管理后台，查看 AI 提取结果，确认后一键发送审核结果给消费者
4. **记录** 自动写入 Excel 存档

---

## 使用流程

### 消费者端（WhatsApp）

| 步骤 | 消费者操作 | 系统响应 |
|------|-----------|---------|
| 1 | 发送身份证号（格式：XXXXXX-XX-XXXX） | 验证格式，提示发送收据 |
| 2 | 发送收据截图 | 确认已收到，通知等待审核 |
| 3 | 等待 | 工作人员审核后收到结果消息 |

### 工作人员端（管理后台）

1. 登录 `https://你的域名/admin`
2. 在收据审核页查看所有提交记录
3. 点击「AI 提取」查看识别结果（品牌、金额）
4. 输入要发给消费者的消息，点击「发送给用户」

---

## 状态说明

| 状态 | 含义 |
|------|------|
| 🟡 待 AI 提取 | 消费者已提交，尚未进行 AI 识别 |
| 🔵 待发消息 | AI 已识别完成，等待工作人员发送结果 |
| 🟢 已发送 | 工作人员已发送审核结果给消费者 |
| 🔴 已拒绝 | 已拒绝该收据 |

---

## 业务规则配置

所有规则集中在 **`config/config.yaml`**，修改后重启服务生效，无需改代码：

```yaml
eligibility:
  eligible_brands:        # 品牌白名单（直接增减品牌名）
    - "Samsung"
    - "Apple"
    - "Dyson"
    - "Panasonic"
    - "Sony"
  minimum_amount: 500.00  # 最低消费金额（马币 RM）

bot:
  session_timeout_minutes: 30   # 消费者提交超时时间（分钟）
  max_receipts_per_day: 5       # 每人每天最多提交次数
```

---

## Excel 记录

系统自动维护两张表（路径：`data/excel/records.xlsx`）：

| Sheet | 内容 |
|-------|------|
| Registrations | 所有注册用户：手机号、身份证、注册时间 |
| Receipts | 所有收据：单据号、品牌、金额、审核结果、AI 置信度 |

---

## 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `GEMINI_API_KEY` | ✅ | Google Gemini AI 密钥，用于识别收据 |
| `SESSION_SECRET` | ✅ | 管理后台登录会话密钥，重启后保持登录状态 |
| `NODE_ENV` | - | 设为 `production` 启用生产模式 |

---

## 部署（EC2 一键脚本）

> 已经在跑的步骤会自动 skip，重复执行安全。新手照做即可，不用一个个看脚本。

### 首次部署（全新 Ubuntu EC2 实例）

1. **准备 EC2 实例**
   - Ubuntu 22.04 / 24.04（LTS）
   - 安全组放行 22（SSH）；如需外部访问 web，再开 80/443
   - 在 EC2 上生成 SSH key（`ssh-keygen`）并把公钥加到 GitHub deploy keys

2. **SSH 上去，先装 git 把代码拉下来**（鸡生蛋问题：脚本本身在仓库里）
   ```bash
   sudo apt-get update && sudo apt-get install -y git
   git clone git@github.com:kelvinlee97/automation-ocr.git /home/ubuntu/automation-ocr
   cd /home/ubuntu/automation-ocr
   ```

3. **创建 `.env` 文件**（必填项）
   ```bash
   cat > .env <<EOF
   GEMINI_API_KEY=<你的 Gemini key>
   SESSION_SECRET=$(openssl rand -hex 32)
   EOF
   ```

4. **一键跑**
   ```bash
   bash scripts/bootstrap.sh
   ```
   脚本会按顺序做（每一步先检测、已就绪则 skip）：
   - 装 docker / compose plugin / git
   - 把当前用户加进 docker 组
   - `docker compose pull && up -d` 启动容器
   - 打印容器状态

5. **首次启动扫 WhatsApp 二维码**
   ```bash
   bash scripts/docker.sh logs   # 看日志里的二维码 / 配对码
   ```
   或访问 `https://你的域名/admin/qr` 扫码。

### 日常更新（已部署过的实例）

```bash
bash scripts/bootstrap.sh        # 拉新代码 + 拉新镜像 + 重启容器，已就绪的步骤自动 skip
```

### 进阶：只跑某一段

```bash
bash scripts/bootstrap.sh system   # 只装系统依赖
bash scripts/bootstrap.sh deploy   # 只做项目部署（拉代码 → .env 校验 → 启容器）
```

### CI/CD

项目已配置 GitHub Actions，推送到 `main` 分支自动触发部署，无需手动跑脚本。

---

## 目录结构

```
automation-ocr/
├── config/
│   └── config.yaml              ← 业务规则（品牌白名单、金额门槛）
├── infra/
│   ├── nginx/                   ← Nginx 反代 + HTTPS 配置
│   └── stack.yml                ← Docker Swarm/编排配置
├── scripts/                     ← 项目级脚本（按用途拆分）
│   ├── bootstrap.sh             ← EC2 一键部署（幂等，已就绪自动 skip）
│   ├── setup.sh                 ← 本地初始化（依赖安装、环境检查）
│   ├── start.sh                 ← 启动服务
│   ├── docker.sh                ← Docker 相关操作
│   ├── test.sh / check.sh / lint.sh
├── rules/RULES.md               ← 项目规则（贡献者必读）
├── skills/                      ← AI 协作技能定义
├── wa-bot/                      ← 主应用（Node.js）
│   ├── index.js                 ← 入口：db.init → migrate → session → Express → Bot
│   ├── Dockerfile
│   ├── jest.config.js
│   ├── scripts/                 ← 一次性脚本/迁移工具
│   │   ├── migrate-excel-path.sh        ← Phase 1 路径迁移
│   │   ├── migrate-json-to-sqlite.js    ← Phase 2 JSON→SQLite 迁移
│   │   ├── seed-test-data.js
│   │   ├── simulate-user.js
│   │   └── wa-simulator.js
│   └── src/
│       ├── bot.js               ← WhatsApp 客户端
│       ├── messageHandler.js    ← 消息路由
│       ├── adminServer.js       ← 兼容导出（实际逻辑在 admin/）
│       ├── sessionManager.js    ← 用户会话状态（SQLite）
│       ├── db/
│       │   ├── index.js         ← SQLite 单例（better-sqlite3, WAL）
│       │   └── schema.sql       ← 3 表：receipts / sessions / admin_users
│       ├── admin/               ← Phase 4 拆分后的管理后台
│       │   ├── server.js
│       │   ├── state.js
│       │   ├── middleware/      ← auth / rateLimit / security / session
│       │   ├── routes/          ← auth / receipts / users / whatsapp / export
│       │   ├── views/           ← layout / login / qr / receipts / users / escapeHtml
│       │   ├── static/          ← admin.css / admin.js / qr.js / theme-init.js
│       │   ├── i18n/            ← zh / en / index
│       │   └── __tests__/       ← 路由集成测试
│       ├── handlers/
│       │   ├── registrationHandler.js   ← 注册流程
│       │   └── receiptHandler.js        ← 收据提交流程
│       ├── services/
│       │   ├── aiService.js             ← Gemini AI 识别
│       │   ├── excelService.js          ← Excel 导出
│       │   ├── receiptStore.js          ← 收据 CRUD（SQLite）
│       │   └── adminUserService.js      ← 管理员账户（SQLite + scrypt）
│       ├── utils/
│       │   ├── icParser.js              ← 身份证号解析
│       │   ├── maskPhone.js             ← PII 脱敏
│       │   └── logger.js                ← Winston 日志
│       └── **/__tests__/                ← 各模块单元测试
├── data/                        ← 运行数据（自动创建，不入版本控制）
│   ├── app.db                   ← SQLite 数据库
│   ├── excel/records.xlsx       ← Excel 导出
│   ├── images/                  ← 收据图片备份
│   └── wwebjs_auth/             ← WhatsApp 登录凭证
├── docker-compose.yml
├── plan.md                      ← 项目优化计划（Phase 1-6）
└── .env                         ← 环境变量（不入版本控制）
```

---

## 常见问题

**Q：AI 提取失败，提示 403 Forbidden**

`GEMINI_API_KEY` 未正确注入容器。执行 `docker compose up -d` 重建容器（`restart` 不会重新读取 `.env`）。

**Q：容器重启后需要重新扫码**

确认 `docker-compose.yml` 中已挂载 `./data/wwebjs_auth:/app/.wwebjs_auth`，且 `SESSION_SECRET` 已设置。

**Q：手机号显示带 `@lid` 或 `@c.us`**

管理后台已自动裁剪，如仍出现请更新到最新版本。

---

## 注意事项

- `data/wwebjs_auth/` 含 WhatsApp 登录凭证，**切勿提交到版本控制或泄露**
- 本项目使用 [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) 非官方库，建议使用**专用号码**而非个人主号，存在封号风险
- 定期备份 `data/` 目录

---

## License

MIT
