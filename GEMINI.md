# WhatsApp OCR 收据验证系统

## 项目概述
这是一个用于自动化收集 WhatsApp 消费收据并进行 OCR（光学字符识别）验证的系统。该系统允许用户通过 WhatsApp 提交身份证号和收据截图，自动提取品牌、消费金额等信息，判断是否符合特定的消费门槛，并将处理结果写入到 Excel 表格中。

### 技术架构
项目采用了**双进程微服务架构**，通过 HTTP 通信：
1. **WhatsApp Bot (`wa-bot/`)**: 
   - 负责与用户进行 WhatsApp 对话、管理用户会话状态机、格式验证以及下载收据图片。
   - **技术栈**: Node.js 18, `whatsapp-web.js`, `axios`。
2. **OCR 服务 (`ocr-service/`)**: 
   - 负责图像预处理、使用 EasyOCR 进行文字识别、验证资格并将结果（包括合格与否、原图路径等）并发安全地写入 Excel 文件。
   - **技术栈**: Python 3.10+, FastAPI, EasyOCR, OpenCV, `openpyxl`, `rapidfuzz`。

## 构建与运行

系统需要分别启动 Python OCR 服务和 Node.js Bot 服务。**必须先启动 OCR 服务。**

### 1. 启动 OCR 服务 (Python)
```bash
cd ocr-service
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```
*等待终端显示模型加载完成或服务成功启动后，再进行下一步。*

### 2. 启动 WhatsApp Bot (Node.js)
```bash
cd wa-bot
npm install
npm start
```
*首次运行 `wa-bot` 时，终端会显示二维码，需使用 WhatsApp 扫码登录。*

### 生产环境部署
**方案 A: Docker Compose (推荐)**
```bash
docker compose up -d --build
docker compose logs -f wa-bot  # 首次启动查看登录二维码
```

**方案 B: PM2**
```bash
npm install -g pm2
pm2 start ecosystem.config.js --env production
```

## 开发约定与指南

- **推荐工作流：本地隔离开发 & 远程自动化部署**: 
  - **本地零依赖**: 你无需在 Mac 本地安装 Node.js、Python、EasyOCR 或 OpenCV。所有的复杂环境均封装在 Docker 容器中。
  - **云端构建**: 通过 `git push` 触发 GitHub Actions（见 `.github/workflows/deploy.yml`），在云端自动构建最新的 Docker 镜像并推送到仓库。
  - **远程同步**: 远程服务器通过 `docker compose pull` 和 `up -d` 自动拉取并运行最新版本。本地仅作为代码编辑器和指令中心，保持环境绝对干净。
- **配置驱动业务逻辑**: 所有的业务规则（品牌白名单、最低消费门槛、用户每日提交上限、会话超时等）都集中在 `config/config.yaml` 中。所有的回复话术在 `config/messages.yaml` 中。**开发和维护时，优先修改配置文件，无需硬编码在代码中。**
- **双向独立**: Python 服务和 Node.js 服务相互解耦。修改各自的代码只需重启对应的服务。若修改了 `config` 目录下的配置，需要同时重启两个服务。
- **并发与持久化**: OCR 写入 Excel 时使用了异步锁（`asyncio.Lock`）来保证并发安全。Bot 的会话状态机存储在本地 JSON 文件中，重启后自动恢复。
- **重试机制**: Bot 调用 OCR 服务时实现了指数退避重试（配置项为 `ocr_max_retries`），以应对由于网络波动或短暂的高负载引起的错误。