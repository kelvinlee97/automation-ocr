#!/usr/bin/env bash
# Start ClaimFlow locally.
#   bash scripts/start.sh          # New Admin runtime
#   bash scripts/start.sh worker   # New Worker runtime
#   bash scripts/start.sh legacy   # Archived WhatsApp Web runtime

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

case "${1:-admin}" in
  admin)
    exec npm run admin:dev
    ;;
  worker)
    if [ -f apps/worker/.env ]; then
      set -a
      . apps/worker/.env
      set +a
    fi
    exec npm run worker:dev
    ;;
  legacy)
    cd "$ROOT_DIR/wa-bot"
    if [ -f .env ]; then
      set -a
      . ./.env
      set +a
    fi
    exec npm start
    ;;
  *)
    echo "Unknown subcommand: $1"
    echo "Available: admin | worker | legacy"
    exit 1
    ;;
esac
