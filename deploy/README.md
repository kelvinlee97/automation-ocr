# AWS 部署指南

## 概览

通过一份 CloudFormation 模板在 AWS 上自动创建所有资源，EC2 启动时自动完成代码部署和服务启动，**全程无需人工登录服务器**。

唯一需要人工介入的步骤：**首次启动后扫描 WhatsApp QR 码**（一次性操作，凭证持久化到 EBS 卷）。

---

## 创建的 AWS 资源

| 资源 | 说明 | 预估月费用（ap-southeast-1）|
|------|------|------|
| EC2 `t3.medium` | 运行 Bot + OCR 服务 | ~$34 |
| EC2 `t3.large` *(推荐)* | 内存更充裕，模型更稳定 | ~$67 |
| EBS gp3 根卷 30GB | 系统 + Docker 镜像 + EasyOCR 模型 | ~$2.5 |
| EBS gp3 数据卷 20GB | Excel 数据 + 收据图片 | ~$1.6 |
| VPC / Subnet / IGW | 网络基础设施 | 免费 |
| IAM Role | SSM 访问权限 | 免费 |

> **注意**：数据卷设置了 `DeletionPolicy: Retain`，Stack 删除时数据不丢失，但会持续计费。不再使用时需手动删除 EBS 卷。

---

## 前置条件

1. 安装并配置 AWS CLI：
   ```bash
   aws configure  # 填入 Access Key、Secret Key、Region
   ```

2. 项目代码已推送到 GitHub（需要公开仓库，或配置 EC2 访问私有仓库的凭证）

---

## 部署步骤

### 第一步：创建 Stack

```bash
aws cloudformation create-stack \
  --stack-name automation-ocr \
  --template-body file://deploy/cloudformation.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=GitRepoUrl,ParameterValue=https://github.com/<你的用户名>/automation-ocr.git \
    ParameterKey=GitBranch,ParameterValue=main \
    ParameterKey=InstanceType,ParameterValue=t3.large \
    ParameterKey=DataVolumeSize,ParameterValue=20 \
  --region ap-southeast-1
```

### 第二步：等待部署完成

```bash
# 等待 Stack 创建完成（约 5-8 分钟）
aws cloudformation wait stack-create-complete \
  --stack-name automation-ocr \
  --region ap-southeast-1

# 查看输出（含 SSM 登录命令和实例 ID）
aws cloudformation describe-stacks \
  --stack-name automation-ocr \
  --query "Stacks[0].Outputs" \
  --region ap-southeast-1
```

### 第三步：首次扫码登录 WhatsApp

EC2 启动后 Docker 镜像构建约需 **10-15 分钟**（包含下载 EasyOCR 模型），之后 wa-bot 容器会自动启动并等待扫码。

```bash
# 1. 通过 SSM Session Manager 连接实例（无需 SSH key、无需开放 22 端口）
aws ssm start-session \
  --target <InstanceId>  \  # 从上一步 Outputs 获取
  --region ap-southeast-1

# 2. 进入 EC2 后，查看 QR 码
sudo docker logs -f wa-bot

# 3. 用手机 WhatsApp → 已连接的设备 → 扫描二维码

# 4. 看到"WhatsApp Bot 已就绪"日志后，Ctrl+C 退出日志，exit 退出 SSM
```

> 扫码完成后凭证自动保存到 `/data/wwebjs_auth/`（EBS 卷），后续重启无需重复扫码。

---

## 日常运维

### 查看日志

```bash
# 连接到实例
aws ssm start-session --target <InstanceId> --region ap-southeast-1

# 查看 Bot 实时日志
sudo docker logs -f wa-bot

# 查看 OCR 服务日志
sudo docker logs -f ocr-service

# 查看 User Data 执行日志（排查部署问题）
sudo cat /var/log/user-data.log
```

### 重启服务

```bash
# 重启所有容器（不丢失会话，WhatsApp 凭证已持久化）
sudo systemctl restart automation-ocr

# 单独重启某个服务
sudo docker restart wa-bot
sudo docker restart ocr-service
```

### 更新代码

```bash
# 连接实例后
cd /opt/automation-ocr
sudo git pull origin main
sudo docker compose build
sudo systemctl restart automation-ocr
```

### WhatsApp Session 失效（需重新扫码）

```bash
# 清除凭证
sudo rm -rf /data/wwebjs_auth/*
sudo systemctl restart automation-ocr

# 等待容器启动后查看 QR 码并扫码
sudo docker logs -f wa-bot
```

### 修改业务配置（不改代码）

```bash
# 直接编辑宿主机上的配置文件
sudo vim /opt/automation-ocr/config/config.yaml

# 重启服务使配置生效（配置文件是懒加载单例，必须重启）
sudo systemctl restart automation-ocr
```

---

## 快捷管理脚本

`deploy/manage.sh` 封装了常用的 AWS 管理操作，避免每次手动拼 CLI 命令：

```bash
# 首次部署
deploy/manage.sh deploy

# 查看当前状态
deploy/manage.sh status

# 暂停服务（停止实例，仅 EBS 计费约 $4.1/月）
deploy/manage.sh stop

# 恢复服务（约 1 分钟）
deploy/manage.sh start

# 通过 SSM 连接实例
deploy/manage.sh ssh

# 查看容器日志（默认 wa-bot，可指定容器和行数）
deploy/manage.sh logs                  # wa-bot 最近 50 行
deploy/manage.sh logs ocr-service 100  # ocr-service 最近 100 行

# 查看预估费用
deploy/manage.sh cost

# 删除 Stack（需输入 Stack 名称二次确认）
deploy/manage.sh destroy
```

所有配置可通过环境变量覆盖：

```bash
# 使用较小实例部署
INSTANCE_TYPE=t3.medium deploy/manage.sh deploy

# 指定不同的 Stack 名称
STACK_NAME=ocr-staging deploy/manage.sh deploy
```

### 成本策略

| 操作 | 停机时月费 | 恢复时间 | 适用场景 |
|------|-----------|---------|---------|
| `manage.sh stop` | ~$4.1（EBS 卷） | ~1 分钟 | 短期停用（几天~几周）|
| `manage.sh destroy` | ~$1.6（仅 Retain 数据卷） | ~8-15 分钟 | 长期停用（数月）|

---

## 销毁资源

```bash
# 删除 Stack（EC2 + VPC + Security Group + IAM Role 会被删除）
# 数据 EBS 卷因 DeletionPolicy: Retain 会保留，需手动删除
aws cloudformation delete-stack \
  --stack-name automation-ocr \
  --region ap-southeast-1

# 手动删除数据卷（确认数据已备份后执行）
aws ec2 delete-volume \
  --volume-id <DataVolumeId> \  # 从 Stack Outputs 获取
  --region ap-southeast-1
```

---

## 架构图

```
Internet
    │
    ▼
WhatsApp 用户
    │ HTTPS（whatsapp-web.js 内嵌 Chromium）
    ▼
┌─────────────────────────────────────────┐
│  EC2 (t3.large, Amazon Linux 2023)      │
│                                         │
│  ┌─────────────┐    ┌────────────────┐  │
│  │  wa-bot     │───▶│  ocr-service   │  │
│  │  (Node.js)  │    │  (Python/OCR)  │  │
│  └─────────────┘    └────────────────┘  │
│         │                   │           │
│         ▼                   ▼           │
│  /data/wwebjs_auth   /data/excel/       │
│                      /data/uploads/     │
└──────────────────────────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  EBS gp3 数据卷      │
                    │  (DeletionPolicy:   │
                    │   Retain)           │
                    └─────────────────────┘

管理入口：SSM Session Manager（无 SSH）
```
