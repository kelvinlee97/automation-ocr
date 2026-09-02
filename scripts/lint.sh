#!/usr/bin/env bash
# Check code style for the new runtime by default.
#   bash scripts/lint.sh          # Admin lint
#   bash scripts/lint.sh legacy   # Archived wa-bot lint

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

case "${1:-}" in
  "")
    npm run admin:lint
    ;;
  legacy)
    npm run lint:legacy
    ;;
  *)
    echo "Unknown subcommand: $1"
    echo "Available: (null) | legacy"
    exit 1
    ;;
esac
