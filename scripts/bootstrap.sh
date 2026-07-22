#!/usr/bin/env bash
# bootstrap.sh —— DigitalOcean Droplet (Ubuntu 24.04) 一键部署脚本（幂等）
#
# 用法：
#   bash scripts/bootstrap.sh             # 一键跑完：system + deploy
#   bash scripts/bootstrap.sh system      # 只装系统依赖（docker / git / ufw / deploy 用户）
#   bash scripts/bootstrap.sh deploy      # 只做项目部署（拉代码 → .env 校验 → 启容器）
#
# 前置条件（仅一次）：
#   - Ubuntu 24.04 LTS，root 或 sudo 权限执行
#   - 已在 Droplet 上配好 SSH key
#   - 准备好 GEMINI_API_KEY、SESSION_SECRET、DOMAIN
#
set -e

# ============================================================
# 全局常量
# ============================================================

# 项目落地路径
APP_DIR="/opt/claimflow"

# 拉代码用的 SSH 仓库地址
REPO_URL="git@github.com:kelvinlee97/ClaimFlow.git"

# 部署用户名
DEPLOY_USER="deploy"

# 非 root 时统一加 sudo
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

# 统一打印格式
log_run()  { echo "[run]  $*"; }
log_skip() { echo "[skip] $*"; }
log_ok()   { echo "[ok]   $*"; }
log_err()  { echo "[err]  $*" >&2; }

# ============================================================
# system 阶段：系统依赖 + 安全配置
# 每步先检查是否已就绪，就绪则 skip，未就绪则执行（失败即终止）
# ============================================================
do_system() {
  echo "=== [1/2] 系统依赖 ==="

  # 1.1 apt 索引刷新
  log_run "apt-get update"
  $SUDO apt-get update -qq

  # 1.2 基础工具（git ca-certificates curl gnupg lsb-release ufw）
  local pkgs_needed=()
  for pkg in git ca-certificates curl gnupg lsb-release ufw; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
      pkgs_needed+=("$pkg")
    fi
  done
  if [ ${#pkgs_needed[@]} -eq 0 ]; then
    log_skip "基础工具均已安装"
  else
    log_run "安装基础工具: ${pkgs_needed[*]}"
    $SUDO apt-get install -y "${pkgs_needed[@]}"
  fi

  # 1.3 Docker 官方 apt 源
  if [ -f /etc/apt/keyrings/docker.gpg ] && [ -f /etc/apt/sources.list.d/docker.list ]; then
    log_skip "Docker apt 源已配置"
  else
    log_run "添加 Docker 官方 apt 源"
    $SUDO install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      $SUDO tee /etc/apt/sources.list.d/docker.list > /dev/null
    $SUDO apt-get update -qq
  fi

  # 1.4 Docker Engine + Compose plugin
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log_skip "Docker Engine + compose plugin 已安装 ($(docker --version))"
  else
    log_run "安装 docker-ce + compose plugin"
    $SUDO apt-get install -y \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi

  # 1.5 创建 deploy 用户（CI/CD SSH 部署用）
  if id "$DEPLOY_USER" >/dev/null 2>&1; then
    log_skip "用户 $DEPLOY_USER 已存在"
  else
    log_run "创建用户 $DEPLOY_USER 并加入 docker 组"
    $SUDO useradd -m -s /bin/bash "$DEPLOY_USER"
    $SUDO usermod -aG docker "$DEPLOY_USER"
  fi

  # 1.6 确保 deploy 用户在 docker 组
  if id -nG "$DEPLOY_USER" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    log_skip "$DEPLOY_USER 已在 docker 组"
  else
    log_run "将 $DEPLOY_USER 加入 docker 组"
    $SUDO usermod -aG docker "$DEPLOY_USER"
  fi

  # 1.7 docker 开机自启
  if systemctl is-enabled docker >/dev/null 2>&1 && systemctl is-active docker >/dev/null 2>&1; then
    log_skip "docker 服务已 enabled 且 active"
  else
    log_run "启用并启动 docker 服务"
    $SUDO systemctl enable --now docker
  fi

  # 1.8 UFW 防火墙配置
  if $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    log_skip "UFW 已启用"
  else
    log_run "配置 UFW 防火墙（允许 22, 80, 443）"
    $SUDO ufw default deny incoming
    $SUDO ufw default allow outgoing
    $SUDO ufw allow 22/tcp    # SSH
    $SUDO ufw allow 80/tcp    # HTTP（Caddy 重定向到 HTTPS）
    $SUDO ufw allow 443/tcp   # HTTPS
    $SUDO ufw allow 443/udp   # HTTP/3 (QUIC)
    $SUDO ufw --force enable
  fi

  # 1.9 项目目录（属主为 deploy 用户）
  if [ -d "$APP_DIR" ]; then
    log_skip "项目目录 $APP_DIR 已存在"
  else
    log_run "创建项目目录 $APP_DIR"
    $SUDO mkdir -p "$APP_DIR"
    $SUDO chown "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR"
  fi

  log_ok "系统依赖就绪"
}

# ============================================================
# deploy 阶段：项目部署
# ============================================================
do_deploy() {
  echo "=== [2/2] 项目部署 ==="

  # 2.1 代码：没 clone 过则 clone，已存在则 git pull
  if [ ! -d "$APP_DIR/.git" ]; then
    log_run "首次 clone 代码到 $APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
  else
    log_run "已存在代码，git pull 拉最新"
    cd "$APP_DIR" && git pull --ff-only
  fi

  cd "$APP_DIR"

  # 2.2 .env 校验
  if [ ! -f .env ]; then
    log_err "$APP_DIR/.env 不存在，请先创建并填入："
    cat >&2 <<'EOF'
  GEMINI_API_KEY=<你的 Gemini key>
  SESSION_SECRET=<任意长随机串，例如 openssl rand -hex 32>
  DOMAIN=<你的域名，例如 admin.example.com>
  # 可选：IMAGE_URI=ghcr.io/kelvinlee97/claimflow:latest
EOF
    exit 1
  fi
  for key in GEMINI_API_KEY SESSION_SECRET DOMAIN; do
    if ! grep -qE "^${key}=.+" .env; then
      log_err ".env 缺少必填项 $key（值不能为空）"
      exit 1
    fi
  done
  log_skip ".env 必填项齐全 (GEMINI_API_KEY / SESSION_SECRET / DOMAIN)"

  # 2.3 数据目录
  if [ -d data/wwebjs_auth ]; then
    log_skip "数据目录已存在 (data/, data/wwebjs_auth/)"
  else
    log_run "创建数据目录 data/wwebjs_auth/"
    mkdir -p data/wwebjs_auth
  fi

  # 2.4 容器：拉新镜像 + 启动/重启（连贯命令不拆开）
  log_run "docker compose pull && up -d"
  docker compose pull && docker compose up -d --remove-orphans

  # 2.5 启动后自检
  echo
  docker compose ps

  cat <<'EOF'

==========================================================
 部署完成
 后续命令：
   docker compose logs -f        # 看日志
   docker compose restart        # 重启
   docker compose exec wa-bot sh # 进容器
 首次启动需扫 WhatsApp 二维码：用 logs 命令观察输出。
==========================================================
EOF
}

# ============================================================
# 子命令分发
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
