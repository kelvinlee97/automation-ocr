# WhatsApp 订单自动化处理系统 — 架构文档

## 目录

1. [系统概述](#1-系统概述)
2. [整体架构图](#2-整体架构图)
3. [目录结构说明](#3-目录结构说明)
4. [两个服务的分工](#4-两个服务的分工)
5. [数据流：注册流程](#5-数据流注册流程)
6. [数据流：收据流程](#6-数据流收据流程)
7. [模块逐一说明](#7-模块逐一说明)
8. [配置文件说明](#8-配置文件说明)
9. [Excel 输出结构](#9-excel-输出结构)
10. [启动与运行](#10-启动与运行)
11. [常见维护操作](#11-常见维护操作)
12. [扩展与修改指引](#12-扩展与修改指引)

---

## 1. 系统概述

这个系统做一件事：**通过 WhatsApp 自动收集用户注册信息和消费收据，验证资格后写入 Excel。**

用户体验流程：

```
用户发消息 → 提交身份证号 → 注册成功 → 发收据截图 → 系统识别金额/品牌 → 回复是否合格
```

系统由**两个独立进程**组成，通过 HTTP 通信：

| 进程 | 技术 | 作用 |
|------|------|------|
| **WhatsApp Bot** | Node.js | 与用户对话，管理状态机 |
| **OCR 服务** | Python FastAPI | 图像识别，写 Excel |

两个进程分开的原因：Python 的 EasyOCR 库在 Node.js 中无法直接使用。通过 HTTP 解耦，各自用最合适的语言。

---

## 2. 整体架构图

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
                                        │
                                        ▼
                              data/excel/records.xlsx
                              ┌─────────────────────┐
                              │ Sheet1: Registrations│
                              │ Sheet2: Receipts     │
                              └─────────────────────┘
```

---

## 3. 目录结构说明

```
automation-ocr/
│
├── config/                         ← 所有业务配置集中在这里
│   ├── config.yaml                 ← 品牌白名单、金额门槛、超时设置
│   └── messages.yaml               ← Bot 回复的全部话术文案
│
├── wa-bot/                         ← Node.js WhatsApp Bot
│   ├── package.json
│   ├── index.js                    ← 程序入口，启动 Bot
│   └── src/
│       ├── bot.js                  ← WhatsApp 连接、断线重连
│       ├── sessionManager.js       ← 用户会话状态机（核心）
│       ├── messageHandler.js       ← 消息分发路由
│       ├── ocrClient.js            ← 调用 Python 服务的 HTTP 客户端
│       ├── handlers/
│       │   ├── registrationHandler.js  ← 注册流程逻辑
│       │   └── receiptHandler.js       ← 收据处理逻辑
│       └── utils/
│           ├── icParser.js         ← 马来西亚 IC 格式验证
│           └── logger.js           ← 日志（控制台 + 文件）
│
├── ocr-service/                    ← Python OCR + Excel 服务
│   ├── requirements.txt
│   ├── main.py                     ← FastAPI 路由入口
│   └── src/
│       ├── config/
│       │   └── loader.py           ← 读取 config.yaml（单例缓存）
│       ├── models/
│       │   ├── receipt.py          ← 收据请求/响应数据结构
│       │   └── registration.py     ← 注册请求/响应数据结构
│       ├── ocr/
│       │   ├── engine.py           ← EasyOCR 单例（全局只初始化一次）
│       │   ├── preprocessor.py     ← OpenCV 图像预处理
│       │   └── extractor.py        ← 从 OCR 文本提取结构化字段
│       └── excel/
│           ├── schema.py           ← 从 config.yaml 读取表头定义
│           └── writer.py           ← 线程安全写入 xlsx
│
├── data/
│   ├── excel/records.xlsx          ← 主数据文件（运行后自动创建）
│   └── uploads/                    ← 收据图片存档（用于人工审核）
│
└── logs/
    ├── wa-bot.log                  ← Node.js Bot 日志
    └── ocr-service.log             ← Python 服务日志（通过 uvicorn）
```

---

## 4. 两个服务的分工

### Node.js Bot 负责：
- 与 WhatsApp 保持长连接（用 puppeteer 模拟浏览器）
- 维护每个用户的**对话状态**（是等 IC 还是等图片？）
- 验证 IC 格式
- 下载用户发来的图片
- 把结果**格式化后回复给用户**

### Python 服务负责：
- **图像 OCR 识别**（EasyOCR 是 Python 库，不能在 Node.js 直接用）
- 从 OCR 文本提取结构化数据（单据号、品牌、金额）
- **资格验证**（品牌匹配、金额门槛）
- 写入 Excel 文件

### 通信接口（API 契约）：

```
POST http://localhost:8000/data/register
请求体：{ phone, ic_number }
返回：{ success, message, duplicate }

POST http://localhost:8000/ocr/receipt
请求体：{ image_base64, phone, ic_number }
返回：{ success, qualified, receipt_no, brand, amount, confidence, disqualify_reason }

GET http://localhost:8000/health
返回：{ status: "ok" }
```

---

## 5. 数据流：注册流程

```
用户发任意消息（首次）
       │
       ▼
messageHandler.js
  └─ session 不存在 → 创建新 session，state = WAITING_IC
  └─ 根据 state 路由 → registrationHandler.js
       │
       ▼
registrationHandler.js
  └─ 读取消息文本
  └─ icParser.validateIC(text)
       ├─ 格式不对 → 回复"格式不正确，请重新输入"（循环）
       └─ 格式正确 ↓
           │
           ▼
  └─ ocrClient.registerUser({ phone, icNumber })
       └─ POST /data/register → Python 服务
           ├─ 检查 IC 是否已在 Excel 存在
           │   └─ 已存在 → 返回 { duplicate: true }
           │       └─ Bot 回复"此 IC 已注册"
           └─ 不存在 → 写入 Excel Sheet1 → 返回 { success: true }
                   │
                   ▼
  └─ updateSession(phone, { ic, state: WAITING_RECEIPT })
  └─ 回复"注册成功，请发收据截图"
```

**关键状态变化：** `WAITING_IC` → `WAITING_RECEIPT`

---

## 6. 数据流：收据流程

```
用户发图片（state = WAITING_RECEIPT）
       │
       ▼
messageHandler.js → receiptHandler.js
       │
       ▼
检查每日提交次数（默认上限 5 次）
  └─ 超限 → 回复"今日已达上限"
       │
       ▼
回复"正在识别，请稍候..."（给用户即时反馈）
       │
       ▼
下载图片 → media.data（已是 base64）
       │
       ▼
POST /ocr/receipt → Python 服务
       │
       ├─ 1. preprocessor.py：图像预处理
       │      灰度化 → CLAHE 增强对比度 → 非局部均值去噪
       │
       ├─ 2. engine.py：EasyOCR 识别
       │      返回 [(位置, 文字, 置信度), ...]
       │
       ├─ 3. extractor.py：提取结构化字段
       │      ├─ 单据号：正则匹配"Receipt No"等关键词后的编号
       │      ├─ 金额：找"Total/Jumlah"附近的 RM 数字，取最大值
       │      └─ 品牌：rapidfuzz 模糊匹配白名单品牌（阈值 85%）
       │
       ├─ 4. 资格验证
       │      ├─ 置信度 < 0.5 → 不合格（图片太模糊）
       │      ├─ 品牌不在白名单 → 不合格
       │      ├─ 金额未识别 → 不合格
       │      └─ 金额 < 500 RM → 不合格
       │
       └─ 5. writer.py：写入 Excel Sheet2（含 YES/NO 状态）
       │
       ▼
Bot 格式化回复用户
  ├─ 合格 → "✅ 恭喜！单据号 xxx，品牌 xxx，金额 RM xxx"
  └─ 不合格 → "❌ 抱歉，原因：xxx"
```

---

## 7. 模块逐一说明

### `wa-bot/src/sessionManager.js` — 会话状态机（最核心）

管理所有用户的对话状态。用一个 `Map<phone, session>` 存储。

**Session 对象结构：**
```javascript
{
  phone: "60123456789@c.us",  // WhatsApp 手机号格式
  ic: "123456-78-9012",       // 注册后才有值
  state: "WAITING_RECEIPT",   // 当前状态
  createdAt: 1700000000000,   // 创建时间戳
  updatedAt: 1700000000000,   // 最后更新时间戳
  receiptCount: 2,            // 今日已提交次数
  receiptCountDate: "2024-01-15"  // 计数对应日期（跨天自动重置）
}
```

**状态流转：**
```
WAITING_IC ──(IC 验证通过)──► WAITING_RECEIPT ──(流程结束)──► DONE
     ▲                               │
     └──(超时 30 分钟，自动清理)──────┘
```

**维护注意：** 这是纯内存存储，服务重启后所有用户需重新走注册流程。如果需要持久化，改用 Redis 或 SQLite。

---

### `wa-bot/src/ocrClient.js` — HTTP 客户端

封装了对 Python 服务的所有调用，含**指数退避重试**：

```
第 1 次失败 → 等 500ms 重试
第 2 次失败 → 等 1000ms 重试
第 3 次失败 → 等 2000ms 重试（最大等 8 秒）
超过 ocr_max_retries 次 → 抛出异常
```

4xx 错误（客户端错误）不重试，只有网络错误和 5xx 才重试。

---

### `ocr-service/src/ocr/engine.py` — EasyOCR 单例

EasyOCR 初始化要下载并加载模型，耗时 5-15 秒。代码用**双重检查锁**保证全程只初始化一次：

```python
if _reader is None:          # 第一次检查（无锁，快速路径）
    with _lock:
        if _reader is None:  # 第二次检查（有锁，防止竞争）
            _reader = easyocr.Reader(...)
```

FastAPI 启动时会主动调用 `get_reader()` 预热，避免第一个用户等待。

---

### `ocr-service/src/ocr/extractor.py` — 字段提取

**金额提取策略（两步）：**
1. 优先找 `Total / Jumlah / Grand Total` 附近的数字
2. 找不到则扫描全文所有 `RM xxx` 格式，取最大值（最大金额通常是总计）

**品牌匹配策略：**
- 用 `rapidfuzz.fuzz.partial_ratio` 而非精确匹配
- `partial_ratio` 检测子串相似度，对 OCR 识别出的多余字符更宽容
- 例：OCR 把 "Samsung" 识别为 "SAMSNG ELECTRONICS" → 仍能匹配（阈值 85%）
- 原始识别文字和匹配品牌都写入 Excel，便于事后审计

---

### `ocr-service/src/excel/writer.py` — Excel 写入

**并发安全机制：**

FastAPI 是异步框架，多个请求可能同时尝试写 Excel。代码用 `asyncio.Lock()` 确保：

```python
async with _write_lock:
    wb = load_workbook(path)   # 读
    ws.append(row)              # 改
    wb.save(path)               # 写
# Lock 自动释放，下一个请求才能进入
```

如果不加锁，两个请求同时 `load_workbook` 再 `save`，后保存的会覆盖前面的数据。

---

### `wa-bot/src/utils/icParser.js` — IC 验证

马来西亚 IC 格式：`XXXXXX-XX-XXXX`
- 前 6 位：出生日期 YYMMDD
- 中间 2 位：出生州代码（有固定枚举值）
- 后 4 位：流水号 + 性别

代码会自动容忍用户输入 12 位纯数字（无连字符），自动补全格式。

---

## 8. 配置文件说明

### `config/config.yaml` — 业务规则

**这是最常需要修改的文件。** 修改后重启两个服务生效。

```yaml
eligibility:
  eligible_brands:          # 修改这里来增减品牌
    - "Samsung"
    - "Apple"
  minimum_amount: 500.00    # 修改最低消费金额
  brand_match_threshold: 85 # 品牌模糊匹配严格度（越高越严格）

bot:
  session_timeout_minutes: 30   # 会话超时时间
  max_receipts_per_day: 5       # 每用户每日上限
  ocr_max_retries: 3            # OCR 失败重试次数
```

### `config/messages.yaml` — 回复话术

所有对用户可见的文案。支持 `{变量}` 占位符替换：

```yaml
receipt:
  qualified: |
    ✅ 恭喜！单据号：{receipt_no}  ← 代码会替换这里
```

修改话术不需要改代码，只改这个文件，重启服务生效。

---

## 9. Excel 输出结构

文件位置：`data/excel/records.xlsx`

**Sheet1 - Registrations（注册记录）**

| 序号 | 注册时间 | 手机号码 | 身份证号码 | 状态 |
|------|----------|----------|------------|------|
| 1 | 2024-01-15 10:30:00 | 60123456789@c.us | 123456-78-9012 | 已注册 |

**Sheet2 - Receipts（收据记录）**

| 序号 | 提交时间 | 手机号码 | 身份证号码 | 单据号 | 识别品牌 | 匹配品牌 | 消费金额(RM) | 是否合格 | 不合格原因 | OCR置信度 | 图片路径 |
|------|----------|----------|------------|--------|----------|----------|-------------|----------|------------|-----------|----------|
| 1 | 2024-01-15 10:35:00 | 60123456789@c.us | 123456-78-9012 | INV-001234 | SAMSUNG GALAXY | Samsung | 1200.00 | YES | | 87.50% | data/uploads/... |

**"识别品牌" vs "匹配品牌" 的区别：**
- 识别品牌：OCR 原始识别文字（可能是 "SAMSNG ELECTRONI"）
- 匹配品牌：经过模糊匹配后确认的标准品牌名（"Samsung"）
- 两列都保留，方便审计 OCR 准确率

---

## 10. 启动与运行

### 第一次运行（环境准备）

```bash
# 安装 Python 依赖
cd ocr-service
python -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 安装 Node.js 依赖
cd wa-bot
npm install
```

### 日常启动（两个终端）

**终端 1 — 启动 OCR 服务：**
```bash
cd ocr-service
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000
```

等看到 `EasyOCR 模型加载完成` 再启动 Bot。

**终端 2 — 启动 Bot：**
```bash
cd wa-bot
npm start
```

首次运行会在终端显示二维码，用绑定的 WhatsApp 号扫码登录。登录后 session 保存在 `wa-bot/.wwebjs_auth/`，下次重启不需要重新扫码。

### 生产环境（后台运行）

```bash
# 安装 pm2
npm install -g pm2

# 启动两个服务
pm2 start "uvicorn main:app --port 8000" --name ocr-service --cwd ocr-service
pm2 start index.js --name wa-bot --cwd wa-bot

# 查看状态
pm2 list
pm2 logs wa-bot

# 设置开机自启
pm2 save
pm2 startup
```

---

## 11. 常见维护操作

### 查看实时日志

```bash
# Bot 日志
tail -f logs/wa-bot.log | python3 -c "import sys,json; [print(json.dumps(json.loads(l), indent=2, ensure_ascii=False)) for l in sys.stdin]"

# OCR 服务日志（uvicorn 直接输出到终端，或 pm2 logs）
pm2 logs ocr-service
```

### 重置某用户会话

会话存在内存中，重启 Bot 即清空所有会话：

```bash
pm2 restart wa-bot
```

### 手动测试 OCR 服务

```bash
# 健康检查
curl http://localhost:8000/health

# 测试注册 API
curl -X POST http://localhost:8000/data/register \
  -H "Content-Type: application/json" \
  -d '{"phone": "60123456789", "ic_number": "123456-78-9012"}'

# 测试 OCR（将图片转 base64）
base64 -i receipt.jpg | python3 -c "
import sys, json, requests
img = sys.stdin.read().strip()
r = requests.post('http://localhost:8000/ocr/receipt', json={
    'image_base64': img,
    'phone': '60123456789',
    'ic_number': '123456-78-9012'
})
print(json.dumps(r.json(), indent=2, ensure_ascii=False))
"
```

### WhatsApp 登录失效

```bash
# 删除旧 session，重新扫码
rm -rf wa-bot/.wwebjs_auth
pm2 restart wa-bot
# 查看二维码
pm2 logs wa-bot
```

### 修改品牌白名单（不需要改代码）

编辑 `config/config.yaml`：
```yaml
eligibility:
  eligible_brands:
    - "Samsung"
    - "Apple"
    - "Dyson"
    - "LG"         ← 新增品牌
```

然后重启两个服务：
```bash
pm2 restart all
```

---

## 12. 扩展与修改指引

### 增加新的 Bot 回复状态

1. 在 `config/messages.yaml` 添加话术
2. 在 `wa-bot/src/sessionManager.js` 的 `SESSION_STATE` 增加新状态
3. 在 `wa-bot/src/messageHandler.js` 的 `switch` 里增加新的 `case`
4. 新建对应的 `handlers/xxxHandler.js`

### 增加 Excel 新列

1. 修改 `config/config.yaml` 的 `excel.sheets.receipts.columns` 添加列名
2. 修改 `ocr-service/src/excel/writer.py` 的 `write_receipt` 函数，在 `ws.append(...)` 对应位置添加字段

### 提升 OCR 准确率

主要调整 `ocr-service/src/ocr/extractor.py`：
- 增加正则关键词（如新的金额/收据号前缀格式）
- 调低 `config.yaml` 里的 `brand_match_threshold`（更宽松）或调高（更严格）
- 调整 `preprocessor.py` 的预处理参数（`clipLimit`、`h` 去噪强度）

### 支持多语言话术

`config/messages.yaml` 可以按语言分节，在 `messageHandler.js` 中根据用户来源判断语言后读取对应节点。

---

*文档对应代码版本：2026-03-03*
