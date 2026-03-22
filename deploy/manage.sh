#!/usr/bin/env bash
# ================================================================
# AWS 快捷管理脚本 — automation-ocr
# 用法: deploy/manage.sh <子命令>
# 子命令: setup-token | deploy | status | stop | start | ssh | logs | update | destroy | cost
# ================================================================
set -euo pipefail
export AWS_PAGER=""

# ── 配置常量（可通过同名环境变量覆盖）──────────────────────────
STACK_NAME="${STACK_NAME:-automation-ocr}"
REGION="${REGION:-ap-southeast-1}"
GIT_REPO_URL="${GIT_REPO_URL:-https://github.com/kelvinlee97/automation-ocr.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.large}"
DATA_VOLUME_SIZE="${DATA_VOLUME_SIZE:-20}"
ADMIN_IP="${ADMIN_IP:-$(curl -s -4 ifconfig.me)/32}"
KEY_NAME="${KEY_NAME:-}"
GITHUB_TOKEN_SECRET_NAME="${GITHUB_TOKEN_SECRET_NAME:-${STACK_NAME}/github-token}"

# CloudFormation 模板路径（相对于项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="${SCRIPT_DIR}/cloudformation.yaml"

# ── 颜色输出 ─────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # 重置颜色

_log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
_log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
_log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
_log_step()  { echo -e "${CYAN}>>>>${NC} $*"; }

# ── 依赖检查 ─────────────────────────────────────────────────
_check_deps() {
    local missing=()
    for cmd in aws jq curl; do
        if ! command -v "$cmd" &>/dev/null; then
            missing+=("$cmd")
        fi
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        _log_error "缺少必要工具: ${missing[*]}"
        _log_error "请先安装所需工具。"
        exit 1
    fi
}

# ── 辅助函数 ─────────────────────────────────────────────────

# 获取 Stack 状态，不存在返回空字符串
_get_stack_status() {
    aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query "Stacks[0].StackStatus" \
        --output text 2>/dev/null || echo ""
}

# 从 Stack Outputs 获取指定 Key 的值
_get_stack_output() {
    local key="$1"
    aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" \
        --output text 2>/dev/null || echo ""
}

# 获取 EC2 实例 ID
_get_instance_id() {
    _get_stack_output "InstanceId"
}

# 获取 EC2 实例运行状态
_get_instance_state() {
    local instance_id="$1"
    aws ec2 describe-instances \
        --instance-ids "$instance_id" \
        --region "$REGION" \
        --query "Reservations[0].Instances[0].State.Name" \
        --output text 2>/dev/null || echo ""
}

# 获取 EC2 公网 IP（可能为空）
_get_public_ip() {
    local instance_id="$1"
    aws ec2 describe-instances \
        --instance-ids "$instance_id" \
        --region "$REGION" \
        --query "Reservations[0].Instances[0].PublicIpAddress" \
        --output text 2>/dev/null || echo ""
}

# 检查 Stack 是否存在且可用
_require_stack() {
    local status
    status="$(_get_stack_status)"
    if [[ -z "$status" ]]; then
        _log_error "Stack '$STACK_NAME' 不存在。请先执行: $0 deploy"
        exit 1
    fi
    if [[ "$status" == *"IN_PROGRESS"* ]]; then
        _log_error "Stack 当前状态: $status（操作进行中，请稍后再试）"
        exit 1
    fi
    if [[ "$status" != "CREATE_COMPLETE" && "$status" != "UPDATE_COMPLETE" && "$status" != "UPDATE_ROLLBACK_COMPLETE" ]]; then
        _log_warn "Stack 状态异常: $status"
    fi
}

# 检查实例存在且获取 ID
_require_instance() {
    _require_stack
    local instance_id
    instance_id="$(_get_instance_id)"
    if [[ -z "$instance_id" || "$instance_id" == "None" ]]; then
        _log_error "无法获取实例 ID，Stack 可能未正常创建"
        exit 1
    fi
    echo "$instance_id"
}

