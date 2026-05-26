#!/usr/bin/env bash
# setup.sh —— 首次拉代码后初始化环境
# 用法: bash scripts/setup.sh

set -e

# 进入子项目目录（99% 的开发命令都在 wa-bot/ 下跑）
cd "$(dirname "$0")/../wa-bot"

# 安装依赖（只需要做一次，或 package.json 改了之后再跑）
npm install

# 跑一遍测试，确认环境 OK（看到 "Tests: 80 passed" 即环境正常）
npm test
