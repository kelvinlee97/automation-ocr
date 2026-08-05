"use strict";

/**
 * db/index.js — SQLite singleton
 *
 * Use better-sqlite3 (synchronous API) to avoid callback hell.
 * PRAGMA WAL: Multi-process concurrent reading without blocking writing, suitable for WhatsApp Bot scenarios.
 * PRAGMA foreign_keys: enforces foreign key constraints (current schema has no foreign keys, reserved for future expansion).
 *
 * Export:
 *   init() — create tables and indexes (idempotent, can be called repeatedly)
 *   get db — better-sqlite3 Database instance (for use by each store)
 */

const Database = require("better-sqlite3");
const path     = require("path");
const fs       = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../../../../data");
const DB_PATH  = path.join(DATA_DIR, "app.db");

const SCHEMA = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");

let _db = null;

/**
 * Returns the initialized DB instance (lazy creation)
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (_db) return _db;

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  return _db;
}

/**
 * Create all tables and indexes (idempotent)
 * Just call it once when the application starts.
 */
function init() {
  const db = getDb();
  db.exec(SCHEMA);
}

/**
 * Close the database connection (for testing)
 */
function close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Reset singleton (used for testing, allowing DATA_DIR to be replaced and then rebuilt)
 */
function _reset() {
  close();
}

module.exports = { init, close, _reset, get db() { return getDb(); } };
