"use strict";

/**
 * adminUserService.js — 管理员账户管理（SQLite 实现）
 *
 * 使用 Node.js 内置 crypto.scrypt 做密码哈希，无第三方依赖。
 * 账户数据存储在 SQLite admin_users 表中。
 *
 * 密码哈希格式：scrypt:<salt_hex>:<hash_hex>
 *
 * 对外 API 与原 JSON 版本完全兼容，调用方零改动。
 */

const crypto = require("crypto");
const db     = require("../db");

// scrypt 参数（OWASP 推荐最低值，低频登录场景足够安全）
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN       = 64;

// ── 密码工具 ──────────────────────────────────────────────────────────────

/**
 * 生成含随机 salt 的 scrypt 哈希
 * @returns {string}  格式："scrypt:<salt_hex>:<hash_hex>"
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * 验证密码是否匹配存储的哈希
 * 使用 timingSafeEqual 防止时序攻击
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

// ── 对外接口 ──────────────────────────────────────────────────────────────

/**
 * 是否尚未创建任何用户（触发首次设置流程的依据）
 */
function isEmpty() {
  db.init();
  const row = db.db.prepare("SELECT COUNT(*) as cnt FROM admin_users").get();
  return row.cnt === 0;
}

/**
 * 验证登录凭据
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
 * 创建新用户
 * 首个用户默认为 super admin（is_super_admin = 1）
 * @returns {{ ok: boolean, error?: string }}
 */
function createUser(username, password) {
  if (!username || username.length < 3)  return { ok: false, error: "用户名至少 3 个字符" };
  if (!password  || password.length < 8) return { ok: false, error: "密码至少 8 个字符" };
  if (!/^[\w-]+$/.test(username))        return { ok: false, error: "用户名只允许字母、数字、下划线" };

  db.init();
  const existing = db.db.prepare("SELECT username FROM admin_users WHERE username = ?").get(username);
  if (existing) return { ok: false, error: "用户名已存在" };

  // 首个用户默认为 super admin
  const isEmpty = db.db.prepare("SELECT COUNT(*) as cnt FROM admin_users").get().cnt === 0;
  const isSuperAdmin = isEmpty ? 1 : 0;

  db.db.prepare(
    "INSERT INTO admin_users (username, password_hash, is_super_admin, created_at) VALUES (?, ?, ?, ?)"
  ).run(username, hashPassword(password), isSuperAdmin, new Date().toISOString());

  return { ok: true };
}

/**
 * 重置任意用户密码（管理员操作，无需旧密码）
 * @returns {{ ok: boolean, error?: string }}
 */
function resetPassword(username, newPassword) {
  if (!newPassword || newPassword.length < 8) return { ok: false, error: "新密码至少 8 个字符" };

  db.init();
  const info = db.db.prepare(
    "UPDATE admin_users SET password_hash = ? WHERE username = ?"
  ).run(hashPassword(newPassword), username);

  if (info.changes === 0) return { ok: false, error: "用户不存在" };
  return { ok: true };
}

/**
 * 删除用户（不能删除当前登录账户）
 * @returns {{ ok: boolean, error?: string }}
 */
function deleteUser(username, requestingUsername) {
  if (username === requestingUsername) return { ok: false, error: "不能删除当前登录账户" };

  db.init();
  const target = db.db.prepare(
    "SELECT is_super_admin FROM admin_users WHERE username = ?"
  ).get(username);
  if (!target) return { ok: false, error: "用户不存在" };
  if (target.is_super_admin === 1) {
    const count = db.db.prepare(
      "SELECT COUNT(*) AS cnt FROM admin_users WHERE is_super_admin = 1"
    ).get().cnt;
    if (count <= 1) return { ok: false, error: "不能删除唯一的 Super Admin" };
  }

  const info = db.db.prepare("DELETE FROM admin_users WHERE username = ?").run(username);
  if (info.changes === 0) return { ok: false, error: "用户不存在" };
  return { ok: true };
}

/**
 * 获取所有用户列表（脱敏，不含密码哈希）
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
