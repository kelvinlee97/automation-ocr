#!/usr/bin/env bash
# Initialize the new runtime after pulling the code.
# Usage: bash scripts/setup.sh [legacy]

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ "${1:-}" = "legacy" ]; then
  cd "$ROOT_DIR/wa-bot"
  npm ci
  npm test
  exit 0
fi

npm ci
npm run admin:lint
npm --workspace apps/admin run typecheck
npm --workspace apps/worker run typecheck
npm run worker:test
