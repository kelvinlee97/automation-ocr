#!/usr/bin/env bash
# ================================================================
# EC2 服务器首次初始化脚本
# 用途：新服务器或重建后执行一次，配置 Nginx 反代和 .env 基础变量
# 用法：在服务器上执行 bash deploy/server-init.sh
# 前提：已 clone 仓库到 ~/automation-ocr，.env 中已有 GEMINI_API_KEY
# ================================================================
set -euo pipefail

# ── 颜色输出 ──────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── 前置检查 ──────────────────────────────────────────────────
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
    log_error ".env 文件不存在，请先创建并填入 GEMINI_API_KEY=xxx，再运行此脚本"
fi

if ! grep -q "GEMINI_API_KEY" "$ENV_FILE"; then
    log_error ".env 中缺少 GEMINI_API_KEY，请先填入后再运行"
fi

# ── 1. 安装 Nginx ─────────────────────────────────────────────
log_info "安装 Nginx..."
sudo apt-get update -q
sudo apt-get install -y -q nginx

# ── 2. 配置 Nginx 反代 ────────────────────────────────────────
log_info "写入 Nginx 反代配置..."
sudo tee /etc/nginx/sites-available/wa-bot > /dev/null <<'EOF'
server {
    listen 80;
    server_name _;

    # 上传图片最大 10MB（收据截图场景）
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # 管理后台轮询 QR 状态，避免过早超时断开
        proxy_read_timeout 60s;
    }
}
EOF

# 启用站点，禁用默认配置
sudo ln -sf /etc/nginx/sites-available/wa-bot /etc/nginx/sites-enabled/wa-bot
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t || log_error "Nginx 配置验证失败，请检查上方错误信息"
sudo systemctl enable --now nginx
log_info "Nginx 已启动"

# ── 3. 写入 SESSION_SECRET（仅首次，避免覆盖已有值）────────────
if grep -q "SESSION_SECRET" "$ENV_FILE"; then
    log_warn "SESSION_SECRET 已存在于 .env，跳过生成"
else
    log_info "生成并写入 SESSION_SECRET..."
    # openssl 生成 64 字节随机 hex，固定写入 .env 保证重启后 cookie 不失效
    SECRET=$(openssl rand -hex 64)
    echo "SESSION_SECRET=$SECRET" >> "$ENV_FILE"
    log_info "SESSION_SECRET 已写入 .env"
fi

# ── 4. 启动容器（如果尚未运行）───────────────────────────────
log_info "检查容器状态..."
cd "$REPO_DIR"

if docker compose ps --services --filter status=running | grep -q "wa-bot"; then
    log_warn "容器已在运行，执行 restart 使新配置生效..."
    docker compose restart wa-bot
else
    log_info "启动容器..."
    docker compose up -d
fi

# ── 5. 等待服务就绪 ───────────────────────────────────────────
log_info "等待服务启动（最多 30 秒）..."
for i in $(seq 1 6); do
    sleep 5
    if curl -sf http://127.0.0.1:3000/health > /dev/null 2>&1; then
        log_info "服务已就绪 ✓"
        break
    fi
    echo "  等待中... (${i}/6)"
done

# ── 完成 ──────────────────────────────────────────────────────
PUBLIC_IP=$(curl -sf https://checkip.amazonaws.com || echo "未知")
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  初始化完成！${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  管理后台：http://$PUBLIC_IP/admin"
echo "  扫码登录：http://$PUBLIC_IP/admin/qr"
echo "  健康检查：http://$PUBLIC_IP/health"
echo ""
echo "  如需查看 bot 日志："
echo "  docker compose logs -f wa-bot"
echo ""
