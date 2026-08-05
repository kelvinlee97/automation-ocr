#!/usr/bin/env bash
# migrate-excel-path.sh
# Migrate the data of the old path /app/data/excel/records.xlsx to the new path (mount the volume)
# usage:
#   bash migrate-excel-path.sh # Preview, no actual operation
#   bash migrate-excel-path.sh --apply # Execute migration

set -euo pipefail

OLD_PATH="/app/data/excel/records.xlsx"
NEW_DIR="${DATA_DIR:-/opt/claimflow/data}/excel"
NEW_PATH="${NEW_DIR}/records.xlsx"

ACTION="${1:-}"

echo "=== Excel path migration script ==="
echo "Old path (within container): $OLD_PATH"
echo "New path (mounted volume): $NEW_PATH"
echo ""

if [ ! -f "$OLD_PATH" ]; then
  echo "[SKIP] The old path file does not exist and does not need to be migrated."
  exit 0
fi

echo "[INFO] File detected in old path: $OLD_PATH"
echo "File size: $(du -h"$OLD_PATH" | cut -f1)"

if [ "$ACTION" != "--apply" ]; then
  echo ""
  echo "[DRY-RUN] Preview mode, only prints the plan without actual operation."
  echo "To perform the actual migration, please run: bash migrate-excel-path.sh --apply"
  echo ""
  echo "Planned operations:"
  echo "  1. mkdir -p $NEW_DIR"
  echo "  2. mv $OLD_PATH $NEW_PATH"
  echo ""
  echo "NOTE: This will move the old files to the new path. After confirmation, execute --apply."
  exit 0
fi

echo "[APPLY] Starting migration..."
mkdir -p "$NEW_DIR"
mv "$OLD_PATH" "$NEW_PATH"
echo "[OK] Migration completed: $OLD_PATH -> $NEW_PATH"
