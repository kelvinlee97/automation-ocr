# 📱 WhatsApp OCR 收据验证系统

> 通过 WhatsApp 自动收集消费收据、OCR 识别验证资格、结果写入 Excel — 全程无需人工介入。

---

## 为什么做这个项目？

马来西亚许多品牌促销活动（如三星、戴森、苹果等电器购买返现）需要消费者提交收据证明资格。传统方式是：

**消费者拍照 → 微信/邮件发给工作人员 → 人工肉眼核对品牌和金额 → 手动记录 Excel**

当参与人数达到数百甚至数千时，这个流程极其耗费人力，且容易出错（漏记、重复记录、金额读错）。

这个项目把整个流程自动化：消费者只需在 **WhatsApp** 上提交身份证号和收据截图，系统在 30 秒内完成识别、验证和记录，无需任何人工介入。

---

## 它能做什么？

```
用户发消息给 WhatsApp Bot
       │
       ▼
① 提交身份证号（XXXXXX-XX-XXXX）
       │  格式验证 + 去重检查
       ▼
② 注册成功 → 发收据截图
       │
       ▼
③ AI 自动识别：品牌 / 消费金额 / 单据号
       │
       ├─ ✅ 合格（品牌在白名单 + 金额 ≥ RM500）
       │       → 回复"恭喜通过，单据号 xxx，金额 RM xxx"
       │       → 写入 Excel Sheet2（合格记录）
       │
       └─ ❌ 不合格（品牌不符 / 金额不足 / 图片模糊）
               → 回复具体不合格原因
               → 写入 Excel Sheet2（留存记录）
```

**Excel 输出（自动维护两张表）：**

| Sheet | 内容 |
|-------|------|
| Registrations | 所有注册用户：手机号、身份证、注册时间 |
| Receipts | 所有收据：单据号、品牌、金额、是否合格、不合格原因、OCR 置信度 |

---

## 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                      用户手机                            │
│                   WhatsApp App                          │
└──────────────────────────┬──────────────────────────────┘
                           │ WhatsApp 协议
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Node.js WhatsApp Bot                       │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  bot.js     │  │messageHandler│  │sessionManager │  │
│  │  (连接管理) │→ │  (消息路由)  │→ │  (会话状态机) │  │
│  └─────────────┘  └──────┬───────┘  └───────────────┘  │
│                          │                              │
│              ┌───────────┴───────────┐                  │
│              ▼                       ▼                  │
│  ┌─────────────────────┐  ┌─────────────────────────┐  │
│  │ registrationHandler │  │    receiptHandler       │  │
│  │  (注册流程)         │  │    (收据流程)           │  │
│  └─────────┬───────────┘  └────────────┬────────────┘  │
│            │                           │                │
│            └──────────┬────────────────┘                │
│                       │                                 │
│         ┌─────────────┴─────────────┐                  │
│         ▼                           ▼                  │
│  ┌───────────────┐         ┌─────────────────┐        │
│  │  Gemini AI    │         │   JSON 文件     │        │
│  │  (OCR 识别)   │         │  (会话持久化)   │        │
│  └───────────────┘         └─────────────────┘        │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │  Express 管理后台    │
                │  (QR/配对码/状态)    │
                └─────────────────────┘
```

### 数据流说明

1. **注册流程**: 用户发送 IC -> Bot 进入 `WAITING_IC` 状态 -> 验证 IC 格式 -> 写入 Excel -> 状态转为 `WAITING_RECEIPT`。
2. **收据处理**: 用户发送图片 -> Bot 下载并转 Base64 -> Gemini AI 识别品牌和金额 -> 资格判定 -> 写入 Excel。
3. **会话持久化**: 本地 JSON 文件存储会话状态，Bot 重启不会丢失会话。

---

## 核心特性

- **模糊品牌匹配**：用 Gemini AI 识别收据中的品牌名称，支持模糊匹配
- **智能金额提取**：优先识别 Total/Jumlah 关键词附近的数字
- **会话持久化**：本地 JSON 文件存储用户会话状态，Bot 重启不会丢失会话
- **并发安全**：文件锁机制保证多用户同时提交时数据不冲突
- **防刷限制**：每用户每日最多提交 5 次（可配置）
- **会话超时**：30 分钟无操作自动过期
- **双登录模式**：支持 QR 码扫描和配对码两种方式

---

## 快速开始

### 环境要求

- Node.js ≥ 20（LTS）
- 一个 **专用** WhatsApp 号码（会长期保持登录状态）
- Gemini API Key

> **Ubuntu / Debian 额外依赖**（whatsapp-web.js 内嵌 Chromium 必需，缺少会报错 `error while loading shared libraries`）：
> ```bash
> sudo apt-get install -y \
>   libgbm-dev libasound2 libatk1.0-0 libatk-bridge2.0-0 \
>   libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
>   libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 libnss3
> ```

### 安装

```bash
# 克隆项目
git clone https://github.com/kelvinlee97/automation-ocr.git
cd automation-ocr