# ── 子命令实现 ────────────────────────────────────────────────

cmd_setup_token() {
    local token="${1:-}"
    if [[ -z "$token" ]]; then
        _log_error "用法: $0 setup-token <github-personal-access-token>"
        _log_info "在 GitHub → Settings → Developer settings → Personal access tokens 创建"
        _log_info "仅需 repo 权限（私有仓库读取）"
        exit 1
    fi

    _log_step "存储 GitHub Token 到 Secrets Manager"
    echo -e "  Secret 名称: ${BLUE}$GITHUB_TOKEN_SECRET_NAME${NC}"
    echo -e "  区域:        ${BLUE}$REGION${NC}"

    # 检查 Secret 是否已存在
    if aws secretsmanager describe-secret \
        --secret-id "$GITHUB_TOKEN_SECRET_NAME" \
        --region "$REGION" &>/dev/null; then
        # 已存在 — 更新值
        aws secretsmanager put-secret-value \
            --secret-id "$GITHUB_TOKEN_SECRET_NAME" \
            --secret-string "$token" \
            --region "$REGION" \
            --output text >/dev/null
        _log_info "Secret 已更新"
    else
        # 不存在 — 创建新 Secret
        aws secretsmanager create-secret \
            --name "$GITHUB_TOKEN_SECRET_NAME" \
            --description "GitHub PAT for automation-ocr private repo clone" \
            --secret-string "$token" \
            --region "$REGION" \
            --output text >/dev/null
        _log_info "Secret 创建成功"
    fi

    _log_info "后续部署时脚本会自动将此 Secret 名称传给 CloudFormation"
}

