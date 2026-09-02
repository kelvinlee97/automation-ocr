#!/usr/bin/env bash
# docker.sh - Docker container operation (executed in the project root directory)
# usage:
#   bash scripts/docker.sh up # Pull image + start container in background
#   bash scripts/docker.sh logs # View real-time logs
#   bash scripts/docker.sh down # Stop the container
#   bash scripts/docker.sh restart # Pull a new image and restart (pull && up -d, continuous execution without tearing down)
#   bash scripts/docker.sh shell # Enter the container to troubleshoot
#
# Data storage location:
#   - Receipt image / Excel: host ./data/, container /opt/claimflow/data/
#   - WhatsApp login credentials: ./data/wwebjs_auth/ (delete = force re-scan)

set -e

if [ "${CLAIMFLOW_LEGACY_DEPLOY:-}" != "1" ]; then
  echo "This script controls the archived wa-bot runtime only."
  echo "Use docker-compose.new.yml only when you intentionally containerize the new worker."
  echo "For rollback operations, rerun with CLAIMFLOW_LEGACY_DEPLOY=1."
  exit 2
fi

# Switch to the project root directory (docker compose must be run in the root directory, not wa-bot/)
cd "$(dirname "$0")/.."

case "${1:-}" in
  up)
    # Pull image + start in background
    docker compose up -d
    ;;
  logs)
    # Follow to view wa-bot service log
    docker compose logs -f wa-bot
    ;;
  down)
    # Stop and remove the container
    docker compose down
    ;;
  restart)
    # Pull the latest image and restart the container (consecutive commands must be completed in one go with &&)
    docker compose pull && docker compose up -d
    ;;
  shell)
    # Enter the shell inside the container
    docker compose exec wa-bot sh
    ;;
  *)
    echo "Unknown subcommand: $1"
    echo "Available: up | logs | down | restart | shell"
    exit 1
    ;;
esac
