"use strict";

/**
 * adminUserService.js — Administrator account management (SQLite implementation)
 *
 * Use Node.js's built-in crypto.scrypt for password hashing, without third-party dependencies.
 * Account data is stored in the SQLite admin_users table.
 *
 * Password hash format: scrypt:<salt_hex>:<hash_hex>
 *
 * The external API is fully compatible with the original JSON version, with zero changes to the caller.
 */

const crypto = require("crypto");
const db     = require("../db");

// scrypt parameter (OWASP recommends the lowest value, which is safe enough for low-frequency login scenarios)
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN       = 64;

// ──Crypto tools ───────────────────────────────────────────────────────

/**
 * Generate scrypt hash with random salt
 * @returns {string} Format: "scrypt:<salt_hex>:<hash_hex>"
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * Verify that the password matches the stored hash
 * Use timingSafeEqual to prevent timing attacks
 */
function verifyPassword(password, storedHash) {
  try {
    const [algo, saltHex, hashHex] = storedHash.split(":");
    if (algo !== "scrypt" || !saltHex || !hashHex) return false;
    const salt     = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual   = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ── External interface ───────────────────────────────────────────────────────

/**
 * Whether no users have been created yet (the basis for triggering the first-time setup process)
 */
function isEmpty() {
  db.init();
  const row = db.db.prepare("SELECT COUNT(*) as cnt FROM admin_users").get();
  return row.cnt === 0;
}

/**
 * Verify login credentials
 */
function authenticate(username, password) {
  db.init();
  const user = db.db.prepare("SELECT * FROM admin_users WHERE username = ?").get(username);
  if (!user) return false;
  return verifyPassword(password, user.password_hash);
}

function isSuperAdmin(username) {
  if (!username) return false;
  db.init();
  const user = db.db.prepare(
    "SELECT is_super_admin FROM admin_users WHERE username = ?"
  ).get(username);
  return user?.is_super_admin === 1;
}

/**
 * Create new user
 * The first user defaults to super admin (is_super_admin = 1)
 * @returns {{ ok: boolean, error?: string }}
 */
function createUser(username, password) {
  if (!username || username.length < 3)  return { ok: false, error: "Username must be at least 3 characters" };
  if (!password  || password.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  if (!/^[\w-]+$/.test(username))        return { ok: false, error: "Username only allows letters, numbers, and underscores" };

  db.init();
  const existing = db.db.prepare("SELECT username FROM admin_users WHERE username = ?").get(username);
  if (existing) return { ok: false, error: "Username already exists" };

  // The first user defaults to super admin
  const isEmpty = db.db.prepare("SELECT COUNT(*) as cnt FROM admin_users").get().cnt === 0;
  const isSuperAdmin = isEmpty ? 1 : 0;

  db.db.prepare(
    "INSERT INTO admin_users (username, password_hash, is_super_admin, created_at) VALUES (?, ?, ?, ?)"
  ).run(username, hashPassword(password), isSuperAdmin, new Date().toISOString());

  return { ok: true };
}

/**
 * Reset any user password (administrator operation, no old password required)
 * @returns {{ ok: boolean, error?: string }}
 */
function resetPassword(username, newPassword) {
  if (!newPassword || newPassword.length < 8) return { ok: false, error: "New password must be at least 8 characters" };

  db.init();
  const info = db.db.prepare(
    "UPDATE admin_users SET password_hash = ? WHERE username = ?"
  ).run(hashPassword(newPassword), username);

  if (info.changes === 0) return { ok: false, error: "User does not exist" };
  return { ok: true };
}

/**
 * Delete user (current login account cannot be deleted)
 * @returns {{ ok: boolean, error?: string }}
 */
function deleteUser(username, requestingUsername) {
  if (username === requestingUsername) return { ok: false, error: "The current login account cannot be deleted" };

  db.init();
  const target = db.db.prepare(
    "SELECT is_super_admin FROM admin_users WHERE username = ?"
  ).get(username);
  if (!target) return { ok: false, error: "User does not exist" };
  if (target.is_super_admin === 1) {
    const count = db.db.prepare(
      "SELECT COUNT(*) AS cnt FROM admin_users WHERE is_super_admin = 1"
    ).get().cnt;
    if (count <= 1) return { ok: false, error: "Unable to delete the only Super Admin" };
  }

  const info = db.db.prepare("DELETE FROM admin_users WHERE username = ?").run(username);
  if (info.changes === 0) return { ok: false, error: "User does not exist" };
  return { ok: true };
}

/**
 * Get a list of all users (desensitized, without password hashes)
 * @returns {Array<{ username: string, isSuperAdmin: boolean, createdAt: string }>}
 */
function listUsers() {
  db.init();
  return db.db.prepare("SELECT username, is_super_admin, created_at FROM admin_users").all()
    .map(row => ({ username: row.username, isSuperAdmin: row.is_super_admin === 1, createdAt: row.created_at }));
}

module.exports = {
  isEmpty,
  authenticate,
  isSuperAdmin,
  createUser,
  resetPassword,
  deleteUser,
  listUsers,
};