cmd_deploy() {
    _log_step "部署 Stack: $STACK_NAME"

    # 检查 Stack 是否已存在
    local status
    status="$(_get_stack_status)"
    local cf_action="create-stack"
    local wait_action="stack-create-complete"
    
    if [[ -n "$status" ]]; then
        if [[ "$status" == "CREATE_COMPLETE" || "$status" == "UPDATE_COMPLETE" || "$status" == "UPDATE_ROLLBACK_COMPLETE" ]]; then
            _log_info "Stack 已存在 (状态: $status)，执行 update-stack..."
            cf_action="update-stack"
            wait_action="stack-update-complete"
        elif [[ "$status" == *"ROLLBACK_COMPLETE"* ]]; then
            _log_warn "Stack 处于 $status 状态，需先删除再重建"
            _log_info "请执行: $0 destroy && $0 deploy"
            exit 1
        else
            _log_error "Stack 当前状态: $status，无法部署"
            exit 1
        fi
    fi

    # 检查模板文件
    if [[ ! -f "$TEMPLATE_FILE" ]]; then
        _log_error "模板文件不存在: $TEMPLATE_FILE"
        exit 1
    fi

    echo -e "  Stack 名称:    ${BLUE}$STACK_NAME${NC}"
    echo -e "  区域:          ${BLUE}$REGION${NC}"
    echo -e "  实例类型:      ${BLUE}$INSTANCE_TYPE${NC}"
    echo -e "  Git 仓库:      ${BLUE}$GIT_REPO_URL${NC}"
    echo -e "  Git 分支:      ${BLUE}$GIT_BRANCH${NC}"
    echo -e "  数据卷大小:    ${BLUE}${DATA_VOLUME_SIZE}GB${NC}"
    echo -e "  Admin IP:      ${BLUE}${ADMIN_IP}${NC}"
    echo -e "  SSH KeyName:   ${BLUE}${KEY_NAME}${NC}"

    # 尝试读取本地公钥注入（用于直接 SSH 登录，解决无 KeyPair 难题）
    local ssh_pub_key=""
    local key_path="$HOME/.ssh/kelvin97.pem"
    local pub_path="$HOME/.ssh/kelvin97.pub"

    if [[ -f "$pub_path" ]]; then
        ssh_pub_key=$(cat "$pub_path")
    elif [[ -f "$key_path" ]]; then
        ssh_pub_key=$(ssh-keygen -y -f "$key_path" 2>/dev/null || true)
    fi

    if [[ -n "$ssh_pub_key" ]]; then
        echo -e "  SSH PubKey:    ${GREEN}已检测并自动注入${NC} (from $key_path)"
    else
        _log_warn "未发现本地 SSH 公钥 ($key_path)，将无法直接 SSH 登录（仍可通过 SSM 登录）"
    fi

    # 检查 GitHub Token Secret 是否存在
    local token_secret_param=""
    if aws secretsmanager describe-secret \
        --secret-id "$GITHUB_TOKEN_SECRET_NAME" \
        --region "$REGION" &>/dev/null; then
        token_secret_param="$GITHUB_TOKEN_SECRET_NAME"
        echo -e "  GitHub Token:  ${GREEN}已配置${NC}（Secret: ${GITHUB_TOKEN_SECRET_NAME}）"
    else
        _log_warn "GitHub Token Secret 未找到（${GITHUB_TOKEN_SECRET_NAME}）"
        _log_warn "如果是私有仓库，请先执行: $0 setup-token <your-github-pat>"
        _log_info "公开仓库可忽略此警告，继续部署..."
    fi
    echo ""

    if ! aws cloudformation "$cf_action" \
        --stack-name "$STACK_NAME" \
        --template-body "file://${TEMPLATE_FILE}" \
        --capabilities CAPABILITY_NAMED_IAM \
        --parameters \
            "ParameterKey=GitRepoUrl,ParameterValue=$GIT_REPO_URL" \
            "ParameterKey=GitBranch,ParameterValue=$GIT_BRANCH" \
            "ParameterKey=InstanceType,ParameterValue=$INSTANCE_TYPE" \
            "ParameterKey=DataVolumeSize,ParameterValue=$DATA_VOLUME_SIZE" \
            "ParameterKey=AdminIp,ParameterValue=$ADMIN_IP" \
            "ParameterKey=KeyName,ParameterValue=$KEY_NAME" \
            "ParameterKey=SSHPublicKey,ParameterValue=$ssh_pub_key" \
            "ParameterKey=GitHubTokenSecretName,ParameterValue=$token_secret_param" \
        --region "$REGION" \
        --output text; then
        # Check if the error is "No updates are to be performed"
        if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" &>/dev/null; then
             _log_info "No updates are to be performed. Stack is already up-to-date."
             echo ""
             cmd_status
             return 0
        else
            _log_error "Stack 部署命令执行失败。"
            exit 1
        fi
    fi

    _log_info "Stack 部署中，等待完成（约 5-8 分钟）..."
    if aws cloudformation wait "$wait_action" \
        --stack-name "$STACK_NAME" \
        --region "$REGION"; then
        _log_info "Stack 部署成功！"
        echo ""
        cmd_status
        echo ""
        _log_warn "首次部署需要扫描 WhatsApp QR 码，Docker 镜像构建约需 10-15 分钟"
        _log_info "执行以下命令查看 QR 码: $0 ssh  然后运行  sudo docker logs -f wa-bot"
    else
        _log_error "Stack 部署失败，请检查 AWS Console 中的事件日志"
        exit 1
    fi
}

