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
③ OCR 自动识别：品牌 / 消费金额 / 单据号
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
│  │  Gemini AI    │         │   Redis         │        │
│  │  (OCR 识别)   │         │  (会话持久化)   │        │
│  └───────────────┘         └─────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

### 数据流说明

1. **注册流程**: 用户发送 IC -> Bot 进入 `WAITING_IC` 状态 -> 验证 IC 格式 -> 写入 Excel -> 状态转为 `WAITING_RECEIPT`。
2. **收据处理**: 用户发送图片 -> Bot 下载并转 Base64 -> Gemini AI 识别品牌和金额 -> 资格判定 -> 写入 Excel。
3. **会话持久化**: Redis Hash 存储会话状态，TTL 自动过期，Bot 重启不会丢失会话。

---

## 核心特性

- **模糊品牌匹配**：用 Gemini AI 识别收据中的品牌名称，支持模糊匹配
- **智能金额提取**：优先识别 Total/Jumlah 关键词附近的数字
- **会话持久化**：Redis 存储用户会话状态，Bot 重启不会丢失会话
- **内存降级**：Redis 不可用时自动降级到内存模式，保持可用性
- **并发安全**：Redis 原子操作保证多用户同时提交时数据不冲突
- **防刷限制**：每用户每日最多提交 5 次（可配置）
- **会话超时**：30 分钟无操作自动过期（Redis TTL）

---

## 快速开始

### 环境要求

- Node.js ≥ 18
- Redis ≥ 6
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

# 安装 Redis
sudo apt-get install redis-server

# Node.js 依赖
cd wa-bot
npm install
```

### 启动

**启动 Redis：**
```bash
redis-server
```

**启动 Bot：**
```bash
cd wa-bot
GEMINI_API_KEY=your_key npm start
# 首次运行会显示二维码，用目标 WhatsApp 号码扫码登录
```

扫码后登录状态保存在 `wa-bot/.wwebjs_auth/`，后续重启无需重新扫码。

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

redis:
  host: "localhost"
  port: 6379
  # password: ""  # 有密码时取消注释
```

---

## 目录结构

```
automation-ocr/
├── config/
│   └── config.yaml          ← 业务规则（品牌、金额门槛、Redis 配置等）
├── wa-bot/                   ← Node.js WhatsApp Bot
│   └── src/
│       ├── bot.js                ← WhatsApp 客户端初始化
│       ├── sessionManager.js    ← 会话状态机（Redis + 内存降级）
│       ├── redisClient.js       ← Redis 连接管理
│       ├── messageHandler.js   ← 消息路由
│       ├── adminServer.js      ← 管理后台 Express 服务器
│       └── handlers/            ← 注册 / 收据处理逻辑
└── data/
    └── excel/records.xlsx   ← 最终输出（运行后自动创建）
```

---

## 生产部署

### Docker Compose（推荐 AWS Lightsail）

```bash
# 克隆项目
git clone https://github.com/kelvinlee97/automation-ocr.git
cd automation-ocr

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 GEMINI_API_KEY

# 启动所有服务（Redis + Bot）
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

---

### 环境变量 (.env)

```bash
GEMINI_API_KEY=your_key_here
REDIS_HOST=redis
REDIS_PORT=6379
```

---

## 注意事项

- `wa-bot/.wwebjs_auth/` 含 WhatsApp 登录凭证，已加入 `.gitignore`，**切勿提交到版本控制**
- Redis 数据通过 Docker volume 持久化，重启不丢失
- 本项目使用 [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) 非官方库，存在被 WhatsApp 封号风险，建议使用专用号码而非个人主号

---

## License

MIT
