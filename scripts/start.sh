#!/usr/bin/env bash
# start.sh - Start Bot locally
# usage:
#   bash scripts/start.sh # Normal startup
#   bash scripts/start.sh dev # Development mode (automatic restart after file changes)
#
# Prerequisites:
#   1. wa-bot/.env contains at least GEMINI_API_KEY=xxx
#   2. When starting up for the first time, a WhatsApp QR code will pop up. You need to scan the code with your mobile phone to log in.

set -e

# Switch to the wa-bot/ subproject directory
cd "$(dirname "$0")/../wa-bot"

case "${1:-}" in
  "")
    # Normal startup
    npm start
    ;;
  dev)
    # Development mode: monitor code changes and automatically restart
    npm run dev
    ;;
  *)
    echo "Unknown subcommand: $1"
    echo "Available: (null) | dev"
    exit 1
    ;;
esac