cmd_status() {
    _log_step "查看 Stack 状态"

    local status
    status="$(_get_stack_status)"
    if [[ -z "$status" ]]; then
        _log_info "Stack '$STACK_NAME' 不存在"
        return
    fi

    echo -e "  Stack 名称:    ${BLUE}$STACK_NAME${NC}"
    echo -e "  Stack 状态:    ${BLUE}$status${NC}"

    # 获取 Outputs
    local instance_id public_ip data_volume_id
    instance_id="$(_get_stack_output "InstanceId")"
    public_ip="$(_get_stack_output "PublicIp")"
    data_volume_id="$(_get_stack_output "DataVolumeId")"

    if [[ -n "$instance_id" && "$instance_id" != "None" ]]; then
        local instance_state
        instance_state="$(_get_instance_state "$instance_id")"

        # 实例停止后公网 IP 会释放，需要实时获取
        if [[ "$instance_state" == "running" ]]; then
            public_ip="$(_get_public_ip "$instance_id")"
        else
            public_ip="(实例未运行，无公网 IP)"
        fi

        echo -e "  实例 ID:       ${BLUE}$instance_id${NC}"
        echo -e "  实例状态:      ${BLUE}$instance_state${NC}"
        echo -e "  公网 IP:       ${BLUE}$public_ip${NC}"
    fi

    if [[ -n "$data_volume_id" && "$data_volume_id" != "None" ]]; then
        echo -e "  数据卷 ID:     ${BLUE}$data_volume_id${NC}"
    fi

    echo -e "  区域:          ${BLUE}$REGION${NC}"
    echo -e "  SSM 连接命令:  ${CYAN}aws ssm start-session --target $instance_id --region $REGION${NC}"
}

cmd_stop() {
    _log_step "停止 EC2 实例"

    local instance_id
    instance_id="$(_require_instance)"

    local state
    state="$(_get_instance_state "$instance_id")"
    if [[ "$state" == "stopped" ]]; then
        _log_info "实例已处于停止状态"
        return
    fi
    if [[ "$state" != "running" ]]; then
        _log_error "实例当前状态: $state，无法停止"
        exit 1
    fi

    _log_warn "停止后 EBS 卷仍会产生费用（约 \$4.1/月 for 2x gp3 卷）"
    _log_info "停止实例: $instance_id"

    aws ec2 stop-instances \
        --instance-ids "$instance_id" \
        --region "$REGION" \
        --output text >/dev/null

    _log_info "等待实例停止..."
    aws ec2 wait instance-stopped \
        --instance-ids "$instance_id" \
        --region "$REGION"

    _log_info "实例已停止"
}

cmd_start() {
    _log_step "启动 EC2 实例"

    local instance_id
    instance_id="$(_require_instance)"

    local state
    state="$(_get_instance_state "$instance_id")"
    if [[ "$state" == "running" ]]; then
        _log_info "实例已在运行中"
        local ip
        ip="$(_get_public_ip "$instance_id")"
        echo -e "  公网 IP: ${BLUE}$ip${NC}"
        return
    fi
    if [[ "$state" != "stopped" ]]; then
        _log_error "实例当前状态: $state，无法启动"
        exit 1
    fi

    _log_info "启动实例: $instance_id"

    aws ec2 start-instances \
        --instance-ids "$instance_id" \
        --region "$REGION" \
        --output text >/dev/null

    _log_info "等待实例启动..."
    aws ec2 wait instance-running \
        --instance-ids "$instance_id" \
        --region "$REGION"

    local new_ip
    new_ip="$(_get_public_ip "$instance_id")"
    _log_info "实例已启动"
    echo -e "  新公网 IP: ${BLUE}$new_ip${NC}"
    _log_info "服务会通过 systemd 自动启动（docker compose up），约需 1-2 分钟"
}

cmd_ssh() {
    _log_step "通过 SSM 连接实例"

    local instance_id
    instance_id="$(_require_instance)"

    local state
    state="$(_get_instance_state "$instance_id")"
    if [[ "$state" != "running" ]]; then
        _log_error "实例未运行（当前状态: $state），请先执行: $0 start"
        exit 1
    fi

    _log_info "连接到实例: $instance_id"
    aws ssm start-session \
        --target "$instance_id" \
        --region "$REGION"
}

