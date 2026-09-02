#!/usr/bin/env bash
# One-click self-check for the new runtime.

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

npm run worker:test
npm --workspace apps/worker run typecheck
npm --workspace apps/admin test
npm run admin:lint
npm --workspace apps/admin run typecheck
npm run admin:build
