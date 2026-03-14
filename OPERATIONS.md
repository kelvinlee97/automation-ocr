# 操作记录

每次执行前记录操作步骤，便于追踪变更历史和回滚决策。

---

## [2026-03-12] AWS 一键部署方案

### 背景

用户要求将项目部署到 AWS，全程尽量无需人工干预。项目已有 Dockerfile × 2 和 docker-compose.yml，具备容器化基础。

### 发现的问题

在开始部署方案之前，发现两个需要先修复的 bug：

1. **`wa-bot/src/ocrClient.js` 忽略 `OCR_SERVICE_URL` 环境变量**
   - 现状：`docker-compose.yml` 已配置 `OCR_SERVICE_URL=http://ocr-service:8000`，但 `ocrClient.js` 三处调用（`processReceipt`、`registerUser`、`healthCheck`）均硬读 `config.services.ocr_service_url`（值为 `localhost:8000`）
   - 后果：Docker 部署后 wa-bot 容器所有 OCR 请求打向 `localhost:8000`（本机），实际服务在 `ocr-service:8000`（另一个容器），所有请求失败
   - 修复：改为 `process.env.OCR_SERVICE_URL || config.services.ocr_service_url`

2. **`docker-compose.yml` 缺少 EasyOCR 模型缓存 volume**
   - 现状：EasyOCR 首次运行会下载约 400MB 模型到容器内 `/root/.EasyOCR`，容器删除重建后模型丢失
   - 后果：每次 `docker compose down && up` 都要重新等待 5-10 分钟下载模型
   - 修复：新增 named volume `easyocr-models` 挂载到 `/root/.EasyOCR`

### 操作步骤

#### 步骤 1：修复 ocrClient.js 环境变量支持
- 文件：`wa-bot/src/ocrClient.js`
- 改动：`processReceipt`、`registerUser`、`healthCheck` 三处 `baseUrl` 赋值改为优先读环境变量

#### 步骤 2：修复 docker-compose.yml 模型缓存
- 文件：`docker-compose.yml`
- 改动：`ocr-service` service 新增 volume 挂载；底部 `volumes` 节声明 `easyocr-models`

#### 步骤 3：创建 deploy/ 目录，新增 cloudformation.yaml
- 新文件：`deploy/cloudformation.yaml`
- 内容：
  - 参数：`GitRepoUrl`、`GitBranch`、`InstanceType`（默认 `t3.medium`）、`DataVolumeSize`、`AmiId`（自动取最新 AL2023）
  - VPC + 公网子网 + Internet Gateway + 路由表
  - Security Group：**无 SSH 入站**，出站全放行；通过 SSM Session Manager 管理
  - IAM Role：绑定 `AmazonSSMManagedInstanceCore` + `CloudWatchAgentServerPolicy`
  - EC2 实例，User Data 自动执行：
    1. 挂载 EBS 数据卷（`/dev/xvdf` → `/data`），写入 `/etc/fstab`
    2. 安装 Docker CE + docker compose v2 插件
    3. `git clone` 代码到 `/opt/automation-ocr`
    4. 软链 `/data` → 项目 `data/` 目录；`/data/wwebjs_auth` → `wa-bot/.wwebjs_auth`
    5. `docker compose build` 预构建镜像
    6. 注册 `systemd` unit `automation-ocr.service`（开机自启、失败后 30s 重启）
  - EBS 数据卷（gp3，`DeletionPolicy: Retain`，Stack 删除后数据不丢失）
  - Outputs：实例 ID、公网 IP、数据卷 ID、SSM 登录命令

#### 步骤 4：新增 deploy/README.md
- 内容：资源清单 + 费用估算、前置条件、部署命令、首次扫码流程、日常运维操作（重启/更新/扫码重置）、销毁资源命令、架构图

### 决策说明

| 决策 | 原因 |
|------|------|
| 用 CloudFormation 而非 Terraform | 项目已在 AWS 生态，CFN 无需额外工具，aws-cli 即可操作 |
| 不开放 SSH（22 端口） | SSM Session Manager 更安全，无需管理 key pair |
| 用 systemd 而非 PM2 | 容器化后进程由 Docker 管理，systemd 只需管 `docker compose` 的生命周期 |
| EBS 数据卷与根卷分离 | 便于独立备份；`DeletionPolicy: Retain` 防止误删数据 |
| 推荐 `t3.large` 而非 `t3.medium` | EasyOCR 模型加载峰值约 2.5GB，`t3.medium`（4GB）空间过紧 |
| WhatsApp 扫码不自动化 | WhatsApp 要求人工确认，无法绕过，只能提供便捷的操作指引 |