cmd_setup_ssh() {
    _log_step "配置 SSH 公钥注入 (以支持直接 SSH 登录)"

    local instance_id
    instance_id="$(_require_instance)"

    local state
    state="$(_get_instance_state "$instance_id")"
    if [[ "$state" != "running" ]]; then
        _log_error "实例未运行（当前状态: $state），无法注入公钥"
        exit 1
    fi

    # 尝试读取本地公钥
    local ssh_pub_key=""
    local key_path="$HOME/.ssh/kelvin97.pem"
    local pub_path="$HOME/.ssh/kelvin97.pub"

    if [[ -f "$pub_path" ]]; then
        ssh_pub_key=$(cat "$pub_path")
    elif [[ -f "$key_path" ]]; then
        ssh_pub_key=$(ssh-keygen -y -f "$key_path" 2>/dev/null || true)
    fi

    if [[ -z "$ssh_pub_key" ]]; then
        _log_error "未发现本地公钥，请确保 $key_path 或 $pub_path 存在"
        exit 1
    fi

    _log_info "正在通过 SSM 将公钥注入 ec2-user@$instance_id..."

    # 转义公钥中的单引号，防止 shell 注入
    local escaped_pub_key
    escaped_pub_key=$(echo "$ssh_pub_key" | sed "s/'/'\\\\''/g")

    local command_id
    command_id=$(aws ssm send-command \
        --instance-ids "$instance_id" \
        --document-name "AWS-RunShellScript" \
        --parameters "commands=[\"mkdir -p /home/ec2-user/.ssh && echo '$escaped_pub_key' >> /home/ec2-user/.ssh/authorized_keys && sort -u -o /home/ec2-user/.ssh/authorized_keys /home/ec2-user/.ssh/authorized_keys && chmod 700 /home/ec2-user/.ssh && chmod 600 /home/ec2-user/.ssh/authorized_keys && chown -R ec2-user:ec2-user /home/ec2-user/.ssh\"]" \
        --region "$REGION" \
        --query "Command.CommandId" \
        --output text)

    _log_info "SSM Command ID: $command_id"
    _log_info "等待注入完成..."

    # 等待命令执行完成
    local max_wait=20
    local waited=0
    while [[ $waited -lt $max_wait ]]; do
        local cmd_status
        cmd_status=$(aws ssm get-command-invocation \
            --command-id "$command_id" \
            --instance-id "$instance_id" \
            --region "$REGION" \
            --query "Status" \
            --output text 2>/dev/null || echo "Pending")

        if [[ "$cmd_status" == "Success" ]]; then
            echo ""
            _log_info "注入成功！您现在可以尝试直接 SSH 登录了："
            local public_ip
            public_ip="$(_get_public_ip "$instance_id")"
            echo -e "  ${CYAN}ssh -i $key_path ec2-user@$public_ip${NC}"
            return
        elif [[ "$cmd_status" == "Failed" || "$cmd_status" == "Cancelled" || "$cmd_status" == "TimedOut" ]]; then
            _log_error "注入失败（状态: $cmd_status）"
            exit 1
        fi

        sleep 2
        waited=$((waited + 2))
    done

    _log_error "注入超时，请手动检查 SSM 状态"
}

cmd_logs() {
    _log_step "查看容器日志"

    local instance_id
    instance_id="$(_require_instance)"

    local state
    state="$(_get_instance_state "$instance_id")"
    if [[ "$state" != "running" ]]; then
        _log_error "实例未运行（当前状态: $state），请先执行: $0 start"
        exit 1
    fi

    # 默认查看 wa-bot 日志，支持通过参数指定容器
    local container="${1:-wa-bot}"
    local tail_lines="${2:-50}"

    _log_info "获取容器 '$container' 最近 $tail_lines 行日志..."

    local command_id
    command_id=$(aws ssm send-command \
        --instance-ids "$instance_id" \
        --document-name "AWS-RunShellScript" \
        --parameters "commands=[\"sudo docker logs --tail $tail_lines $container 2>&1\"]" \
        --region "$REGION" \
        --query "Command.CommandId" \
        --output text)

    # 等待命令执行完成
    local max_wait=30
    local waited=0
    while [[ $waited -lt $max_wait ]]; do
        local cmd_status
        cmd_status=$(aws ssm get-command-invocation \
            --command-id "$command_id" \
            --instance-id "$instance_id" \
            --region "$REGION" \
            --query "Status" \
            --output text 2>/dev/null || echo "Pending")

        if [[ "$cmd_status" == "Success" ]]; then
            aws ssm get-command-invocation \
                --command-id "$command_id" \
                --instance-id "$instance_id" \
                --region "$REGION" \
                --query "StandardOutputContent" \
                --output text
            return
        elif [[ "$cmd_status" == "Failed" || "$cmd_status" == "Cancelled" || "$cmd_status" == "TimedOut" ]]; then
            _log_error "命令执行失败（状态: $cmd_status）"
            aws ssm get-command-invocation \
                --command-id "$command_id" \
                --instance-id "$instance_id" \
                --region "$REGION" \
                --query "StandardErrorContent" \
                --output text 2>/dev/null
            exit 1
        fi

        sleep 2
        waited=$((waited + 2))
    done

    _log_error "等待命令执行超时（${max_wait}s）"
    exit 1
}

