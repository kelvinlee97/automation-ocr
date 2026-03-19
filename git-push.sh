#!/bin/bash

# 获取当前分支名
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# 如果执行脚本时传入了参数，则作为 commit message；否则使用默认的 "chore: auto update"
MSG=${1:-"chore: auto update"}

echo "🔍 当前分支: $BRANCH"
echo "📦 正在检查文件状态..."
git status -s

# 如果没有变更，提示并退出
if [ -z "$(git status --porcelain)" ]; then
    echo "✅ 工作区很干净，没有需要提交的内容。"
    exit 0
fi

echo "➕ 添加所有更改..."
git add .

echo "📝 提交代码 (信息: '$MSG')..."
git commit -m "$MSG"

echo "🚀 正在推送到远程仓库 origin/$BRANCH ..."
git push origin "$BRANCH"

if [ $? -eq 0 ]; then
    echo "🎉 推送成功！"
else
    echo "❌ 推送失败，请检查网络或是否有冲突需要解决。"
fi
