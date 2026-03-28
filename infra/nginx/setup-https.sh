#!/bin/bash
# 服务器端 HTTPS 配置脚本
# 前提：域名 DNS A 记录已解析到本机 IP，且 80/443 端口可访问
#
# 用法：
#   sudo bash infra/nginx/setup-https.sh <domain> <email>
#   例如：sudo bash infra/nginx/setup-https.sh example.com ops@example.com
set -euo pipefail

DOMAIN="${1:?用法: sudo $0 <domain> <email>  例如: sudo $0 example.com ops@example.com}"
CERTBOT_EMAIL="${2:?用法: sudo $0 <domain> <email>  例如: sudo $0 example.com ops@example.com}"

CONF_SRC="$(cd "$(dirname "$0")" && pwd)/automation-ocr.conf"
CONF_DEST="/etc/nginx/sites-available/automation-ocr"
CONF_LINK="/etc/nginx/sites-enabled/automation-ocr"

# ── 前置校验 ──────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    echo "错误：此脚本必须以 root 身份运行：sudo $0 $*" >&2
    exit 1
fi

[[ -f "$CONF_SRC" ]] || {
    echo "错误：找不到 Nginx 配置模板：$CONF_SRC" >&2
    echo "      请从项目根目录运行，或使用绝对路径" >&2
    exit 1
}

# 校验域名格式，同时防止特殊字符注入 sed 替换表达式
if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$ ]]; then
    echo "错误：无效域名格式 '${DOMAIN}'，应为 example.com 或 sub.example.com" >&2
    exit 1
fi

echo "==> [1/5] 安装 Nginx 和 Certbot"
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx

echo "==> [2/5] 部署 Nginx 配置"
# 备份已有配置，certbot 会修改此文件，便于出错后回滚
[[ -f "$CONF_DEST" ]] && cp "$CONF_DEST" "${CONF_DEST}.bak.$(date +%s)"

# 使用 | 作为 sed 分隔符（域名不含 |），转义替换段中的 & 和 \ 防止特殊字符意外展开
ESCAPED_DOMAIN=$(printf '%s' "$DOMAIN" | sed 's/[&\]/\\&/g')
sed "s|server_name example.com;|server_name ${ESCAPED_DOMAIN};|" "$CONF_SRC" > "$CONF_DEST"

# 删除 default 站点避免与 80 端口冲突
rm -f /etc/nginx/sites-enabled/default
ln -sf "$CONF_DEST" "$CONF_LINK"

echo "==> [3/5] 校验 Nginx 配置"
nginx -t

echo "==> [4/5] 启动/重载 Nginx"
systemctl enable --now nginx
systemctl reload nginx

echo "==> [5/5] 申请 Let's Encrypt 证书"
# 幂等：证书已存在时跳过，避免消耗 Let's Encrypt 每周 5 次速率配额
if certbot certificates 2>/dev/null | grep -q "Domains:.*${DOMAIN}"; then
    echo "    证书已存在，跳过申请（如需强制续期请手动运行：sudo certbot renew）"
else
    certbot --nginx \
        --non-interactive \
        --agree-tos \
        --redirect \
        -m "$CERTBOT_EMAIL" \
        -d "${DOMAIN}" || {
        echo "" >&2
        echo "错误：certbot 申请证书失败，请逐项排查：" >&2
        echo "  1. DNS A 记录是否已生效：dig +short ${DOMAIN}" >&2
        echo "  2. 80/443 端口是否对外开放（AWS 安全组）" >&2
        echo "  3. Let's Encrypt 速率限制：同域名每周最多 5 张证书" >&2
        echo "  如需回滚 Nginx 配置：cp ${CONF_DEST}.bak.* ${CONF_DEST} && nginx -t && systemctl reload nginx" >&2
        exit 1
    }
fi

echo ""
echo "✓ HTTPS 配置完成！访问 https://${DOMAIN} 验证"
echo "  证书自动续期由 certbot.timer systemd 服务处理（每天检查两次）"
echo "  验证续期命令：sudo certbot renew --dry-run"
# 确认 certbot timer 已激活
systemctl list-timers certbot.timer --no-pager 2>/dev/null || true
