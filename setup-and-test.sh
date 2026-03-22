#!/bin/bash
set -e

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== GitHub Actions 自动化配置与测试工具 ===${NC}"
echo "此脚本将帮助您设置 AWS 凭证并立即验证部署流程。"
echo ""

# 0. 检查依赖
if ! command -v gh &> /dev/null; then
    echo -e "${RED}❌ 错误: 未安装 GitHub CLI (gh)。${NC}"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo -e "${RED}❌ 错误: GitHub 未登录。请先运行 'gh auth login'。${NC}"
    exit 1
fi

# 1. 获取 AWS 凭证 (安全输入，不回显)
echo -e "${BLUE}[1/3] 配置凭证${NC}"
echo "请输入您的 AWS IAM 用户凭证（具备 AdministratorAccess 或相应 EC2/CloudFormation 权限）："

read -p "AWS Access Key ID: " INPUT_ACCESS_KEY
if [[ -z "$INPUT_ACCESS_KEY" ]]; then
    echo -e "${RED}❌ Access Key 不能为空${NC}"
    exit 1
fi

read -s -p "AWS Secret Access Key: " INPUT_SECRET_KEY
echo ""
if [[ -z "$INPUT_SECRET_KEY" ]]; then
    echo -e "${RED}❌ Secret Key 不能为空${NC}"
    exit 1
fi

read -p "AWS Region [默认 ap-southeast-1]: " INPUT_REGION
INPUT_REGION=${INPUT_REGION:-ap-southeast-1}

# 2. 上传到 GitHub Secrets
echo ""
echo -e "${BLUE}[2/3] 同步到 GitHub 仓库${NC}"
echo "正在设置 AWS_ACCESS_KEY_ID..."
echo "$INPUT_ACCESS_KEY" | gh secret set AWS_ACCESS_KEY_ID

echo "正在设置 AWS_SECRET_ACCESS_KEY..."
echo "$INPUT_SECRET_KEY" | gh secret set AWS_SECRET_ACCESS_KEY

echo "正在设置 AWS_REGION..."
echo "$INPUT_REGION" | gh secret set AWS_REGION

echo -e "${GREEN}✅ Secrets 配置成功！${NC}"

# 3. 触发并监控测试
echo ""
echo -e "${BLUE}[3/3] 启动集成测试${NC}"
echo "正在手动触发 GitHub Action (deploy.yml)..."

if gh workflow run deploy.yml; then
    echo "🚀 工作流已触发，正在等待运行实例..."
    sleep 3
    
    echo "👀 正在实时监控云端部署进度（请勿关闭终端）..."
    echo "---------------------------------------------------"
    
    # 监控最新的运行实例
    if gh run watch --exit-status; then
        echo "---------------------------------------------------"
        echo -e "${GREEN}🎉 测试通过！部署成功！${NC}"
        echo -e "您的环境配置已验证无误。以后每次 'git push' 都会自动部署。"
    else
        echo "---------------------------------------------------"
        echo -e "${RED}❌ 测试失败！${NC}"
        echo "请检查上方日志中的错误信息（通常是 IAM 权限不足或 EC2 实例不存在）。"
        exit 1
    fi
else
    echo -e "${RED}❌ 无法触发工作流，请检查 .github/workflows/deploy.yml 是否存在。${NC}"
    exit 1
fi
