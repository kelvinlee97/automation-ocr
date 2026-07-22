#!/usr/bin/env bash
# migrate-excel-path.sh
# 将旧路径 /app/data/excel/records.xlsx 的数据迁移到新路径（挂载卷）
# 用法：
#   bash migrate-excel-path.sh         # 预览，不实际操作
#   bash migrate-excel-path.sh --apply # 执行迁移

set -euo pipefail

OLD_PATH="/app/data/excel/records.xlsx"
NEW_DIR="${DATA_DIR:-/opt/claimflow/data}/excel"
NEW_PATH="${NEW_DIR}/records.xlsx"

ACTION="${1:-}"

echo "=== Excel 路径迁移脚本 ==="
echo "旧路径（容器内）: $OLD_PATH"
echo "新路径（挂载卷）: $NEW_PATH"
echo ""

if [ ! -f "$OLD_PATH" ]; then
  echo "[SKIP] 旧路径文件不存在，无需迁移。"
  exit 0
fi

echo "[INFO] 检测到旧路径存在文件: $OLD_PATH"
echo "       文件大小: $(du -h "$OLD_PATH" | cut -f1)"

if [ "$ACTION" != "--apply" ]; then
  echo ""
  echo "[DRY-RUN] 预览模式，仅打印计划，不实际操作。"
  echo "         执行实际迁移请运行：bash migrate-excel-path.sh --apply"
  echo ""
  echo "计划操作："
  echo "  1. mkdir -p $NEW_DIR"
  echo "  2. mv $OLD_PATH $NEW_PATH"
  echo ""
  echo "注意：这将把旧文件移至新路径。确认后执行 --apply。"
  exit 0
fi

echo "[APPLY] 开始迁移..."
mkdir -p "$NEW_DIR"
mv "$OLD_PATH" "$NEW_PATH"
echo "[OK] 迁移完成：$OLD_PATH -> $NEW_PATH"
