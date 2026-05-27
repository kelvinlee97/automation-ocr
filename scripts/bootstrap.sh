#!/usr/bin/env bash
# bootstrap.sh —— EC2 (Ubuntu) 一键部署脚本（幂等：已就绪的步骤会自动 skip）
#
# 用法（推荐新手直接这条）：
#   bash scripts/bootstrap.sh             # 一键跑完：装系统依赖 + 拉代码 + 启容器
#
# 进阶用法（只想跑某一段时）：
#   bash scripts/bootstrap.sh system      # 只装系统依赖（docker / git / compose plugin）
#   bash scripts/bootstrap.sh deploy      # 只做项目部署（拉代码 → .env 校验 → 启容器）
#
# 设计原则：
#   - 每一步先检测当前状态，已经做过的直接跳过并打印 [skip]，没做过的才执行 [run]。
#   - 重复跑安全：装好 docker 不会重装，代码已 clone 会 git pull，容器在跑会 pull 新镜像并重启。
#   - "docker 组刚加进去还没生效" 的坑：脚本会自动用 sudo 兜底，无需 exit 重新登录。
#
# 前置条件（仅一次）：
#   - Ubuntu 22.04 / 24.04（LTS），用 sudo 权限的用户执行（如 ubuntu）
#   - EC2 安全组已放行 22（SSH）、80/443（如需 Nginx 反代外部访问）
#   - 已在 EC2 上配好 SSH key，并加入 GitHub deploy keys 或个人账户 SSH keys
#   - 准备好 Gemini API key 和一个长随机串（SESSION_SECRET）

set -e

# ============================================================
# 全局常量与小工具
# ============================================================

# 项目落地路径
APP_DIR="/home/ubuntu/automation-ocr"

# 拉代码用的 SSH 仓库地址
REPO_URL="git@github.com:kelvinlee97/automation-ocr.git"

# 非 root 时所有特权命令统一加 sudo 前缀
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

# 统一打印格式，让新手清楚看到 "哪一步在干嘛 / 跳过没"
log_run()  { echo "[run]  $*"; }
log_skip() { echo "[skip] $*"; }
log_ok()   { echo "[ok]   $*"; }
log_err()  { echo "[err]  $*" >&2; }

# 选择 docker 命令前缀：
# - 当前 shell 已生效 docker 组 → 直接 docker
# - 否则（首次装完没重登）→ 加 sudo 兜底，避免要求用户 exit 重连
docker_cmd() {
  if id -nG | tr ' ' '\n' | grep -qx docker; then
    echo "docker"
  else
    echo "sudo docker"
  fi
}