# 安装根目录依赖（Playwright 测试用）
npm install

# 安装 WhatsApp Bot 依赖
cd wa-bot
npm install
```

### 本地启动

```bash
cd wa-bot

# 方式一：直接运行
GEMINI_API_KEY=your_key npm start

# 方式二：开发模式（文件变更自动重启）
GEMINI_API_KEY=your_key npm run dev
```

首次运行会显示二维码，用目标 WhatsApp 号码扫码登录。扫码后登录状态保存在 `wa-bot/.wwebjs_auth/`，后续重启无需重新扫码。

### 管理后台

启动后访问 `http://localhost:3000/admin/qr`：

- **扫描二维码**：用手机 WhatsApp 扫码登录
- **配对码登录**：输入手机号获取 8 位配对码，然后在手机 WhatsApp 上输入配对码

---

## 配置

所有业务规则集中在 **`config/config.yaml`**，**无需改代码**：

```yaml
eligibility:
  eligible_brands:           # 品牌白名单（直接增减）
    - "Samsung"
    - "Apple"
    - "Dyson"
    - "Panasonic"
    - "Sony"
  minimum_amount: 500.00     # 最低消费门槛（马币 RM）
  brand_match_threshold: 85  # OCR 模糊匹配严格度（0-100）

bot:
  session_timeout_minutes: 30
  max_receipts_per_day: 5
```

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `GEMINI_API_KEY` | ✅ | Gemini API 密钥 |
| `NODE_ENV` | - | 设为 `production` 启用生产模式 |
| `SESSION_SECRET` | - | 会话加密密钥，生产环境建议设置，重启后保持登录状态 |

---

## API 接口

### 健康检查

```bash
curl http://localhost:3000/health
```

响应：
```json
{
  "status": "ok",
  "whatsapp": "disconnected",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### WhatsApp 状态

```bash
curl http://localhost:3000/admin/wa-status
```

### 配对码请求

```bash
curl -X POST http://localhost:3000/admin/request-pairing-code \
  -H "Content-Type: application/json" \
  -d '{"phone": "601234567890"}'
```

---

## 目录结构

```
automation-ocr/
├── config/
│   └── config.yaml          ← 业务规则（品牌、金额门槛）
├── wa-bot/                   ← Node.js WhatsApp Bot
│   ├── package.json
│   ├── index.js              ← 入口文件
│   └── src/
│       ├── bot.js                ← WhatsApp 客户端初始化
│       ├── sessionManager.js    ← 会话状态机（JSON 文件存储）
│       ├── messageHandler.js   ← 消息路由
│       ├── adminServer.js       ← 管理后台 Express 服务器
│       ├── handlers/
│       │   ├── registrationHandler.js
│       │   └── receiptHandler.js
│       ├── services/
│       │   ├── geminiService.js    ← AI OCR 识别
│       │   └── excelService.js     ← Excel 读写
│       └── utils/
│           └── logger.js
├── data/                     ← 运行数据（自动创建）
│   ├── sessions.json         ← 用户会话存储
│   ├── excel/
│   │   └── records.xlsx      ← 输出记录
│   ├── receipts/            ← 收据图片备份
│   └── wwebjs_auth/         ← WhatsApp 登录凭证
├── docker-compose.yml
├── .env
└── README.md
```

---

## 生产部署

### Docker Compose（推荐 AWS Lightsail）

```bash
# 克隆项目
git clone https://github.com/kelvinlee97/automation-ocr.git
cd automation-ocr