cmd_update() {
    _log_step "远程更新代码并重启服务"

    local instance_id
    instance_id="$(_require_instance)"

    local state
    state="$(_get_instance_state "$instance_id")"
    if [[ "$state" != "running" ]]; then
        _log_error "实例未运行（当前状态: $state），请先执行: $0 start"
        exit 1
    fi

    _log_info "通过 SSM 执行: git pull + docker compose up -d --build"

    local command_id
    command_id=$(aws ssm send-command \
        --instance-ids "$instance_id" \
        --document-name "AWS-RunShellScript" \
        --timeout-seconds 300 \
        --parameters 'commands=["cd /opt/automation-ocr && sudo git pull origin main && sudo docker compose up -d --build 2>&1"]' \
        --region "$REGION" \
        --query "Command.CommandId" \
        --output text)

    _log_info "SSM Command ID: $command_id"
    _log_info "等待部署完成..."

    # 轮询等待命令完成（最长 5 分钟）
    local max_wait=300
    local waited=0
    while [[ $waited -lt $max_wait ]]; do
        local cmd_status
        cmd_status=$(aws ssm get-command-invocation \
            --command-id "$command_id" \
            --instance-id "$instance_id" \
            --region "$REGION" \
            --query "Status" \
            --output text 2>/dev/null || echo "Pending")

        if [[ "$cmd_status" == "Success" ]]; then
            echo ""
            _log_info "部署成功！输出:"
            echo "---"
            aws ssm get-command-invocation \
                --command-id "$command_id" \
                --instance-id "$instance_id" \
                --region "$REGION" \
                --query "StandardOutputContent" \
                --output text
            echo "---"
            return
        elif [[ "$cmd_status" == "Failed" || "$cmd_status" == "Cancelled" || "$cmd_status" == "TimedOut" ]]; then
            _log_error "部署失败（状态: $cmd_status）"
            aws ssm get-command-invocation \
                --command-id "$command_id" \
                --instance-id "$instance_id" \
                --region "$REGION" \
                --query "StandardErrorContent" \
                --output text 2>/dev/null
            exit 1
        fi

        sleep 5
        waited=$((waited + 5))
    done

    _log_error "等待部署结果超时（${max_wait}s）"
    exit 1
}