# ============================================================
# system 阶段：系统级依赖（docker / git / compose plugin）
# 每个子步骤都做幂等检测
# ============================================================
do_system() {
  echo "=== [1/2] 系统依赖 ==="

  # 1.1 apt 索引刷新（每次跑都刷一下，廉价；连贯命令保持一体）
  log_run "apt-get update"
  $SUDO apt-get update -qq

  # 1.2 基础工具：git / 加 docker 源所需的证书与 gpg 工具
  #     用 dpkg -s 检测是否已装；只装缺的，避免每次都跑一遍
  local pkgs_needed=()
  for pkg in git ca-certificates curl gnupg lsb-release; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
      pkgs_needed+=("$pkg")
    fi
  done
  if [ ${#pkgs_needed[@]} -eq 0 ]; then
    log_skip "基础工具均已安装 (git / ca-certificates / curl / gnupg / lsb-release)"
  else
    log_run "安装基础工具: ${pkgs_needed[*]}"
    $SUDO apt-get install -y "${pkgs_needed[@]}"
  fi

  # 1.3 Docker 官方 apt 源（已配置则跳过；用 keyring 文件存在 + sources.list 存在判断）
  if [ -f /etc/apt/keyrings/docker.gpg ] && [ -f /etc/apt/sources.list.d/docker.list ]; then
    log_skip "Docker apt 源已配置"
  else
    log_run "添加 Docker 官方 apt 源"
    $SUDO install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
    # 架构和发行版代号都从系统读，不写死
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      $SUDO tee /etc/apt/sources.list.d/docker.list > /dev/null
    # 加完源得再 update 一次，否则装不到 docker-ce
    $SUDO apt-get update -qq
  fi

  # 1.4 Docker Engine + Compose plugin（已装则跳过）
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log_skip "Docker Engine + compose plugin 已安装 ($(docker --version))"
  else
    log_run "安装 docker-ce + compose plugin"
    $SUDO apt-get install -y \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi

  # 1.5 当前用户加进 docker 组（已在则跳过）
  if id -nG "$USER" | tr ' ' '\n' | grep -qx docker; then
    log_skip "$USER 已在 docker 组"
  else
    log_run "把 $USER 加进 docker 组（本次会话用 sudo 兜底，下次 ssh 自动生效）"
    $SUDO usermod -aG docker "$USER"
  fi

  # 1.6 docker 开机自启 + 当前已运行（已 enabled+active 则跳过）
  if systemctl is-enabled docker >/dev/null 2>&1 && systemctl is-active docker >/dev/null 2>&1; then
    log_skip "docker 服务已 enabled 且 active"
  else
    log_run "启用并启动 docker 服务"
    $SUDO systemctl enable --now docker
  fi

  log_ok "系统依赖就绪"
}

# ============================================================
# deploy 阶段：项目部署（代码 / .env / 容器）
# 每一步同样做幂等检测
# ============================================================
do_deploy() {
  echo "=== [2/2] 项目部署 ==="

  local DOCKER
  DOCKER=$(docker_cmd)

  # 2.1 代码：没 clone 过则 clone，已存在则 git pull
  if [ ! -d "$APP_DIR/.git" ]; then
    log_run "首次 clone 代码到 $APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
  else
    log_run "已存在代码，git pull 拉最新（连贯命令）"
    cd "$APP_DIR" && git pull --ff-only
  fi

  cd "$APP_DIR"

  # 2.2 .env 校验：必填项是 docker-compose.yml 引用的环境变量
  #     - GEMINI_API_KEY: Gemini OCR 必需
  #     - SESSION_SECRET: 固定 session 密钥，缺了重启即登出
  #     - IMAGE_URI: 容器镜像地址（可选，缺省 fallback 到 ghcr.io）
  if [ ! -f .env ]; then
    log_err "$APP_DIR/.env 不存在，请先创建并填入："
    cat >&2 <<'EOF'
  GEMINI_API_KEY=<你的 Gemini key>
  SESSION_SECRET=<任意长随机串，例如 openssl rand -hex 32>
  # 可选：IMAGE_URI=<ECR 或 GHCR 镜像地址>:latest

填好后再跑 bash scripts/bootstrap.sh （或 bash scripts/bootstrap.sh deploy）
EOF
    exit 1
  fi
  for key in GEMINI_API_KEY SESSION_SECRET; do
    if ! grep -qE "^${key}=.+" .env; then
      log_err ".env 缺少必填项 $key（值不能为空）"
      exit 1
    fi
  done
  log_skip ".env 必填项齐全 (GEMINI_API_KEY / SESSION_SECRET)"

  # 2.3 数据目录（docker-compose.yml 里挂载的宿主机路径）
  #     - data/             收据图片 / Excel
  #     - data/wwebjs_auth/ WhatsApp 登录凭据（删除 = 强制重新扫码）
  if [ -d data/wwebjs_auth ]; then
    log_skip "数据目录已存在 (data/, data/wwebjs_auth/)"
  else
    log_run "创建数据目录 data/wwebjs_auth/"
    mkdir -p data/wwebjs_auth
  fi

  # 2.4 容器：拉新镜像 + 启动/重启（连贯命令不拆开，跟 docker.sh restart 一致）
  #     即使容器在跑，也 pull && up -d 一次以拿到最新镜像；compose 会自动判断是否真的需要重建
  log_run "docker compose pull && up -d（已是最新会自动 no-op）"
  $DOCKER compose pull && $DOCKER compose up -d

  # 2.5 启动后简短自检
  echo
  $DOCKER compose ps

  cat <<'EOF'

==========================================================
 部署完成 ✓
 常用后续命令：
   - 看日志:    bash scripts/docker.sh logs
   - 重启:      bash scripts/docker.sh restart
   - 进容器:    bash scripts/docker.sh shell
 首次启动需扫 WhatsApp 二维码：用 logs 命令观察输出。
==========================================================
EOF
}

# ============================================================
# 子命令分发：默认（无参）= 一键跑完 system + deploy
# ============================================================
case "${1:-all}" in
  all)
    do_system
    do_deploy
    ;;
  system)
    do_system
    ;;
  deploy)
    do_deploy
    ;;
  *)
    echo "未知子命令: $1"
    echo "可用: (空) | all | system | deploy"
    exit 1
    ;;
esac
