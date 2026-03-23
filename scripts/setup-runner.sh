#!/bin/bash
# 在 EC2 服务器上一次性执行，安装 GitHub Actions self-hosted runner
# 以 ubuntu 用户身份运行：sudo -u ubuntu bash setup-runner.sh
set -e

RUNNER_VERSION="2.333.0"
REPO_URL="https://github.com/kelvinlee97/automation-ocr"
RUNNER_TOKEN="${1:-}"  # 第一个参数传入 registration token

if [ -z "$RUNNER_TOKEN" ]; then
  echo "用法: bash setup-runner.sh <REGISTRATION_TOKEN>"
  echo "在 GitHub → Settings → Actions → Runners → New self-hosted runner 获取 token"
  exit 1
fi

RUNNER_DIR="/home/ubuntu/actions-runner"

# 创建目录（若已存在则跳过）
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# 下载 runner（若已存在则跳过）
if [ ! -f "run.sh" ]; then
  echo ">>> 下载 runner v${RUNNER_VERSION}..."
  curl -fsSL -o runner.tar.gz \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  tar xzf runner.tar.gz
  rm runner.tar.gz
fi

# 注册 runner
echo ">>> 注册 runner..."
./config.sh \
  --url "$REPO_URL" \
  --token "$RUNNER_TOKEN" \
  --name "ec2-self-hosted" \
  --labels "self-hosted,linux,x64" \
  --work "_work" \
  --unattended \
  --replace

# 安装为 systemd 服务（需要 root，所以用 sudo）
echo ">>> 安装 systemd 服务..."
sudo ./svc.sh install ubuntu   # 以 ubuntu 用户运行服务
sudo ./svc.sh start

echo ""
echo "✅ Runner 安装完成！状态："
sudo ./svc.sh status
