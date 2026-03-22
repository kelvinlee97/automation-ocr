#!/usr/bin/env bash
# ================================================================
# GitHub 自动化推送与部署监控脚本
# 用法: ./git-push.sh "提交信息"
# ================================================================
set -e

# ── 1. 环境检查 ───────────────────────────────────────────────
if ! command -v gh &> /dev/null; then
    echo "❌ 错误: 未检测到 GitHub CLI (gh)。"
    echo "请先安装: https://cli.github.com/"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo "❌ 错误: GitHub 未登录。请执行 'gh auth login' 授权。"
    exit 1
fi

# ── 2. 状态获取 ───────────────────────────────────────────────
BRANCH=$(git rev-parse --abbrev-ref HEAD)
MSG=${1:-"chore: auto update $(date +'%Y-%m-%d %H:%M:%S')"}
REPO_NAME=$(gh repo view --json nameWithOwner -q .nameWithOwner)

echo "🔍 仓库: $REPO_NAME"
echo "🌿 分支: $BRANCH"

# 如果没有变更，提示并退出
if [ -z "$(git status --porcelain)" ]; then
    echo "✅ 工作区很干净，无需提交。"
    exit 0
fi

# ── 3. 提交与推送 ─────────────────────────────────────────────
echo "📦 正在暂存并提交变更..."
git add .
git commit -m "$MSG"

echo "🚀 正在推送到 GitHub..."
git push origin "$BRANCH"

# ── 4. 自动监控部署 (仅限 main 分支) ───────────────────────────
if [[ "$BRANCH" == "main" ]]; then
    echo ""
    echo "⏳ 检测到推送到主分支，正在自动监控 GitHub Actions 部署进度..."
    echo "提示: 按 Ctrl+C 可以退出监控（不影响后台部署运行）"
    
    # 稍等 2 秒让 GitHub 触发 Workflow
    sleep 2
    
    # 监控最近一次运行的部署流程
    if gh run watch --exit-status; then
        echo ""
        echo "🎉 部署成功！您的代码已同步到远程 EC2 实例。"
        echo "🔗 访问地址: $(gh repo view --json url -q .url)"
    else
        echo ""
        echo "❌ 部署失败！请检查 GitHub Actions 运行记录。"
        echo "执行 'gh run view' 查看详细错误日志。"
        exit 1
    fi
else
    echo ""
    echo "✅ 推送完成 (非 main 分支，已跳过自动部署监测)。"
fi
