#!/usr/bin/env node
/**
 * migrate-add-campaign-fields.js
 *
 * Database migration script: Add new tables and fields required for Campaign functionality
 *
 * How to use:
 *   node wa-bot/scripts/migrate-add-campaign-fields.js --dry-run # Only print, not execute
 *   node wa-bot/scripts/migrate-add-campaign-fields.js --apply #Execute migration (automatic backup)
 *
 * Migrate content:
 *   1. receipts table: add name field (added in front of ic) and campaign_id field
 *   2. admin_users table: Added is_super_admin field (default 0)
 *   3. Add campaigns table
 *   4. Add reject_templates table
 *   5. Add receipt_modifications table
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const db   = require("../src/db");

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../../../data");
const BACKUP_DIR = path.join(DATA_DIR, "backup");

// ──Utility functions ────────────────────────────────────────────────────────────

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
    console.log("⚠️ Database file does not exist, skip backup");
    return null;
  }

  ensureBackupDir();
  const backupPath = path.join(BACKUP_DIR, `app-${timestamp()}.db`);
  await db.db.backup(backupPath);
  console.log(`✅ The database has been backed up to: ${backupPath}`);
  return backupPath;
}

// ──Migration logic────────────────────────────────────────────────────────────

function dryRun() {
  console.log("🔍 Dry run mode - only prints the migration steps and does not execute them\\n");

  console.log("Step 1: Check whether the receipts table needs to add a name field");
  console.log("  ALTER TABLE receipts ADD COLUMN name TEXT;");

  console.log("\\nStep 2: Check whether the campaign_id field needs to be added to the receipts table");
  console.log("  ALTER TABLE receipts ADD COLUMN campaign_id INTEGER;");
  console.log("  CREATE INDEX IF NOT EXISTS idx_receipts_campaign_id ON receipts(campaign_id);");

  console.log("\\nStep 3: Check whether the admin_users table needs to add the is_super_admin field");
  console.log("  ALTER TABLE admin_users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0;");

  console.log("\\nStep 4: Check if campaigns table exists");
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

  console.log("\\nStep 5: Check if the reject_templates table exists");
  console.log(`  CREATE TABLE IF NOT EXISTS reject_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
  );`);

  console.log("\\nStep 6: Check if the receipt_modifications table exists");
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

  console.log("\\n✅ Dry run completed - the above steps will be executed in --apply mode");
}

function migrateDatabase(database) {
  const migrate = database.transaction(() => {

  // Step 1: Add a name field to the receipts table
  console.log("Step 1: Add a name field to the receipts table...");
  const hasNameColumn = database.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('receipts') WHERE name = 'name'"
  ).get().cnt > 0;

  if (!hasNameColumn) {
    // SQLite does not support specifying column positions, name will be added at the end (does not affect functionality)
    database.prepare("ALTER TABLE receipts ADD COLUMN name TEXT").run();
    console.log("✅ name field has been added");
  } else {
    console.log("⚠️ name field already exists, skip");
  }

  // Step 2: Add campaign_id field to the receipts table
  console.log("\\nStep 2: Add campaign_id field to the receipts table...");
  const hasCampaignIdColumn = database.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('receipts') WHERE name = 'campaign_id'"
  ).get().cnt > 0;

  if (!hasCampaignIdColumn) {
    database.prepare("ALTER TABLE receipts ADD COLUMN campaign_id INTEGER").run();
    console.log("✅ campaign_id field has been added");
  } else {
    console.log("⚠️ campaign_id field already exists, skip");
  }
  database.prepare("CREATE INDEX IF NOT EXISTS idx_receipts_campaign_id ON receipts(campaign_id)").run();

  // Step 3: Add the is_super_admin field to the admin_users table
  console.log("\\nStep 3: Add the is_super_admin field to the admin_users table...");
  const hasSuperAdminColumn = database.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('admin_users') WHERE name = 'is_super_admin'"
  ).get().cnt > 0;

  if (!hasSuperAdminColumn) {
    database.prepare("ALTER TABLE admin_users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0").run();
    console.log("✅ is_super_admin field added (default 0 = normal Admin)");
  } else {
    console.log("⚠️ The is_super_admin field already exists, skip");
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
    if (info.changes > 0) console.log("✅ The earliest created administrator has been promoted to Super Admin");
  }

  // Step 4: Create campaigns table
  console.log("\\nStep 4: Create campaigns table...");
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
  console.log("✅ campaigns table has been created (if it does not exist)");

  // Step 5: Create the reject_templates table
  console.log("\\nStep 5: Create the reject_templates table...");
  database.prepare(`
    CREATE TABLE IF NOT EXISTS reject_templates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    )
  `).run();
  console.log("✅ reject_templates table has been created (if it does not exist)");

  // Step 6: Create receipt_modifications table
  console.log("\\nStep 6: Create receipt_modifications table...");
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
  console.log("✅ receipt_modifications table has been created (if it does not exist)");

  });

  migrate();
}

async function apply() {
  console.log("🚀Start migration...\\n");

  const dbPath = path.join(DATA_DIR, "app.db");
  const isExistingDatabase = fs.existsSync(dbPath);
  const backupPath = isExistingDatabase ? await backupDatabase() : null;
  if (!isExistingDatabase) {
    db.init();
    console.log("✅ The database does not exist and has been initialized according to the latest schema.");
  }
  console.log("");

  migrateDatabase(db.db);

  console.log("\\n🎉 Migration completed!");
  if (backupPath) {
    console.log(`📦 Database backup is located at: ${backupPath}`);
  }
}

// ── Main process ────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isApply  = args.includes("--apply");

  if (!isDryRun && !isApply) {
    console.log("How to use:");
    console.log("node migrate-add-campaign-fields.js --dry-run # Only print, do not execute");
    console.log("node migrate-add-campaign-fields.js --apply #Execute migration (automatic backup)");
    process.exitCode = 1;
  } else if (isDryRun) {
    dryRun();
  } else {
    apply().catch((err) => {
      console.error("❌ Migration failed and the transaction was rolled back:", err.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { apply, backupDatabase, migrateDatabase };
