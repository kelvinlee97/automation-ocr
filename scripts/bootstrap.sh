#!/usr/bin/env bash
# bootstrap.sh - DigitalOcean Droplet (Ubuntu 24.04) one-click deployment script (idempotent)
#
# usage:
#   bash scripts/bootstrap.sh # Run with one click: system + deploy
#   bash scripts/bootstrap.sh system # Only install system dependencies (docker / git / ufw / deploy users)
#   bash scripts/bootstrap.sh deploy # Only do project deployment (pull code → .env verification → start container)
#
# Precondition (only once):
#   - Ubuntu 24.04 LTS, executed with root or sudo privileges
#   - The SSH key has been configured on the Droplet
#   - Prepare GEMINI_API_KEY, SESSION_SECRET, DOMAIN
#
set -e

# ============================================================
# global constants
# ============================================================

# Project implementation path
APP_DIR="/opt/claimflow"

# SSH repository address used to pull the code
REPO_URL="git@github.com:kelvinlee97/ClaimFlow.git"

# Deployment username
DEPLOY_USER="deploy"

# If you are not root, add sudo.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

# Unified printing format
log_run()  { echo "[run]  $*"; }
log_skip() { echo "[skip] $*"; }
log_ok()   { echo "[ok]   $*"; }
log_err()  { echo "[err]  $*" >&2; }

# ============================================================
# system stage: system dependencies + security configuration
# Each step first checks whether it is ready. If it is ready, skip it. If it is not ready, execute it (if it fails, it will terminate)
# ============================================================
do_system() {
  echo "=== [1/2] System dependencies ==="

  # 1.1 apt index refresh
  log_run "apt-get update"
  $SUDO apt-get update -qq

  # 1.2 Basic tools (git ca-certificates curl gnupg lsb-release ufw)
  local pkgs_needed=()
  for pkg in git ca-certificates curl gnupg lsb-release ufw; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
      pkgs_needed+=("$pkg")
    fi
  done
  if [ ${#pkgs_needed[@]} -eq 0 ]; then
    log_skip "Basic tools have been installed"
  else
    log_run "Install basic tools: ${pkgs_needed[*]}"
    $SUDO apt-get install -y "${pkgs_needed[@]}"
  fi

  # 1.3 Docker official apt source
  if [ -f /etc/apt/keyrings/docker.gpg ] && [ -f /etc/apt/sources.list.d/docker.list ]; then
    log_skip "Docker apt source configured"
  else
    log_run "Add Docker official apt source"
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
    log_skip "Docker Engine + compose plugin installed ($(docker --version))"
  else
    log_run "Install docker-ce + compose plugin"
    $SUDO apt-get install -y \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi

  # 1.5 Create deploy user (for CI/CD SSH deployment)
  if id "$DEPLOY_USER" >/dev/null 2>&1; then
    log_skip "User $DEPLOY_USER already exists"
  else
    log_run "Create user $DEPLOY_USER and join docker group"
    $SUDO useradd -m -s /bin/bash "$DEPLOY_USER"
    $SUDO usermod -aG docker "$DEPLOY_USER"
  fi

  # 1.6 Make sure the deploy user is in the docker group
  if id -nG "$DEPLOY_USER" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    log_skip "$DEPLOY_USER is already in the docker group"
  else
    log_run "Add $DEPLOY_USER to the docker group"
    $SUDO usermod -aG docker "$DEPLOY_USER"
  fi

  # 1.7 docker starts automatically after booting
  if systemctl is-enabled docker >/dev/null 2>&1 && systemctl is-active docker >/dev/null 2>&1; then
    log_skip "The docker service is enabled and active"
  else
    log_run "Enable and start the docker service"
    $SUDO systemctl enable --now docker
  fi

  # 1.8 UFW firewall configuration
  if $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    log_skip "UFW is enabled"
  else
    log_run "Configure UFW firewall (allow 22, 80, 443)"
    $SUDO ufw default deny incoming
    $SUDO ufw default allow outgoing
    $SUDO ufw allow 22/tcp    # SSH
    $SUDO ufw allow 80/tcp    # HTTP (Caddy redirects to HTTPS)
    $SUDO ufw allow 443/tcp   # HTTPS
    $SUDO ufw allow 443/udp   # HTTP/3 (QUIC)
    $SUDO ufw --force enable
  fi

  # 1.9 Project directory (the owner is the deploy user)
  if [ -d "$APP_DIR" ]; then
    log_skip "Project directory $APP_DIR already exists"
  else
    log_run "Create project directory $APP_DIR"
    $SUDO mkdir -p "$APP_DIR"
    $SUDO chown "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR"
  fi

  log_ok "System dependencies are ready"
}

# ============================================================
# deploy stage: project deployment
# ============================================================
do_deploy() {
  echo "=== [2/2] Project Deployment ==="

  # 2.1 Code: If clone has not been cloned, clone, if it exists, git pull
  if [ ! -d "$APP_DIR/.git" ]; then
    log_run "First clone code to $APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
  else
    log_run "Code already exists, git pull pulls the latest"
    cd "$APP_DIR" && git pull --ff-only
  fi

  cd "$APP_DIR"

  # 2.2 .env verification
  if [ ! -f .env ]; then
    log_err "$APP_DIR/.env does not exist, please create it first and fill in:"
    cat >&2 <<'EOF'
  GEMINI_API_KEY=<your Gemini key>
  SESSION_SECRET=<a long random string, e.g. openssl rand -hex 32>
  DOMAIN=<your domain, e.g. admin.example.com>
  # Optional: IMAGE_URI=ghcr.io/kelvinlee97/claimflow:latest
EOF
    exit 1
  fi
  for key in GEMINI_API_KEY SESSION_SECRET DOMAIN; do
    if ! grep -qE "^${key}=.+" .env; then
      log_err ".env is missing required $key (value cannot be empty)"
      exit 1
    fi
  done
  log_skip ".env has all required fields (GEMINI_API_KEY / SESSION_SECRET / DOMAIN)"

  # 2.3 Data directory
  if [ -d data/wwebjs_auth ]; then
    log_skip "The data directory already exists (data/, data/wwebjs_auth/)"
  else
    log_run "Create data directory data/wwebjs_auth/"
    mkdir -p data/wwebjs_auth
  fi

  # 2.4 Container: Pull new image + start/restart (consecutive commands do not disassemble)
  log_run "docker compose pull && up -d"
  docker compose pull && docker compose up -d --remove-orphans

  # 2.5 Self-check after startup
  echo
  docker compose ps

  cat <<'EOF'

==========================================================
 Deployment complete
 Useful commands:
   docker compose logs -f        # View logs
   docker compose restart        # Restart
   docker compose exec wa-bot sh # Open a shell in the container
 On first startup, scan the WhatsApp QR code. Use the logs command to view it.
==========================================================
EOF
}

# ============================================================
# Subcommand distribution
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
    echo "Unknown subcommand: $1"
    echo "Available: (null) | all | system | deploy"
    exit 1
    ;;
esac
