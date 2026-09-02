#!/usr/bin/env bash
# Test the new runtime by default.
#   bash scripts/test.sh          # New-runtime checks plus legacy tests
#   bash scripts/test.sh legacy   # Archived wa-bot tests only

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

case "${1:-}" in
  "")
    npm run worker:test
    npm run test:legacy
    npm run admin:lint
    npm --workspace apps/admin run typecheck
    ;;
  legacy)
    npm run test:legacy
    ;;
  *)
    echo "Unknown subcommand: $1"
    echo "Available: (null) | legacy"
    exit 1
    ;;
esac
