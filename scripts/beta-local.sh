#!/usr/bin/env bash
set -e

# ============================================================
#  beta-local.sh — Local Apple Container beta testing environment
# ============================================================
# Purpose: Use Apple Container (container CLI) to run wa-bot locally for UI beta testing
# Dependencies: Apple Container (https://github.com/apple/container)—— brew install container
#
# usage:
#   bash scripts/beta-local.sh # Normal startup (running in the background, excluding Bot)
#   bash scripts/beta-local.sh --with-bot # Start the version containing Chromium (can test the Bot function)
#   bash scripts/beta-local.sh --clean # Clean old containers + node_modules rebuild
#   bash scripts/beta-local.sh --stop # Only stop the container, do not delete it
#   bash scripts/beta-local.sh --logs # View running logs
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WA_BOT_DIR="$PROJECT_ROOT/wa-bot"
CONTAINER_NAME="wa-bot-beta"
IMAGE="docker.io/library/node:20-slim"
BOT_IMAGE="wa-bot:with-bot"  # Locally built image containing Chromium
HOST_PORT=3000

# ── Color output ─────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[info]${NC} $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1"; }

# ── Parameter analysis ────────────────────────────────────────────────
CLEAN_MODE=false
STOP_MODE=false
LOGS_MODE=false
WITH_BOT=false

for arg in "$@"; do
  case $arg in
    --clean)    CLEAN_MODE=true ;;
    --stop)      STOP_MODE=true ;;
    --logs)      LOGS_MODE=true ;;
    --with-bot)  WITH_BOT=true ;;
    *) echo "Unknown parameter: $arg"; exit 1 ;;
  esac
done

# ── --logs: View logs ──────────────────────────────────────────
if [ "$LOGS_MODE" = "true" ]; then
  if ! container list 2>/dev/null | grep -q "$CONTAINER_NAME"; then
    error "Container $CONTAINER_NAME is not running"
    exit 1
  fi
  info "Following $CONTAINER_NAME logs (Ctrl+C to exit)..."
  container logs -f "$CONTAINER_NAME"
  exit 0
fi

# ── --stop: Stop the container ───────────────────────────────────────
if [ "$STOP_MODE" = "true" ]; then
  if container list 2>/dev/null | grep -q "$CONTAINER_NAME"; then
    info "Stop container $CONTAINER_NAME..."
    container stop "$CONTAINER_NAME" 2>/dev/null || true
    info "Delete container $CONTAINER_NAME..."
    container delete "$CONTAINER_NAME" 2>/dev/null || true
    info "Container stopped and deleted"
  else
    warn "Container $CONTAINER_NAME is not running"
    # Still trying to clean up the residue
    container delete "$CONTAINER_NAME" 2>/dev/null || true
    info "Attempts have been made to clean the remaining containers"
  fi
  exit 0
fi

# ── --clean: Rebuild node_modules after cleaning ──────────────────────
if [ "$CLEAN_MODE" = "true" ]; then
  info "[clean mode] Clean old containers + rebuild node_modules..."

  # Stop and delete old containers
  container stop "$CONTAINER_NAME" 2>/dev/null || true
  container delete "$CONTAINER_NAME" 2>/dev/null || true

  # Remove node_modules within the container if present
  if [ -d "$WA_BOT_DIR/node_modules" ]; then
    # If you have a backup of macOS native modules, restore it
    if [ -d "$WA_BOT_DIR/node_modules.mac" ]; then
      warn "Found node_modules.mac (macOS native module), restored to node_modules..."
      rm -rf "$WA_BOT_DIR/node_modules"
      mv "$WA_BOT_DIR/node_modules.mac" "$WA_BOT_DIR/node_modules"
      info "Restored macOS node_modules (for direct host development)"
    else
      warn "Remove node_modules (the Linux version will be reinstalled inside the container)..."
      rm -rf "$WA_BOT_DIR/node_modules"
    fi
  fi

  info "Cleanup completed. Now start normally with 'bash scripts/beta-local.sh'."
  exit 0
fi

# ── --with-bot: Check whether the image exists ────────────────────────
if [ "$WITH_BOT" = "true" ]; then
  info "[with-bot mode] Images containing Chromium will be used..."
  if ! container image list 2>/dev/null | grep -q "wa-bot.*with-bot"; then
    warn "The image $BOT_IMAGE does not exist and needs to be built first:"
    warn "  cd $WA_BOT_DIR && container build -t $BOT_IMAGE -f Dockerfile ."
    error "Please build the image first, or run it without the --with-bot parameter (only test the Admin background)"
    exit 1
  fi
  IMAGE="$BOT_IMAGE"
  info "Use image: $IMAGE"
fi

# ── Check dependencies ─────────────────────────────────────────────
if ! command -v container &>/dev/null; then
  error "Apple Container is not installed. Please run first: brew install container"
  exit 1
fi

if ! command -v node &>/dev/null; then
  error "Node.js is not installed. Please install Node.js 20+ first"
  exit 1
fi

# ── Prepare .env (if not present)───────────────────────────────
if [ ! -f "$WA_BOT_DIR/.env" ]; then
  warn ".env does not exist, generate minimum configuration..."
  SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))")
  cat > "$WA_BOT_DIR/.env" <<EOF
