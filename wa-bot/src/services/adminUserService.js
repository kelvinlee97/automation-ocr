"use strict";

/**
 * adminUserService.js — 管理员账户管理
 *
 * 使用 Node.js 内置 crypto.scrypt 做密码哈希，无第三方依赖
 * 账户数据存储在 data/admin_users.json（与收据数据同目录，已挂载为 Docker volume）
 *
 * 密码哈希格式：scrypt:<salt_hex>:<hash_hex>
 *
 * 状态流转：
 *   isEmpty() === true → /admin/setup 首次设置
 *   isEmpty() === false → 正常登录流程
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

// 优先使用环境变量 DATA_DIR（生产容器通过 docker-compose 注入）
// 回退到相对路径供本地开发，与 receiptStore.js 保持相同约定
const DATA_DIR   = process.env.DATA_DIR || path.resolve(__dirname, "../../../../data");
const USERS_PATH = path.join(DATA_DIR, "admin_users.json");

// scrypt 参数（OWASP 推荐最低值，低频登录场景足够安全）
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
// 派生密钥长度 64 bytes = 512 bits
const KEY_LEN = 64;

// ── 存储层 ────────────────────────────────────────────────────────────────────

function ensureInit() {
  if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_PATH)) fs.writeFileSync(USERS_PATH, "[]", "utf-8");
}

function readUsers() {
  ensureInit();
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, "utf-8"));
  } catch {
    // JSON 损坏时降级为空列表，服务不中断（会触发首次设置流程）
    return [];
  }
}

function writeUsers(users) {
  ensureInit();
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), "utf-8");
}

// ── 密码工具 ──────────────────────────────────────────────────────────────────

/**
 * 生成含随机 salt 的 scrypt 哈希
 * @param {string} password
 * @returns {string}  格式："scrypt:<salt_hex>:<hash_hex>"
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

/**
 * 验证密码是否匹配存储的哈希
 * 使用 timingSafeEqual 防止时序攻击（避免通过响应时间推断密码）
 * @param {string} password
 * @param {string} storedHash
 * @returns {boolean}
 */
function verifyPassword(password, storedHash) {
  try {
    const [algo, salt, hashHex] = storedHash.split(":");
    if (algo !== "scrypt" || !salt || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual   = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ── 对外接口 ──────────────────────────────────────────────────────────────────

/**
 * 是否尚未创建任何用户（触发首次设置流程的依据）
 * @returns {boolean}
 */
function isEmpty() {
  return readUsers().length === 0;
}

/**
 * 验证登录凭据
 * @param {string} username
 * @param {string} password
 * @returns {boolean}
 */
function authenticate(username, password) {
  const user = readUsers().find(u => u.username === username);
  if (!user) return false;
  return verifyPassword(password, user.passwordHash);
}

/**
 * 创建新用户
 * @param {string} username
 * @param {string} password
 * @returns {{ ok: boolean, error?: string }}
 */
function createUser(username, password) {
  if (!username || username.length < 3) return { ok: false, error: "用户名至少 3 个字符" };
  if (!password  || password.length  < 8) return { ok: false, error: "密码至少 8 个字符" };
  // 用户名只允许字母、数字、下划线，防止路径注入
  if (!/^[\w-]+$/.test(username)) return { ok: false, error: "用户名只允许字母、数字、下划线" };

  const users = readUsers();
  if (users.find(u => u.username === username)) return { ok: false, error: "用户名已存在" };

  users.push({
    username,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  });
  writeUsers(users);
  return { ok: true };
}

/**
 * 修改当前用户的密码（需验证旧密码）
 * @returns {{ ok: boolean, error?: string }}
 */
function changePassword(username, oldPassword, newPassword) {
  const users = readUsers();
  const user  = users.find(u => u.username === username);
  if (!user) return { ok: false, error: "用户不存在" };
  if (!verifyPassword(oldPassword, user.passwordHash)) return { ok: false, error: "旧密码错误" };
  if (!newPassword || newPassword.length < 8) return { ok: false, error: "新密码至少 8 个字符" };

  const idx = users.indexOf(user);
  users[idx].passwordHash = hashPassword(newPassword);
  writeUsers(users);
  return { ok: true };
}

/**
 * 重置任意用户密码（管理员操作，无需旧密码）
 * @returns {{ ok: boolean, error?: string }}
 */
function resetPassword(username, newPassword) {
  if (!newPassword || newPassword.length < 8) return { ok: false, error: "新密码至少 8 个字符" };

  const users = readUsers();
  const idx   = users.findIndex(u => u.username === username);
  if (idx === -1) return { ok: false, error: "用户不存在" };

  users[idx].passwordHash = hashPassword(newPassword);
  writeUsers(users);
  return { ok: true };
}

/**
 * 删除用户（不能删除当前登录账户，防止管理员自锁）
 * @returns {{ ok: boolean, error?: string }}
 */
function deleteUser(username, requestingUsername) {
  if (username === requestingUsername) return { ok: false, error: "不能删除当前登录账户" };

  const users = readUsers();
  const idx   = users.findIndex(u => u.username === username);
  if (idx === -1) return { ok: false, error: "用户不存在" };

  users.splice(idx, 1);
  writeUsers(users);
  return { ok: true };
}

/**
 * 获取所有用户列表（脱敏，不含密码哈希）
 * @returns {Array<{ username: string, createdAt: string }>}
 */
function listUsers() {
  return readUsers().map(({ username, createdAt }) => ({ username, createdAt }));
}

module.exports = {
  isEmpty,
  authenticate,
  createUser,
  changePassword,
  resetPassword,
  deleteUser,
  listUsers,
};
