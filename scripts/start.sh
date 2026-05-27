#!/usr/bin/env bash
# start.sh —— 本地启动 Bot
# 用法:
#   bash scripts/start.sh        # 普通启动
#   bash scripts/start.sh dev    # 开发模式（文件改动自动重启）
#
# 前置条件：
#   1. wa-bot/.env 至少包含 GEMINI_API_KEY=xxx
#   2. 第一次启动会弹出 WhatsApp 二维码，需要手机扫码登录

set -e

# 切到 wa-bot/ 子项目目录
cd "$(dirname "$0")/../wa-bot"

case "${1:-}" in
  "")
    # 普通启动
    npm start
    ;;
  dev)
    # 开发模式：监听代码改动自动重启
    npm run dev
    ;;
  *)
    echo "未知子命令: $1"
    echo "可用: (空) | dev"
    exit 1
    ;;
esac
