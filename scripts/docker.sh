#!/usr/bin/env bash
# docker.sh —— Docker 容器操作（在项目根目录执行）
# 用法:
#   bash scripts/docker.sh up        # 拉镜像 + 后台启动容器
#   bash scripts/docker.sh logs      # 看实时日志
#   bash scripts/docker.sh down      # 停掉容器
#   bash scripts/docker.sh restart   # 拉新镜像并重启（pull && up -d，连贯执行不拆）
#   bash scripts/docker.sh shell     # 进入容器内部排查
#
# 数据存放位置：
#   - 收据图片 / Excel：宿主机 ./data/，容器内 /opt/claimflow/data/
#   - WhatsApp 登录凭据：./data/wwebjs_auth/（删除 = 强制重新扫码）

set -e

# 切到项目根目录（docker compose 必须在根目录跑，不是 wa-bot/）
cd "$(dirname "$0")/.."

case "${1:-}" in
  up)
    # 拉镜像 + 后台启动
    docker compose up -d
    ;;
  logs)
    # 跟随查看 wa-bot 服务日志
    docker compose logs -f wa-bot
    ;;
  down)
    # 停止并移除容器
    docker compose down
    ;;
  restart)
    # 拉最新镜像并重启容器（连贯命令，必须用 && 一气呵成）
    docker compose pull && docker compose up -d
    ;;
  shell)
    # 进入容器内部 shell
    docker compose exec wa-bot sh
    ;;
  *)
    echo "未知子命令: $1"
    echo "可用: up | logs | down | restart | shell"
    exit 1
    ;;
esac
