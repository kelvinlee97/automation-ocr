#!/usr/bin/env node
/**
 * migrate-add-campaign-fields.js
 *
 * 数据库迁移脚本：添加 Campaign 功能所需的新表和字段
 *
 * 使用方式：
 *   node wa-bot/scripts/migrate-add-campaign-fields.js --dry-run   # 仅打印，不执行
 *   node wa-bot/scripts/migrate-add-campaign-fields.js --apply    # 执行迁移（自动备份）
 *
 * 迁移内容：
 *   1. receipts 表：新增 name 字段（加在 ic 前面）、campaign_id 字段
 *   2. admin_users 表：新增 is_super_admin 字段（默认 0）
 *   3. 新增 campaigns 表
 *   4. 新增 reject_templates 表
 *   5. 新增 receipt_modifications 表
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const db   = require("../src/db");

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../../../data");
const BACKUP_DIR = path.join(DATA_DIR, "backup");

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function backupDatabase() {
  const dbPath = path.join(DATA_DIR, "app.db");
  if (!fs.existsSync(dbPath)) {
    console.log("⚠️  数据库文件不存在，跳过备份");
    return null;
  }

  ensureBackupDir();
  const backupPath = path.join(BACKUP_DIR, `app-${timestamp()}.db`);
  await db.db.backup(backupPath);
  console.log(`✅ 数据库已备份到：${backupPath}`);
  return backupPath;
}

// ── 迁移逻辑 ──────────────────────────────────────────────────────────────────

function dryRun() {
  console.log("🔍 Dry run 模式——仅打印迁移步骤，不执行\n");

  console.log("步骤 1：检查 receipts 表是否需要新增 name 字段");
  console.log("  ALTER TABLE receipts ADD COLUMN name TEXT;");

  console.log("\n步骤 2：检查 receipts 表是否需要新增 campaign_id 字段");
  console.log("  ALTER TABLE receipts ADD COLUMN campaign_id INTEGER;");
  console.log("  CREATE INDEX IF NOT EXISTS idx_receipts_campaign_id ON receipts(campaign_id);");

  console.log("\n步骤 3：检查 admin_users 表是否需要新增 is_super_admin 字段");
  console.log("  ALTER TABLE admin_users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0;");

  console.log("\n步骤 4：检查 campaigns 表是否存在");
  console.log(`  CREATE TABLE IF NOT EXISTS campaigns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    brand       TEXT NOT NULL,
    start_date  TEXT NOT NULL,
    end_date    TEXT NOT NULL,
    min_amount  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL
  );`);
  console.log("  CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(is_active);");
  console.log("  CREATE INDEX IF NOT EXISTS idx_campaigns_dates ON campaigns(start_date, end_date);");

  console.log("\n步骤 5：检查 reject_templates 表是否存在");
  console.log(`  CREATE TABLE IF NOT EXISTS reject_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
  );`);

  console.log("\n步骤 6：检查 receipt_modifications 表是否存在");
  console.log(`  CREATE TABLE IF NOT EXISTS receipt_modifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id   TEXT NOT NULL,
    modified_at  TEXT NOT NULL,
    modified_by  TEXT NOT NULL,
    field_name   TEXT NOT NULL,
    old_value    TEXT,
    new_value    TEXT,
    FOREIGN KEY (receipt_id) REFERENCES receipts(id)
  );`);

  console.log("\n✅ Dry run 完成——以上步骤将在 --apply 模式下执行");
}

function migrateDatabase(database) {
  const migrate = database.transaction(() => {

  // 步骤 1：receipts 表新增 name 字段
  console.log("步骤 1：receipts 表新增 name 字段...");
  const hasNameColumn = database.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('receipts') WHERE name = 'name'"
  ).get().cnt > 0;

  if (!hasNameColumn) {
    // SQLite 不支持指定列位置，name 会加在最后（不影响功能）
    database.prepare("ALTER TABLE receipts ADD COLUMN name TEXT").run();
    console.log("  ✅ name 字段已添加");
  } else {
    console.log("  ⚠️  name 字段已存在，跳过");
  }

  // 步骤 2：receipts 表新增 campaign_id 字段
  console.log("\n步骤 2：receipts 表新增 campaign_id 字段...");
  const hasCampaignIdColumn = database.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('receipts') WHERE name = 'campaign_id'"
  ).get().cnt > 0;

  if (!hasCampaignIdColumn) {
    database.prepare("ALTER TABLE receipts ADD COLUMN campaign_id INTEGER").run();
    console.log("  ✅ campaign_id 字段已添加");
  } else {
    console.log("  ⚠️  campaign_id 字段已存在，跳过");
  }
  database.prepare("CREATE INDEX IF NOT EXISTS idx_receipts_campaign_id ON receipts(campaign_id)").run();

  // 步骤 3：admin_users 表新增 is_super_admin 字段
  console.log("\n步骤 3：admin_users 表新增 is_super_admin 字段...");
  const hasSuperAdminColumn = database.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('admin_users') WHERE name = 'is_super_admin'"
  ).get().cnt > 0;

  if (!hasSuperAdminColumn) {
    database.prepare("ALTER TABLE admin_users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0").run();
    console.log("  ✅ is_super_admin 字段已添加（默认 0 = 普通 Admin）");
  } else {
    console.log("  ⚠️  is_super_admin 字段已存在，跳过");
  }

  const superAdminCount = database.prepare(
    "SELECT COUNT(*) AS cnt FROM admin_users WHERE is_super_admin = 1"
  ).get().cnt;
  if (superAdminCount === 0) {
    const info = database.prepare(`
      UPDATE admin_users
      SET is_super_admin = 1
      WHERE username = (
        SELECT username FROM admin_users ORDER BY created_at ASC, rowid ASC LIMIT 1
      )
    `).run();
    if (info.changes > 0) console.log("  ✅ 最早创建的管理员已提升为 Super Admin");
  }

  // 步骤 4：创建 campaigns 表
  console.log("\n步骤 4：创建 campaigns 表...");
  database.prepare(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      brand       TEXT NOT NULL,
      start_date  TEXT NOT NULL,
      end_date    TEXT NOT NULL,
      min_amount  INTEGER NOT NULL DEFAULT 0,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL
    )
  `).run();

  database.prepare("CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(is_active)").run();
  database.prepare("CREATE INDEX IF NOT EXISTS idx_campaigns_dates ON campaigns(start_date, end_date)").run();
  console.log("  ✅ campaigns 表已创建（如不存在）");

  // 步骤 5：创建 reject_templates 表
  console.log("\n步骤 5：创建 reject_templates 表...");
  database.prepare(`
    CREATE TABLE IF NOT EXISTS reject_templates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    )
  `).run();
  console.log("  ✅ reject_templates 表已创建（如不存在）");

  // 步骤 6：创建 receipt_modifications 表
  console.log("\n步骤 6：创建 receipt_modifications 表...");
  database.prepare(`
    CREATE TABLE IF NOT EXISTS receipt_modifications (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id   TEXT NOT NULL,
      modified_at  TEXT NOT NULL,
      modified_by  TEXT NOT NULL,
      field_name   TEXT NOT NULL,
      old_value    TEXT,
      new_value    TEXT,
      FOREIGN KEY (receipt_id) REFERENCES receipts(id)
    )
  `).run();
  console.log("  ✅ receipt_modifications 表已创建（如不存在）");

  });

  migrate();
}

async function apply() {
  console.log("🚀 开始执行迁移...\n");

  const dbPath = path.join(DATA_DIR, "app.db");
  const isExistingDatabase = fs.existsSync(dbPath);
  const backupPath = isExistingDatabase ? await backupDatabase() : null;
  if (!isExistingDatabase) {
    db.init();
    console.log("✅ 数据库不存在，已按最新 schema 初始化");
  }
  console.log("");

  migrateDatabase(db.db);

  console.log("\n🎉 迁移完成！");
  if (backupPath) {
    console.log(`📦 数据库备份位于：${backupPath}`);
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isApply  = args.includes("--apply");

  if (!isDryRun && !isApply) {
    console.log("使用方式：");
    console.log("  node migrate-add-campaign-fields.js --dry-run   # 仅打印，不执行");
    console.log("  node migrate-add-campaign-fields.js --apply    # 执行迁移（自动备份）");
    process.exitCode = 1;
  } else if (isDryRun) {
    dryRun();
  } else {
    apply().catch((err) => {
      console.error("❌ 迁移失败，事务已回滚：", err.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { apply, backupDatabase, migrateDatabase };