cmd_destroy() {
    _log_step "删除 Stack: $STACK_NAME"

    local status
    status="$(_get_stack_status)"
    if [[ -z "$status" ]]; then
        _log_info "Stack '$STACK_NAME' 不存在，无需删除"
        return
    fi

    # 获取数据卷 ID（删除后需要提醒）
    local data_volume_id
    data_volume_id="$(_get_stack_output "DataVolumeId")"

    echo -e "${RED}========================= 危险操作 =========================${NC}"
    echo -e "  即将删除 Stack: ${RED}$STACK_NAME${NC}"
    echo -e "  当前状态: ${BLUE}$status${NC}"
    echo ""
    echo -e "  ${YELLOW}将被删除的资源:${NC} EC2 实例、VPC、Security Group、IAM Role"
    echo -e "  ${GREEN}将被保留的资源:${NC} 数据 EBS 卷（DeletionPolicy: Retain）"
    echo -e "${RED}=============================================================${NC}"
    echo ""

    # 二次确认：要求输入 Stack 名称
    echo -n "请输入 Stack 名称以确认删除 [$STACK_NAME]: "
    read -r confirm
    if [[ "$confirm" != "$STACK_NAME" ]]; then
        _log_info "输入不匹配，取消操作"
        exit 0
    fi

    _log_info "删除 Stack..."
    aws cloudformation delete-stack \
        --stack-name "$STACK_NAME" \
        --region "$REGION"

    _log_info "等待 Stack 删除完成..."
    if aws cloudformation wait stack-delete-complete \
        --stack-name "$STACK_NAME" \
        --region "$REGION"; then
        _log_info "Stack 已删除"
    else
        _log_error "Stack 删除失败，请检查 AWS Console"
        exit 1
    fi

    # 提醒数据卷
    if [[ -n "$data_volume_id" && "$data_volume_id" != "None" ]]; then
        echo ""
        _log_warn "数据 EBS 卷已保留（DeletionPolicy: Retain），仍在计费"
        echo -e "  卷 ID: ${BLUE}$data_volume_id${NC}"
        echo -e "  费用:  约 \$1.6/月 (20GB gp3)"
        echo ""
        echo "  如确认数据不再需要，手动删除:"
        echo -e "  ${CYAN}aws ec2 delete-volume --volume-id $data_volume_id --region $REGION${NC}"
    fi
}

cmd_cost() {
    _log_step "预估月费用"

    local status
    status="$(_get_stack_status)"

    echo -e "  Stack: ${BLUE}$STACK_NAME${NC}"
    echo ""

    if [[ -z "$status" ]]; then
        echo "  Stack 不存在 — 无费用"
        echo ""
        echo "  ┌─────────────────────────────────────────────────┐"
        echo "  │  如有保留的数据 EBS 卷，仍会产生约 \$1.6/月 费用  │"
        echo "  │  使用 aws ec2 describe-volumes 检查              │"
        echo "  └─────────────────────────────────────────────────┘"
        return
    fi

    local instance_id instance_state
    instance_id="$(_get_stack_output "InstanceId")"

    if [[ -n "$instance_id" && "$instance_id" != "None" ]]; then
        instance_state="$(_get_instance_state "$instance_id")"
    else
        instance_state="unknown"
    fi

    echo -e "  实例状态: ${BLUE}$instance_state${NC}"
    echo ""

    if [[ "$instance_state" == "running" ]]; then
        echo "  ┌──────────────────────┬────────────────┐"
        echo "  │ 资源                 │ 预估月费 (USD) │"
        echo "  ├──────────────────────┼────────────────┤"
        echo "  │ EC2 t3.medium        │ ~\$34.00        │"
        echo "  │ EC2 t3.large (推荐)  │ ~\$67.00        │"
        echo "  │ EBS 根卷 30GB gp3    │ ~\$2.50         │"
        echo "  │ EBS 数据卷 20GB gp3  │ ~\$1.60         │"
        echo "  ├──────────────────────┼────────────────┤"
        echo "  │ 合计 (t3.medium)     │ ~\$38.10        │"
        echo "  │ 合计 (t3.large)      │ ~\$71.10        │"
        echo "  └──────────────────────┴────────────────┘"
    elif [[ "$instance_state" == "stopped" ]]; then
        echo "  ┌──────────────────────┬────────────────┐"
        echo "  │ 资源                 │ 预估月费 (USD) │"
        echo "  ├──────────────────────┼────────────────┤"
        echo "  │ EC2 实例 (已停止)    │ \$0.00          │"
        echo "  │ EBS 根卷 30GB gp3    │ ~\$2.50         │"
        echo "  │ EBS 数据卷 20GB gp3  │ ~\$1.60         │"
        echo "  ├──────────────────────┼────────────────┤"
        echo "  │ 合计                 │ ~\$4.10         │"
        echo "  └──────────────────────┴────────────────┘"
        echo ""
        _log_info "实例已停止，仅 EBS 卷产生费用"
    else
        echo "  实例状态异常，无法准确估算"
    fi

    echo ""
    echo "  提示: 费用为 ap-southeast-1 区域估算值，实际以 AWS 账单为准"
}

