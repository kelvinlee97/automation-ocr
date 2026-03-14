# 一键部署快速指南

## 前置条件

1. **AWS CLI 已配置**（有 Access Key 和权限）：
   ```bash
   aws configure
   # 填入 Access Key ID、Secret Access Key
   # Default region: ap-southeast-1
   ```

2. **代码已推送到 GitHub**：
   ```bash
   git push origin main
   ```

3. **本地已安装 `jq`**：
   ```bash
   brew install jq  # macOS
   ```

---

## 部署

### 私有仓库：先存储 GitHub Token（一次性操作）

```bash
# 创建 GitHub PAT：GitHub → Settings → Developer settings → Personal access tokens
# 仅需 repo 权限（私有仓库读取）
deploy/manage.sh setup-token ghp_xxxxxxxxxxxx
```

Token 存储在 AWS Secrets Manager 中（加密保存），EC2 部署时动态拉取，不会出现在 CloudFormation 参数中。

Token 过期后只需重新执行 `setup-token` 更新即可，无需重新部署。

> **公开仓库**可跳过此步骤，脚本会自动检测并以无 token 模式部署。

### 执行部署

```bash
deploy/manage.sh deploy
```

自动完成：创建 VPC → Security Group → IAM Role → EBS 数据卷 → EC2 实例 → 实例内安装 Docker、克隆代码、构建镜像、启动服务。

等待约 **5-8 分钟**，脚本阻塞直到 Stack 创建完成并打印状态。

---

## 首次扫码（唯一需要人工介入的步骤）

EC2 启动后 Docker 镜像构建还需 **10-15 分钟**（下载 EasyOCR 模型 ~400MB），之后才会出现 QR 码。

```bash
# 连接到实例
deploy/manage.sh ssh

# 进入 EC2 后，查看 QR 码
sudo docker logs -f wa-bot

# 用手机 WhatsApp → 已连接的设备 → 扫描二维码
# 看到 "WhatsApp Bot 已就绪" 后 Ctrl+C，输入 exit 退出
```

扫码完成后凭证持久化到 EBS 数据卷，后续重启无需重复扫码。

---

## 验证服务正常

```bash
# 查看 Stack 和实例状态
deploy/manage.sh status

# 查看 Bot 日志（默认最近 50 行）
deploy/manage.sh logs

# 查看 OCR 服务日志
deploy/manage.sh logs ocr-service

# 指定行数
deploy/manage.sh logs wa-bot 100
```

---

## 日常省钱操作

| 操作 | 命令 | 停机时月费 | 恢复时间 |
|------|------|-----------|---------|
| 停止实例 | `deploy/manage.sh stop` | ~$4.1（EBS 卷） | ~1 分钟 |
| 启动实例 | `deploy/manage.sh start` | — | — |
| 删除 Stack | `deploy/manage.sh destroy` | ~$1.6（仅 Retain 数据卷） | ~8-15 分钟 |
| 查看费用 | `deploy/manage.sh cost` | — | — |

```bash
# 不用时停机（月费从 ~$71 降到 ~$4.1）
deploy/manage.sh stop

# 需要时恢复
deploy/manage.sh start

# 长期不用，销毁整个 Stack（月费降到 ~$1.6）
deploy/manage.sh destroy
```

---

## 环境变量覆盖

所有配置可通过环境变量自定义：

```bash
# 使用较小实例（省钱，月费 ~$38）
INSTANCE_TYPE=t3.medium deploy/manage.sh deploy

# 指定不同的 Stack 名称（多环境）
STACK_NAME=ocr-staging deploy/manage.sh deploy

# 部署指定分支
GIT_BRANCH=feature/xxx deploy/manage.sh deploy
```

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `STACK_NAME` | `automation-ocr` | CloudFormation Stack 名称 |
| `REGION` | `ap-southeast-1` | AWS 区域 |
| `GIT_REPO_URL` | `https://github.com/kelvinlee97/automation-ocr.git` | Git 仓库地址 |
| `GIT_BRANCH` | `main` | 部署分支 |
| `INSTANCE_TYPE` | `t3.large` | EC2 实例类型 |
| `DATA_VOLUME_SIZE` | `20` | 数据卷大小（GB） |
| `GITHUB_TOKEN_SECRET_NAME` | `$STACK_NAME/github-token` | Secrets Manager 中的 Secret 名称 |

---

## 常见场景

### WhatsApp Session 失效，需重新扫码

```bash
deploy/manage.sh ssh
# 进入实例后
sudo rm -rf /data/wwebjs_auth/*
sudo systemctl restart automation-ocr
sudo docker logs -f wa-bot  # 等待 QR 码出现后扫码
```

### 更新代码（不重建 Stack）

```bash
deploy/manage.sh ssh
# 进入实例后
cd /opt/automation-ocr
sudo git pull origin main
sudo docker compose build
sudo systemctl restart automation-ocr
```

### destroy 后重新部署

```bash
# destroy 后数据卷因 Retain 策略保留，重新 deploy 会创建新数据卷
# 如需复用旧数据，需手动挂载旧卷
deploy/manage.sh deploy
```

### 查看部署失败原因

```bash
# 检查 CloudFormation 事件
aws cloudformation describe-stack-events \
  --stack-name automation-ocr \
  --region ap-southeast-1 \
  --query "StackEvents[?ResourceStatus=='CREATE_FAILED']"

# 检查 EC2 User Data 日志
deploy/manage.sh ssh
sudo cat /var/log/user-data.log
```

---

## 所有子命令速查

```bash
deploy/manage.sh setup-token   # 存储 GitHub Token（私有仓库）
deploy/manage.sh deploy        # 创建 Stack（首次部署）
deploy/manage.sh status     # 查看 Stack 和实例状态
deploy/manage.sh stop       # 停止 EC2 实例
deploy/manage.sh start      # 启动 EC2 实例
deploy/manage.sh ssh        # SSM 连接实例
deploy/manage.sh logs       # 查看容器日志
deploy/manage.sh destroy    # 删除 Stack（需二次确认）
deploy/manage.sh cost       # 预估月费
```
