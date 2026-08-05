#!/usr/bin/env bash
# lint.sh - code style checking
# usage:
#   bash scripts/lint.sh # Check code style (no output = pass)
#   bash scripts/lint.sh fix # Automatically repair the repairable parts

set -e

# Switch to the wa-bot/ subproject directory
cd "$(dirname "$0")/../wa-bot"

case "${1:-}" in
  "")
    # Only checks, does not modify files
    npm run lint
    ;;
  fix)
    # Automatically repair the repairable parts (the rest can be modified manually according to the error message)
    npx eslint src --ext .js --fix
    ;;
  *)
    echo "Unknown subcommand: $1"
    echo "Available: (null) | fix"
    exit 1
    ;;
esac
