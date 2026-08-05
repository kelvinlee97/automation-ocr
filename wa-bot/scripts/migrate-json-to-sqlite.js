#!/usr/bin/env node
"use strict";

/**
 * migrate-json-to-sqlite.js — Migrate old JSON files to SQLite
 *
 * usage:
 *   node wa-bot/scripts/migrate-json-to-sqlite.js --dry-run # Only print, do not modify any data
 *   node wa-bot/scripts/migrate-json-to-sqlite.js --apply # Automatic backup + transaction INSERT
 *
 * Idempotent design:
 *   If the corresponding table in SQLite already has data, the migration of the table will be skipped (no repeated writing).
 *   If the old JSON file does not exist, skip it.
 *
 * Backup directory: data/backup/<ISO timestamp>/
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../../../data");

const args   = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const apply  = args.includes("--apply");

if (!dryRun && !apply) {
  console.error("Usage: node migrate-json-to-sqlite.js --dry-run | --apply");
  process.exit(1);
}

// Old JSON file path
const RECEIPTS_JSON  = path.join(DATA_DIR, "pending_receipts.json");
const SESSIONS_JSON  = path.join(DATA_DIR, "sessions.json");
const USERS_JSON     = path.join(DATA_DIR, "admin_users.json");

// Read JSON file, if the file does not exist or is damaged, return null
function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    console.warn(`[WARN] Unable to parse ${filePath}: ${e.message}`);
    return null;
  }
}

// Back up a single file to backupDir
function backup(srcPath, backupDir) {
  const dest = path.join(backupDir, path.basename(srcPath));
  fs.copyFileSync(srcPath, dest);
  console.log(`Backup: ${srcPath} → ${dest}`);
}

function main() {
  console.log(`\n=== migrate-json-to-sqlite [${dryRun ? "dry-run" : "apply"}] ===\n`);

  const receipts = readJson(RECEIPTS_JSON);
  const sessionsRaw = readJson(SESSIONS_JSON);
  const sessions = sessionsRaw ? Object.values(sessionsRaw) : null;
  const users    = readJson(USERS_JSON);

  if (!receipts && !sessions && !users) {
    console.log("No old JSON files found, no need to migrate.");
    return;
  }

  // statistics
  console.log("Old data found:");
  if (receipts)  console.log(`receipts: ${receipts.length} items`);
  if (sessions)  console.log(`sessions: ${sessions.length}`);
  if (users)     console.log(`admin_users: ${users.length} items`);

  if (dryRun) {
    console.log("\\n[dry-run] does not perform any write operations. Use --apply to perform the actual migration. \\n");
    return;
  }

  // ── apply mode ─────────────────────────────────────────────────────────

  // Initialize DB
  process.env.DATA_DIR = DATA_DIR;
  const dbModule = require("../src/db");
  dbModule.init();
  const database = dbModule.db;

  // Check idempotence
  const existingReceipts = database.prepare("SELECT COUNT(*) as c FROM receipts").get().c;
  const existingSessions = database.prepare("SELECT COUNT(*) as c FROM sessions").get().c;
  const existingUsers    = database.prepare("SELECT COUNT(*) as c FROM admin_users").get().c;

  if (existingReceipts > 0 || existingSessions > 0 || existingUsers > 0) {
    console.log("\\n[INFO] Data already exists in SQLite, skip migration (idempotent protection):");
    console.log(`  receipts: ${existingReceipts}, sessions: ${existingSessions}, admin_users: ${existingUsers}`);
    dbModule.close();
    return;
  }

  // Create backup directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(DATA_DIR, "backup", timestamp);
  fs.mkdirSync(backupDir, { recursive: true });
  console.log(`\\nBackup directory: ${backupDir}`);

  if (receipts  && fs.existsSync(RECEIPTS_JSON)) backup(RECEIPTS_JSON, backupDir);
  if (sessionsRaw && fs.existsSync(SESSIONS_JSON)) backup(SESSIONS_JSON, backupDir);
  if (users     && fs.existsSync(USERS_JSON))    backup(USERS_JSON,    backupDir);

  // Transaction batch insert
  const insertAll = database.transaction(() => {
    if (receipts) {
      const stmt = database.prepare(`
        INSERT OR IGNORE INTO receipts
          (id, phone, ic, image_filename, status, submitted_at, ai_result_json,
           reviewed_at, review_note, sent_message, sent_at, previous_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of receipts) {
        stmt.run(
          r.id,
          r.phone,
          r.ic ?? null,
          r.imageFilename,
          r.status,
          r.submittedAt,
          r.aiResult ? JSON.stringify(r.aiResult) : null,
          r.reviewedAt ?? null,
          r.reviewNote ?? null,
          r.sentMessage ?? null,
          r.sentAt ?? null,
          r.previousStatus ?? null,
        );
      }
      console.log(`\\n[OK] receipts migration completed: ${receipts.length} items`);
    }

    if (sessions) {
      const stmt = database.prepare(`
        INSERT OR IGNORE INTO sessions
          (phone, ic, state, created_at, updated_at, receipt_count, receipt_count_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of sessions) {
        stmt.run(
          s.phone,
          s.ic ?? null,
          s.state,
          s.createdAt,
          s.updatedAt,
          s.receiptCount ?? 0,
          s.receiptCountDate ?? new Date().toISOString().slice(0, 10),
        );
      }
      console.log(`[OK] Sessions migration completed: ${sessions.length} items`);
    }

    if (users) {
      const stmt = database.prepare(`
        INSERT OR IGNORE INTO admin_users (username, password_hash, created_at)
        VALUES (?, ?, ?)
      `);
      for (const u of users) {
        stmt.run(u.username, u.passwordHash, u.createdAt);
      }
      console.log(`[OK] admin_users migration completed: ${users.length} items`);
    }
  });

  insertAll();
  dbModule.close();
  console.log("\\nMigration completed successfully! \\n");
}

main();