# 配置环境变量
cp .env .env.local
# 编辑 .env.local，填入 GEMINI_API_KEY

# 启动服务
docker compose up -d --build

# 查看启动状态
docker compose ps

# 首次运行需扫码登录：查看 wa-bot 日志获取二维码
docker compose logs -f wa-bot

# 查看实时日志
docker compose logs -f

# 停止服务（不删除数据）
docker compose down
```

> **成本参考（AWS ap-southeast-1 新加坡）：**
> - Lightsail $5/月套餐（1GB RAM）足够
> - 加上 EBS 30GB 存储：约 $1.5/月
> - **估算总成本：~$7/月**

#### AWS Lightsail 部署步骤

**1. 准备工作**

- 在 AWS Console 开通 **Lightsail 实例**：Ubuntu 22.04 LTS，$5 USD (1GB RAM)
- 创建 **Static IP** 并关联实例（防止 IP 变动导致 WhatsApp 封号）
- 获取 **Gemini API Key**：[Google AI Studio](https://aistudio.google.com/app/apikey)

**2. 服务器环境安装**

```bash
sudo apt update
sudo apt install -y docker.io docker-compose
sudo usermod -aG docker $USER
newgrp docker
```

**3. 部署**

```bash
git clone https://github.com/kelvinlee97/automation-ocr.git
cd automation-ocr
echo "GEMINI_API_KEY=你的_KEY" > .env
sudo docker-compose up -d --build
sudo docker logs -f wa-bot  # 查看二维码
```

**4. 常见问题**

- 扫码失败：调小终端字体或查看日志中的文字版二维码
- 内存不足：1GB RAM 运行 Chrome Headless 稍紧，确保无其他大内存进程

### Nginx 反向代理（可选）

服务默认监听 `127.0.0.1:3000`，由 Nginx 处理 HTTPS 终止：

```nginx
server {
    server_name your-domain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 常见问题

### Q: 配对码显示 "WhatsApp 客户端尚未就绪"

**原因**：配对码功能需要在 WhatsApp 客户端初始化完成后才能使用（等待 QR 事件触发）。

**解决**：
1. 确保 WhatsApp Bot 已启动并显示 QR 码
2. 等待 10-20 秒让客户端完全初始化
3. 如持续报错，查看日志确认 `onPairingCodeReady` 事件是否触发

### Q: 页面显示 "window.onCodeReceivedEvent is not a function"

**原因**：页面加载未完成时就调用了 `page.evaluate()`，whatsapp-web.js 尚未注入 `onCodeReceivedEvent`。

**解决**：已在代码中添加页面加载状态检测，如仍有问题请更新到最新版本。

### Q: OCR 识别失败

**检查**：
1. 确认 `GEMINI_API_KEY` 正确
2. 检查网络能访问 Google AI API
3. 查看日志中具体的错误信息

### Q: 容器重启后需要重新扫码

**原因**：未挂载 WhatsApp 凭据目录或 `SESSION_SECRET` 未设置。

**解决**：
```yaml
# docker-compose.yml 中确保已挂载
volumes:
  - ./data/wwebjs_auth:/app/.wwebjs_auth
```
设置 `SESSION_SECRET` 环境变量。

---

## 日志说明

日志使用 Winston，格式为 JSON，生产环境输出到容器日志：

```bash
# 查看实时日志
docker compose logs -f wa-bot

# 按关键词过滤
docker compose logs wa-bot | grep "配对码"
```

关键日志事件：
- `请扫描二维码登录 WhatsApp` — 等待扫码
- `配对码已生成` — 配对码请求成功
- `WhatsApp Bot 已就绪` — 登录成功
- `收据识别结果` — OCR 识别完成

---

## 注意事项

- `wa-bot/.wwebjs_auth/` 含 WhatsApp 登录凭证，已加入 `.gitignore`，**切勿提交到版本控制**
- `data/sessions.json` 存储用户会话数据，Docker 部署时需挂载持久化
- 本项目使用 [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) 非官方库，存在被 WhatsApp 封号风险，建议使用专用号码而非个人主号
- 定期备份 `data/` 目录，防止数据丢失

---

## License

MIT