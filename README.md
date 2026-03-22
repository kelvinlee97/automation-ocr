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

双进程微服务，各用最适合的语言，通过 HTTP 通信：

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
│                       │ HTTP 请求                        │
│                  ocrClient.js                           │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP (localhost:8000)
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Python FastAPI OCR 服务                    │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ main.py    │  │  OCR 模块  │  │   Excel 模块     │  │
│  │ (路由入口) │→ │ engine     │→ │  writer.py       │→ records.xlsx
│  └────────────┘  │ preprocessor  │  schema.py       │  │
│                  │ extractor  │  └──────────────────┘  │
│                  └────────────┘                         │
└─────────────────────────────────────────────────────────┘
```

### 数据流说明

1. **注册流程**: 用户发送消息 -> Bot 进入 `WAITING_IC` 状态 -> 验证 IC 格式 -> 调用 Python API 写入 Excel -> 状态转为 `WAITING_RECEIPT`。
2. **收据处理**: 用户发送图片 -> Bot 下载并转发 Base64 到 Python 服务 -> 图像预处理 -> EasyOCR 识别 -> 模糊品牌匹配 (rapidfuzz) -> 金额提取 -> 资格判定 -> 写入 Excel。

---

## 核心特性

- **模糊品牌匹配**：用 rapidfuzz `partial_ratio` 识别 OCR 的错别字，如 "SAMSNG ELECTRONI" → Samsung（阈值可配置）
- **智能金额提取**：优先识别 Total/Jumlah 关键词附近的数字，兜底取全单最大 RM 金额
- **图像预处理**：灰度化 + CLAHE 自适应对比度增强 + 非局部均值去噪，提升模糊收据的识别率
- **并发安全**：asyncio.Lock 保证多用户同时提交时 Excel 数据不互相覆盖
- **指数退避重试**：OCR 请求失败时自动重试（500ms / 1s / 2s），4xx 错误不重试
- **防刷限制**：每用户每日最多提交 5 次（可配置）
- **会话超时**：30 分钟无操作自动清理，防内存泄漏

---

## 快速开始

### 环境要求

- Node.js ≥ 18
- Python 3.10+
- 一个 **专用** WhatsApp 号码（会长期保持登录状态）

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

# Python 依赖
cd ocr-service
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Node.js 依赖
cd ../wa-bot
npm install
```

### 启动（顺序重要）

**终端 1 — 先启动 OCR 服务：**
```bash
cd ocr-service
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000
# 等看到 "EasyOCR 模型加载完成" 再进行下一步
```

**终端 2 — 再启动 Bot：**
```bash
cd wa-bot
npm start
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
```

所有对用户可见的回复话术在 **`config/messages.yaml`**，支持 `{变量}` 占位符。

---

## 目录结构

```
automation-ocr/
├── config/
│   ├── config.yaml          ← 业务规则（品牌、金额门槛等）
│   └── messages.yaml        ← 所有 Bot 回复话术
├── wa-bot/                  ← Node.js WhatsApp Bot
│   └── src/
│       ├── sessionManager.js    ← 核心：用户会话状态机
│       ├── messageHandler.js    ← 消息路由
│       ├── ocrClient.js         ← HTTP 客户端（含重试）
│       └── handlers/            ← 注册 / 收据处理逻辑
├── ocr-service/             ← Python FastAPI OCR 服务
│   └── src/
│       ├── ocr/                 ← engine / preprocessor / extractor
│       └── excel/               ← schema / writer（线程安全）
└── data/
    └── excel/records.xlsx   ← 最终输出（运行后自动创建）
```

---

## 生产部署

### 方案 A：Docker Compose（推荐 AWS EC2）

```bash
# 构建并后台启动（首次构建约需 10-15 分钟，EasyOCR 镜像较大）
docker compose up -d --build

# 查看启动状态（ocr-service 健康检查通过后 wa-bot 才会启动）
docker compose ps

# 首次运行需扫码登录：查看 wa-bot 日志获取二维码
docker compose logs -f wa-bot

# 查看实时日志
docker compose logs -f

# 停止服务（不删除数据）
docker compose down
```

> **成本参考（AWS ap-southeast-1 新加坡）：**
> - t3.medium（2 vCPU / 4GB）：约 $0.052/小时 ≈ $38/月
> - EasyOCR 模型需要至少 2GB 内存，t3.small 可能 OOM
> - 加上 EBS 30GB gp3 存储：约 $2.4/月
> - **估算总成本：~$40-45/月**

---

### 方案 B：PM2（不用 Docker 时）

```bash
npm install -g pm2

# 使用 ecosystem.config.js 一键启动
pm2 start ecosystem.config.js --env production

pm2 save && pm2 startup
```

---

## 注意事项

- `wa-bot/.wwebjs_auth/` 含 WhatsApp 登录凭证，已加入 `.gitignore`，**切勿提交到版本控制**
- 用户会话存储在内存中，Bot 重启后所有活跃会话丢失（用户需重新注册）；如需持久化请改用 Redis
- 本项目使用 [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) 非官方库，存在被 WhatsApp 封号风险，建议使用专用号码而非个人主号

---

## License

MIT
