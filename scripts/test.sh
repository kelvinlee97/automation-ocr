#!/usr/bin/env bash
# test.sh —— 测试相关命令
# 用法:
#   bash scripts/test.sh             # 跑全部测试（80 个用例，约 1 秒）
#   bash scripts/test.sh watch       # 监听文件变更自动重跑
#   bash scripts/test.sh coverage    # 生成覆盖率报告（输出到 coverage/）
#   bash scripts/test.sh file <路径> # 只跑某个测试文件
#   bash scripts/test.sh name <关键词> # 按名字过滤用例
#   bash scripts/test.sh verbose     # 详细输出
#
# 注意：所有测试都用 mock，不需要真实的网络/数据库/WhatsApp 账号。

set -e

# 切到 wa-bot/ 子项目目录（根目录跑不了）
cd "$(dirname "$0")/../wa-bot"

case "${1:-}" in
  "")
    # 默认：跑全部测试
    npm test
    ;;
  watch)
    # 监听文件变更自动重跑（开发时常开一个终端）
    npm run test:watch
    ;;
  coverage)
    # 生成测试覆盖率报告（报告位于 wa-bot/coverage/）
    npm run test:coverage
    ;;
  file)
    # 只跑指定路径的测试文件，调试单个测试时用
    npx jest "$2"
    ;;
  name)
    # 按用例名字关键词过滤
    npx jest -t "$2"
    ;;
  verbose)
    # 输出更详细的测试信息
    npx jest --verbose
    ;;
  *)
    echo "未知子命令: $1"
    echo "可用: (空) | watch | coverage | file <路径> | name <关键词> | verbose"
    exit 1
    ;;
esac
