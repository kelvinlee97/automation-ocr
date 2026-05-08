#!/usr/bin/env node
"use strict";

/**
 * migrate-json-to-sqlite.js — 将旧 JSON 文件迁移到 SQLite
 *
 * 用法：
 *   node wa-bot/scripts/migrate-json-to-sqlite.js --dry-run   # 仅打印，不修改任何数据
 *   node wa-bot/scripts/migrate-json-to-sqlite.js --apply     # 自动备份 + 事务 INSERT
 *
 * 幂等设计：
 *   若 SQLite 中对应表已有数据，跳过该表的迁移（不重复写入）。
 *   若旧 JSON 文件不存在，跳过。
 *
 * 备份目录：data/backup/<ISO timestamp>/
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../../../data");

const args   = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const apply  = args.includes("--apply");

if (!dryRun && !apply) {
  console.error("用法: node migrate-json-to-sqlite.js --dry-run | --apply");
  process.exit(1);
}

// 旧 JSON 文件路径
const RECEIPTS_JSON  = path.join(DATA_DIR, "pending_receipts.json");
const SESSIONS_JSON  = path.join(DATA_DIR, "sessions.json");
const USERS_JSON     = path.join(DATA_DIR, "admin_users.json");

// 读取 JSON 文件，文件不存在或损坏返回 null
function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    console.warn(`[WARN] 无法解析 ${filePath}: ${e.message}`);
    return null;
  }
}

// 备份单个文件到 backupDir
function backup(srcPath, backupDir) {
  const dest = path.join(backupDir, path.basename(srcPath));
  fs.copyFileSync(srcPath, dest);
  console.log(`  备份: ${srcPath} → ${dest}`);
}

function main() {
  console.log(`\n=== migrate-json-to-sqlite [${dryRun ? "dry-run" : "apply"}] ===\n`);

  const receipts = readJson(RECEIPTS_JSON);
  const sessionsRaw = readJson(SESSIONS_JSON);
  const sessions = sessionsRaw ? Object.values(sessionsRaw) : null;
  const users    = readJson(USERS_JSON);

  if (!receipts && !sessions && !users) {
    console.log("未找到任何旧 JSON 文件，无需迁移。");
    return;
  }

  // 统计
  console.log("发现旧数据：");
  if (receipts)  console.log(`  receipts:    ${receipts.length} 条`);
  if (sessions)  console.log(`  sessions:    ${sessions.length} 条`);
  if (users)     console.log(`  admin_users: ${users.length} 条`);

  if (dryRun) {
    console.log("\n[dry-run] 不执行任何写操作。使用 --apply 执行实际迁移。\n");
    return;
  }

  // ── apply 模式 ───────────────────────────────────────────────────────────────

  // 初始化 DB
  process.env.DATA_DIR = DATA_DIR;
  const dbModule = require("../src/db");
  dbModule.init();
  const database = dbModule.db;

  // 检查幂等
  const existingReceipts = database.prepare("SELECT COUNT(*) as c FROM receipts").get().c;
  const existingSessions = database.prepare("SELECT COUNT(*) as c FROM sessions").get().c;
  const existingUsers    = database.prepare("SELECT COUNT(*) as c FROM admin_users").get().c;

  if (existingReceipts > 0 || existingSessions > 0 || existingUsers > 0) {
    console.log("\n[INFO] SQLite 中已有数据，跳过迁移（幂等保护）：");
    console.log(`  receipts: ${existingReceipts}, sessions: ${existingSessions}, admin_users: ${existingUsers}`);
    dbModule.close();
    return;
  }

  // 创建备份目录
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(DATA_DIR, "backup", timestamp);
  fs.mkdirSync(backupDir, { recursive: true });
  console.log(`\n备份目录: ${backupDir}`);

  if (receipts  && fs.existsSync(RECEIPTS_JSON)) backup(RECEIPTS_JSON, backupDir);
  if (sessionsRaw && fs.existsSync(SESSIONS_JSON)) backup(SESSIONS_JSON, backupDir);
  if (users     && fs.existsSync(USERS_JSON))    backup(USERS_JSON,    backupDir);

  // 事务批量插入
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
      console.log(`\n[OK] receipts 迁移完成：${receipts.length} 条`);
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
      console.log(`[OK] sessions 迁移完成：${sessions.length} 条`);
    }

    if (users) {
      const stmt = database.prepare(`
        INSERT OR IGNORE INTO admin_users (username, password_hash, created_at)
        VALUES (?, ?, ?)
      `);
      for (const u of users) {
        stmt.run(u.username, u.passwordHash, u.createdAt);
      }
      console.log(`[OK] admin_users 迁移完成：${users.length} 条`);
    }
  });

  insertAll();
  dbModule.close();
  console.log("\n迁移成功完成！\n");
}

main();
