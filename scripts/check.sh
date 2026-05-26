#!/usr/bin/env bash
# check.sh —— 提交前一键自检：跑测试 + lint
# 用法: bash scripts/check.sh
#
# 两个都过 → 可以放心提交；任一失败 → 先修，别提交。

set -e

# 切到 wa-bot/ 子项目目录后连贯执行 test 与 lint（中间任一失败立即退出）
cd "$(dirname "$0")/../wa-bot" && npm test && npm run lint
