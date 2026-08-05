/**
 * sessionManager.js — User session state machine (SQLite implementation)
 *
 * Status flow: WAITING_IC → WAITING_RECEIPT → DONE
 * The external API is fully compatible with the original JSON version, with zero changes to the caller.
 *
 * Fix: The original module-level cache (sessionsCache) caused multi-process or hot reload to become out of sync with the disk;
 *       SQLite single file naturally solves concurrent write race conditions.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const logger = require("./utils/logger");
const db   = require("./db");

const SESSION_STATE = {
  WAITING_IC:      "WAITING_IC",
  WAITING_RECEIPT: "WAITING_RECEIPT",
  DONE:            "DONE",
};

let config = null;

function _getConfig() {
  if (!config) {
    const configPath = path.join(__dirname, "../../config/config.yaml");
    config = yaml.load(fs.readFileSync(configPath, "utf8"));
  }
  return config;
}

function _getTimeoutMs() {
  return _getConfig().bot.session_timeout_minutes * 60 * 1000;
}

function _getMaxPerDay() {
  return _getConfig().bot.max_receipts_per_day;
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}

/** DB row → session object */
function rowToSession(row) {
  if (!row) return null;
  return {
    phone:            row.phone,
    name:             row.name || null,
    ic:               row.ic || null,
    state:            row.state,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
    receiptCount:     row.receipt_count,
    receiptCountDate: row.receipt_count_date,
  };
}

function _getSession(phone) {
  db.init();
  const row = db.db.prepare("SELECT * FROM sessions WHERE phone = ?").get(phone);
  if (!row) return null;

  if (Date.now() - row.updated_at > _getTimeoutMs()) {
    db.db.prepare("DELETE FROM sessions WHERE phone = ?").run(phone);
    return null;
  }

  return rowToSession(row);
}

function _setSession(phone, session) {
  db.init();
  db.db.prepare(`
    INSERT INTO sessions (phone, name, ic, state, created_at, updated_at, receipt_count, receipt_count_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      name               = excluded.name,
      ic                 = excluded.ic,
      state              = excluded.state,
      updated_at         = excluded.updated_at,
      receipt_count      = excluded.receipt_count,
      receipt_count_date = excluded.receipt_count_date
  `).run(
    session.phone,
    session.name || null,
    session.ic,
    session.state,
    session.createdAt,
    session.updatedAt,
    session.receiptCount,
    session.receiptCountDate,
  );
}

function _deleteSession(phone) {
  db.init();
  db.db.prepare("DELETE FROM sessions WHERE phone = ?").run(phone);
}

function _maskPhone(phone) {
  if (!phone) return "";
  return `****${phone.slice(-4)}`;
}

// ─────────────────────────────────────────────
// External interface
// ─────────────────────────────────────────────

function getOrCreateSession(phone) {
  let session = _getSession(phone);

  if (session) {
    logger.debug("Get existing sessions", { phone: _maskPhone(phone), state: session.state });
    return session;
  }

  session = {
    phone,
    name:              null,
    ic:               null,
    state:            SESSION_STATE.WAITING_IC,
    createdAt:        Date.now(),
    updatedAt:        Date.now(),
    receiptCount:     0,
    receiptCountDate: _today(),
  };

  _setSession(phone, session);
  logger.info("New session", { phone: _maskPhone(phone), state: session.state });
  return session;
}

function updateSession(phone, updates) {
  const session = _getSession(phone);
  if (!session) throw new Error(`Session does not exist: ${phone}`);

  Object.assign(session, updates, { updatedAt: Date.now() });
  _setSession(phone, session);
  logger.debug("session update", { phone: _maskPhone(phone), updates });
}

function checkReceiptLimit(phone) {
  const maxPerDay = _getMaxPerDay();
  const session   = _getSession(phone);
  if (!session) return { allowed: false, reason: "Session does not exist" };

  if (session.receiptCountDate !== _today()) {
    session.receiptCount     = 0;
    session.receiptCountDate = _today();
    _setSession(phone, session);
  }

  if (session.receiptCount >= maxPerDay) {
    return { allowed: false, reason: `The maximum number of submissions has been reached today (${maxPerDay} times)` };
  }

  return { allowed: true };
}

function incrementReceiptCount(phone) {
  const session = _getSession(phone);
  if (session) {
    session.receiptCount += 1;
    session.updatedAt     = Date.now();
    _setSession(phone, session);
  }
}

function getAllSessions() {
  db.init();
  const timeoutMs = _getTimeoutMs();
  const cutoff    = Date.now() - timeoutMs;
  const rows = db.db.prepare(
    "SELECT * FROM sessions WHERE updated_at > ?"
  ).all(cutoff);
  return rows.map(rowToSession);
}

function init() {
  db.init();
  logger.info("SessionManager initialization", { mode: "sqlite" });
}

module.exports = {
  SESSION_STATE,
  init,
  getOrCreateSession,
  updateSession,
  checkReceiptLimit,
  incrementReceiptCount,
  getAllSessions,
};
