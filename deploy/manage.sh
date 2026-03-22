#!/usr/bin/env bash
# ================================================================
# AWS Lightsail 一键部署脚本 — WhatsApp OCR Bot (AI 重构版)
# 用法: ./deploy/manage.sh deploy | destroy
# ================================================================
set -euo pipefail
export AWS_PAGER=""

# ── 配置常量 ──────────────────────────────────────────────────
INSTANCE_NAME="wa-bot-ai"
REGION="ap-southeast-1"
BUNDLE_ID="micro_3_0"   # $5 档位 (1GB RAM, 2 vCPU)
BLUEPRINT_ID="ubuntu_22_04"
GIT_REPO_URL="https://github.com/kelvinlee97/automation-ocr.git"

# ── 颜色输出 ──────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

_log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
_log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
_log_error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── 检查依赖 ──────────────────────────────────────────────────
if ! command -v aws &> /dev/null; then
    _log_error "未检测到 AWS CLI，请先安装并配置。"
fi

# ── 子命令：部署 ──────────────────────────────────────────────
cmd_deploy() {
    # 1. 获取 API Keys
    if [[ -z "${GEMINI_API_KEY:-}" ]]; then
        echo -n "请输入你的 Gemini API Key: "
        read -s key
        echo ""
        export GEMINI_API_KEY=$key
    fi
    if [[ -z "${GH_TOKEN:-}" ]]; then
        echo -n "请输入你的 GitHub Token (用于克隆私有仓库): "
        read -s token
        echo ""
        export GH_TOKEN=$token
    fi

    _log_info "正在检测本地 SSH 公钥..."
    local ssh_pub_key=""
    local key_path="$HOME/.ssh/kelvin97.pem"
    local pub_path="$HOME/.ssh/kelvin97.pub"

    if [[ -f "$pub_path" ]]; then
        ssh_pub_key=$(cat "$pub_path")
    elif [[ -f "$key_path" ]]; then
        ssh_pub_key=$(ssh-keygen -y -f "$key_path" 2>/dev/null || true)
    fi

    if [[ -n "$ssh_pub_key" ]]; then
        _log_info "检测到本地公钥，将自动注入以支持 SSH 登录。"
    else
        _log_warn "未发现本地公钥，可能无法直接 SSH 登录。"
    fi

    _log_info "正在启动 Lightsail 实例: $INSTANCE_NAME ..."

    # 2. 编写 User Data (启动脚本)
    USER_DATA=$(cat <<EOF
#!/bin/bash
export DEBIAN_FRONTEND=noninteractive

# 注入公钥
if [ -n "$ssh_pub_key" ]; then
  mkdir -p /home/ubuntu/.ssh
  echo "$ssh_pub_key" >> /home/ubuntu/.ssh/authorized_keys
  chown -R ubuntu:ubuntu /home/ubuntu/.ssh
  chmod 700 /home/ubuntu/.ssh
  chmod 600 /home/ubuntu/.ssh/authorized_keys
fi

# 安装基础依赖和 GH
apt-get update
apt-get install -y docker.io docker-compose git curl
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /usr/share/keyrings/githubcli-archive-keyring.gpg > /dev/null
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=\$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
apt-get update
apt-get install -y gh

# 启动 Docker
systemctl enable docker
systemctl start docker

# 克隆并运行
cd /home/ubuntu
echo "$GH_TOKEN" | gh auth login --with-token
REPO_PATH=\$(echo "$GIT_REPO_URL" | sed -e 's|https://github.com/||' -e 's|\\.git\$||')
gh repo clone "\$REPO_PATH"
cd automation-ocr
echo "GEMINI_API_KEY=$GEMINI_API_KEY" > .env
docker-compose up -d --build

# 权限处理
chown -R ubuntu:ubuntu /home/ubuntu/automation-ocr
EOF
)

    # 3. 创建实例
    aws lightsail create-instances \
        --instance-names "$INSTANCE_NAME" \
        --availability-zone "${REGION}a" \
        --blueprint-id "$BLUEPRINT_ID" \
        --bundle-id "$BUNDLE_ID" \
        --user-data "$USER_DATA" \
        --region "$REGION" > /dev/null

    _log_info "实例创建成功。正在关联静态 IP..."
    sleep 5

    # 4. 静态 IP
    STATIC_IP_NAME="${INSTANCE_NAME}-static-ip"
    aws lightsail allocate-static-ip --static-ip-name "$STATIC_IP_NAME" --region "$REGION" > /dev/null || true
    aws lightsail attach-static-ip --static-ip-name "$STATIC_IP_NAME" --instance-name "$INSTANCE_NAME" --region "$REGION" > /dev/null

    PUBLIC_IP=$(aws lightsail get-static-ip --static-ip-name "$STATIC_IP_NAME" --region "$REGION" --query "staticIp.ipAddress" --output text)

    _log_info "部署任务已下发！"
    echo "------------------------------------------------"
    echo -e "服务器公网 IP: ${GREEN}$PUBLIC_IP${NC}"
    echo ""
    echo "请等待 3-5 分钟让服务器完成安装，然后扫码登录："
    echo -e "${YELLOW}ssh -i ~/.ssh/kelvin97.pem ubuntu@$PUBLIC_IP \"docker logs -f wa-bot\"${NC}"
    echo "------------------------------------------------"
}

# ── 子命令：销毁 ──────────────────────────────────────────────
cmd_destroy() {
    _log_warn "确认销毁实例 $INSTANCE_NAME 吗？(y/N)"
    read -r confirm
    if [[ "$confirm" != "y" ]]; then exit 0; fi

    _log_info "清理资源中..."
    aws lightsail delete-instance --instance-name "$INSTANCE_NAME" --region "$REGION" > /dev/null
    aws lightsail release-static-ip --static-ip-name "${INSTANCE_NAME}-static-ip" --region "$REGION" > /dev/null || true
    _log_info "已成功销毁。"
}

# ── 入口 ──────────────────────────────────────────────────────
case "${1:-}" in
    deploy)  cmd_deploy ;;
    destroy) cmd_destroy ;;
    *)       echo "用法: $0 {deploy|destroy}" ;;
esac