# Minimal .env for local beta testing
# Generated by beta-local.sh — fill in real keys before production use

SESSION_SECRET=$SESSION_SECRET

# OPTIONAL: Gemini API Key (for OCR) — leave empty to skip AI recognition
GEMINI_API_KEY=

# OPTIONAL: GitHub Token (for feedback → GitHub Issue) — leave empty to skip GitHub integration
GITHUB_TOKEN=

# Optional: data directory (defaults to ./data)
# DATA_DIR=./data
EOF
  info ".env generated: $WA_BOT_DIR/.env"
  info "Tip: GEMINI_API_KEY and GITHUB_TOKEN can be left blank for pure UI testing"
fi

# ── Processing node_modules (core steps)───────────────────────────
# Problem: The native module (better-sqlite3, etc.) of the host npm install is in macOS Mach-O format.
# Cannot be used inside Linux containers (invalid ELF header).
# Solution: Rename macOS node_modules to node_modules.mac,
# Let npm install inside the container generate a standalone Linux version (without mounting the node_modules subdirectory).
if [ -d "$WA_BOT_DIR/node_modules" ] && [ ! -d "$WA_BOT_DIR/node_modules.mac" ]; then
  info "Detected node_modules (macOS native module), renamed to node_modules.mac..."
  mv "$WA_BOT_DIR/node_modules" "$WA_BOT_DIR/node_modules.mac"
  info "Backed up as node_modules.mac (can be restored using 'mv node_modules.mac node_modules' during host development)"
fi

# ── Stop and delete the old container (if any)───────────────────────────────
if container list 2>/dev/null | grep -q "$CONTAINER_NAME"; then
  info "Found running $CONTAINER_NAME, stop first..."
  container stop "$CONTAINER_NAME" 2>/dev/null || true
  sleep 1
fi
container delete "$CONTAINER_NAME" 2>/dev/null || true

# ── Check port occupancy ──────────────────────────────────────────
if lsof -i :$HOST_PORT 2>/dev/null | grep -q LISTEN; then
  warn "Port $HOST_PORT is already occupied:"
  lsof -i :$HOST_PORT 2>/dev/null | grep LISTEN | head -3
  error "Please stop the process occupying port $HOST_PORT first, or edit this script to change the port"
  exit 1
fi

# ── Start the container ─────────────────────────────────────────────
info "Start Apple Container: $CONTAINER_NAME (port $HOST_PORT → container 3000)..."
if [ "$WITH_BOT" = "true" ]; then
  info "Mirror: $IMAGE (including Chromium, can test Bot function)"
else
  info "Mirror: $IMAGE (without Chromium, only runs the Admin background)"
fi
echo ""

# Use sh -c to first npm install (compile the native module in the Linux container), and then start node
# Key: Do not mount node_modules and allow the Linux version to be installed independently in the container
container run \
  --name "$CONTAINER_NAME" \
  -p "$HOST_PORT:3000" \
  -v "$WA_BOT_DIR:/app" \
  -w /app \
  -e NODE_ENV=development \
  -e SESSION_SECRET="$(grep SESSION_SECRET "$WA_BOT_DIR/.env" | cut -d= -f2- | tr -d '\r')" \
  --rm \
  "$IMAGE" \
  sh -c "echo '📦 Install npm dependencies (Linux native modules) inside the container...' && \
             npm install --omit=dev 2>&1 | grep -v '^npm WARN' | grep -v '^npm notice' && \
             echo '✅ npm install completed' && \
             echo '🚀 Start wa-bot...' && \
             node index.js" &

CONTAINER_PID=$!
info "The container has been started in the background (PID: $CONTAINER_PID)"

# ──Waiting for the service to be ready──────────────────────────────────────────
info "Wait for the service to be ready at localhost:$HOST_PORT (up to 60 seconds)..."
for i in $(seq 1 60); do
  sleep 1
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$HOST_PORT/admin" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "302" ] || [ "$HTTP_CODE" = "200" ]; then
    echo ""
    info "✅ The service is ready! HTTP status code: $HTTP_CODE"
    echo ""
    info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    info "Beta test address: <a href=\"http://localhost:$HOST_PORT/admin/setup\">http://localhost:$HOST_PORT/admin/setup</a>"
    info "1. Visit /admin/setup for the first time to create an admin account"
    info "2. After logging in, visit /admin/feedback to view the redesigned feedback page"
    if [ "$WITH_BOT" = "true" ]; then
      info "3. Bot function is enabled (Chromium is installed)"
    else
      info "3. The Bot function is not enabled (can be enabled with the --with-bot parameter)"
    fi
    info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    info "View real-time logs: bash scripts/beta-local.sh --logs"
    info "Stop the container: bash scripts/beta-local.sh --stop"
    info "Clean and rebuild: bash scripts/beta-local.sh --clean"
    exit 0
  fi
  printf "."
done

echo ""
error "The service is not ready within 60 seconds, please run the following command to view the log:"
error "  bash scripts/beta-local.sh --logs"
exit 1
