"use strict";

/**
 * db/index.js — SQLite 单例
 *
 * 使用 better-sqlite3（同步 API）避免回调地狱。
 * PRAGMA WAL：多进程并发读不阻塞写，适合 WhatsApp Bot 场景。
 * PRAGMA foreign_keys：强制外键约束（当前 schema 无外键，为未来扩展预留）。
 *
 * 导出：
 *   init()  — 创建表、建索引（幂等，可重复调用）
 *   get db  — better-sqlite3 Database 实例（供各 store 使用）
 */

const Database = require("better-sqlite3");
const path     = require("path");
const fs       = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../../../../data");
const DB_PATH  = path.join(DATA_DIR, "app.db");

const SCHEMA = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");

let _db = null;

/**
 * 返回已初始化的 DB 实例（懒创建）
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
 * 创建所有表和索引（幂等）
 * 在应用启动时调用一次即可。
 */
function init() {
  const db = getDb();
  db.exec(SCHEMA);
}

/**
 * 关闭数据库连接（测试时用）
 */
function close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * 重置单例（测试时用，允许更换 DATA_DIR 后重建）
 */
function _reset() {
  close();
}

module.exports = { init, close, _reset, get db() { return getDb(); } };
