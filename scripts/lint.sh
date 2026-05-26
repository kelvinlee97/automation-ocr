#!/usr/bin/env bash
# lint.sh —— 代码风格检查
# 用法:
#   bash scripts/lint.sh        # 检查代码风格（无输出 = 通过）
#   bash scripts/lint.sh fix    # 自动修复能修的部分

set -e

# 切到 wa-bot/ 子项目目录
cd "$(dirname "$0")/../wa-bot"

case "${1:-}" in
  "")
    # 仅检查，不修改文件
    npm run lint
    ;;
  fix)
    # 自动修复能修的部分（剩下的看报错信息手动改）
    npx eslint src --ext .js --fix
    ;;
  *)
    echo "未知子命令: $1"
    echo "可用: (空) | fix"
    exit 1
    ;;
esac