# ── 帮助信息 ──────────────────────────────────────────────────
_usage() {
    echo ""
    echo "用法: $0 <子命令> [参数]"
    echo ""
    echo "子命令:"
    echo "  setup-token  存储 GitHub Token 到 Secrets Manager（私有仓库必需）"
    echo "  deploy       创建 CloudFormation Stack（首次部署）"
    echo "  status     查看 Stack 和实例状态"
    echo "  stop       停止 EC2 实例（保留资源，EBS 继续计费）"
    echo "  start      启动 EC2 实例（恢复服务）"
    echo "  ssh        通过 SSM Session Manager 连接实例"
    echo "  setup-ssh  将本地公钥注入实例（允许直接使用 ssh 命令登录）"
    echo "  logs       查看容器日志（默认 wa-bot）"
    echo "  update     远程更新代码并重启服务（git pull + docker compose rebuild）"
    echo "  destroy    删除 Stack（需二次确认）"
    echo "  cost       显示当前状态预估月费"
    echo ""
    echo "环境变量（可选覆盖）:"
    echo "  STACK_NAME       Stack 名称 (默认: automation-ocr)"
    echo "  REGION           AWS 区域 (默认: ap-southeast-1)"
    echo "  GIT_REPO_URL     Git 仓库 URL"
    echo "  GIT_BRANCH       Git 分支 (默认: main)"
    echo "  INSTANCE_TYPE    EC2 实例类型 (默认: t3.large)"
    echo "  DATA_VOLUME_SIZE 数据卷大小 GB (默认: 20)"
    echo "  ADMIN_IP         允许远程登入的 IP 网段 (默认: 本机 IP)"
    echo "  KEY_NAME         SSH 密钥名称 (可选)"
    echo "  GITHUB_TOKEN_SECRET_NAME  Secret 名称 (默认: \$STACK_NAME/github-token)"
    echo ""
    echo "示例:"
    echo "  $0 setup-token ghp_xxxxxxxxxxxx    # 存储 GitHub Token（私有仓库）"
    echo "  $0 deploy                          # 首次部署"
    echo "  $0 stop                            # 暂停服务（节省费用）"
    echo "  $0 start                           # 恢复服务"
    echo "  $0 logs ocr-service 100            # 查看 OCR 服务最近 100 行日志"
    echo "  $0 update                            # 远程拉取最新代码并重启"
    echo "  INSTANCE_TYPE=t3.medium $0 deploy  # 使用较小实例部署"
    echo ""
}

# ── 入口 ──────────────────────────────────────────────────────
main() {
    _check_deps

    local cmd="${1:-}"
    shift || true

    case "$cmd" in
        setup-token) cmd_setup_token "$@" ;;
        deploy)  cmd_deploy "$@" ;;
        status)  cmd_status "$@" ;;
        stop)    cmd_stop "$@" ;;
        start)   cmd_start "$@" ;;
        ssh)     cmd_ssh "$@" ;;
        setup-ssh) cmd_setup_ssh "$@" ;;
        logs)    cmd_logs "$@" ;;
        update)  cmd_update "$@" ;;
        destroy) cmd_destroy "$@" ;;
        cost)    cmd_cost "$@" ;;
        -h|--help|help)
            _usage ;;
        "")
            _log_error "请指定子命令"
            _usage
            exit 1 ;;
        *)
            _log_error "未知子命令: $cmd"
            _usage
            exit 1 ;;
    esac
}

main "$@"
