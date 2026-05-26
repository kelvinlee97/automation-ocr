#!/usr/bin/env bash
# ec2-bootstrap.sh —— EC2 (Ubuntu) 部署的一站式脚本
# 用法:
#   bash scripts/ec2-bootstrap.sh bootstrap   # 裸机系统初始化（装 docker / git / compose plugin）
#   bash scripts/ec2-bootstrap.sh deploy      # 项目部署：拉代码 → 校验 .env → 建目录 → 启动容器
#
# 典型流程（首次开新实例）：
#   1) ssh 上 EC2 之后:  bash scripts/ec2-bootstrap.sh bootstrap
#   2) exit 重新登录（让 docker 组生效）
#   3) bash scripts/ec2-bootstrap.sh deploy
#
# 设计说明：
#   - 两个子命令拆得很清楚，bootstrap 只动系统、deploy 只动项目。
#   - bootstrap 在没装 git 之前是跑不到这个脚本本身的（鸡生蛋）；
#     所以惯用法是：先 ssh 上去手动 apt install -y git，git clone 项目后再跑 bootstrap。
#   - 也可以 scp 这个脚本上去单跑 bootstrap，然后再 git clone + 跑 deploy。
#
# 前置条件：
#   - Ubuntu 22.04 / 24.04（LTS），用 sudo 权限的用户执行（如 ubuntu）
#   - 已开放安全组：22（SSH）、80/443（如需 Nginx 反代外部访问）
#   - 部署目标用户：ubuntu，项目路径：/home/ubuntu/automation-ocr
#   - 拉代码用 SSH（git@github.com:kelvinlee97/automation-ocr.git），
#     需在 EC2 上配好 SSH key 并加到 GitHub deploy keys 或个人账户。

set -e

# ------------------------------------------------------------
# 全局变量（两个子命令共用）
# ------------------------------------------------------------

# 项目落地路径，跟 memory 里 deploy 目标一致
APP_DIR="/home/ubuntu/automation-ocr"

# 拉代码用的 SSH 仓库地址
REPO_URL="git@github.com:kelvinlee97/automation-ocr.git"

# 非 root 时所有特权命令统一加 sudo 前缀
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

# ------------------------------------------------------------
# 子命令: bootstrap —— 裸机系统级初始化
# ------------------------------------------------------------
do_bootstrap() {
  # 1. 刷新 apt 索引并升级已装包（连贯命令保持一体，中间任一失败立即停）
  $SUDO apt-get update && $SUDO apt-get upgrade -y

  # 2. 装基础工具：git 拉代码，ca-certificates/curl/gnupg 是加 docker 官方源要用的
  $SUDO apt-get install -y git ca-certificates curl gnupg lsb-release

  # 3. 添加 Docker 官方 GPG key（Ubuntu 自带的 docker.io 版本偏旧，这里用官方源）
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

  # 4. 写入 Docker apt 源（架构和发行版代号都从系统读，不写死）
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    $SUDO tee /etc/apt/sources.list.d/docker.list > /dev/null

  # 5. 安装 Docker Engine + Compose plugin（连贯命令不拆开）
  $SUDO apt-get update && $SUDO apt-get install -y \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  # 6. 把当前用户加进 docker 组，免去后续每次 sudo docker
  #    注意：组关系要重新登录后才生效，本脚本不主动 newgrp（避免吞掉后续命令）
  $SUDO usermod -aG docker "$USER"

  # 7. 让 docker 开机自启，重启实例后容器能自动恢复
  $SUDO systemctl enable --now docker

  # 8. 简单自检：打印版本号确认装上了（用 sudo 跑，避免 docker 组未生效干扰）
  $SUDO docker --version
  $SUDO docker compose version

  cat <<'EOF'

==========================================================
 bootstrap 完成。
 下一步：
   1) exit 退出当前 SSH，再重新 ssh 登录（让 docker 组生效）
   2) 跑 bash scripts/ec2-bootstrap.sh deploy 拉代码并启动容器
==========================================================
EOF
}

# ------------------------------------------------------------
# 子命令: deploy —— 项目部署（首次或更新）
# ------------------------------------------------------------
do_deploy() {
  # 1. 校验 docker 组已生效（bootstrap 后没重登的常见坑）
  if ! docker ps >/dev/null 2>&1; then
    echo "ERROR: 当前用户无法直接跑 docker。" >&2
    echo "  原因：bootstrap 把你加进了 docker 组，但需要 exit 重新登录后才生效。" >&2
    exit 1
  fi

  # 2. 首次拉代码 / 已存在则更新（连贯命令不拆开：cd 后立刻 pull）
  if [ ! -d "$APP_DIR/.git" ]; then
    # 首次部署：clone 到目标目录
    git clone "$REPO_URL" "$APP_DIR"
  else
    # 已部署过：更新到最新主干
    cd "$APP_DIR" && git pull --ff-only
  fi

  cd "$APP_DIR"

  # 3. 校验 .env 必填项（docker-compose.yml 引用的环境变量）
  #    - GEMINI_API_KEY: Gemini OCR 必需
  #    - SESSION_SECRET: 固定 session 密钥，缺了重启即登出
  #    - IMAGE_URI: 容器镜像地址（可选，缺省 fallback 到 ghcr.io）
  if [ ! -f .env ]; then
    cat >&2 <<EOF
ERROR: $APP_DIR/.env 不存在。

请手动创建并至少填入：
  GEMINI_API_KEY=<你的 Gemini key>
  SESSION_SECRET=<任意长随机串>
  # 可选：IMAGE_URI=<ECR 或 GHCR 镜像地址>:latest

填好后再跑 bash scripts/ec2-bootstrap.sh deploy
EOF
    exit 1
  fi

  # 必填项做硬校验，缺了直接报错（避免容器起来才发现缺 key）
  for key in GEMINI_API_KEY SESSION_SECRET; do
    if ! grep -qE "^${key}=.+" .env; then
      echo "ERROR: .env 缺少必填项 $key（值不能为空）" >&2
      exit 1
    fi
  done

  # 4. 准备数据目录（docker-compose.yml 里挂载的宿主机路径）
  #    - data/        : 收据图片 / Excel
  #    - data/wwebjs_auth/ : WhatsApp 登录凭据（删除 = 强制重新扫码）
  mkdir -p data/wwebjs_auth

  # 5. 拉镜像 + 后台启动容器（连贯命令不拆开，跟 docker.sh restart 一致）
  docker compose pull && docker compose up -d

  # 6. 启动后简短自检
  docker compose ps

  cat <<'EOF'

==========================================================
 deploy 完成。
 常用后续命令：
   - 看日志:    bash scripts/docker.sh logs
   - 重启:      bash scripts/docker.sh restart
   - 进容器:    bash scripts/docker.sh shell
 首次启动需扫 WhatsApp 二维码：用 logs 命令观察输出。
==========================================================
EOF
}

# ------------------------------------------------------------
# 子命令分发
# ------------------------------------------------------------
case "${1:-}" in
  bootstrap)
    do_bootstrap
    ;;
  deploy)
    do_deploy
    ;;
  *)
    echo "未知子命令: ${1:-(空)}"
    echo "可用: bootstrap | deploy"
    exit 1
    ;;
esac
