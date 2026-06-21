"use strict";

/**
 * receiptStore.js — 收据数据层（SQLite 实现）
 *
 * 职责：管理 receipts 表与 data/images/ 的读写。
 * 对外 API 签名与原 JSON 版本完全兼容，调用方零改动。
 *
 * 状态流转：
 *   pending_review  ─┐
 *   ai_extracted    ─┼──[发消息]──→ waiting_user_reply
 *   confirmed       ─┤
 *   rejected        ─┘
 *
 *   pending_review → ai_extracted → confirmed
 *                                 → rejected
 */

const fs   = require("fs");
const path = require("path");
const db   = require("../db");

const DATA_DIR   = process.env.DATA_DIR || path.resolve(__dirname, "../../../../data");
const IMAGES_DIR = path.join(DATA_DIR, "images");

function ensureImagesDir() {
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

/**
 * 生成唯一 ID：时间戳 + 4 位随机数
 * 格式：1714000000000-0042
 */
function generateId() {
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `${Date.now()}-${rand}`;
}

/**
 * 根据 MIME 类型推断扩展名
 */
function extFromMime(mimeType) {
  if (!mimeType) return "jpg";
  if (mimeType.includes("png"))  return "png";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}

/** 将 DB 行转换为对外对象（snake_case → camelCase，aiResult JSON 反序列化） */
function rowToRecord(row) {
  if (!row) return null;
  return {
    id:             row.id,
    phone:          row.phone,
    name:           row.name || null,
    ic:             row.ic || null,
    campaignId:     row.campaign_id || null,
    imageFilename:  row.image_filename,
    status:         row.status,
    submittedAt:    row.submitted_at,
    aiResult:       row.ai_result_json ? JSON.parse(row.ai_result_json) : null,
    reviewedAt:     row.reviewed_at,
    reviewNote:     row.review_note,
    sentMessage:    row.sent_message,
    sentAt:         row.sent_at,
    previousStatus: row.previous_status,
  };
}

// ─────────────────────────────────────────────
// 对外接口
// ─────────────────────────────────────────────

/**
 * 初始化数据层（幂等，可重复调用）
 * 由 index.js 在启动时调用；也可手动调用用于测试。
 */
function init() {
  ensureImagesDir();
  db.init();
}

/**
 * 保存 WhatsApp 收到的图片，并写入一条 pending_review 记录
 *
 * @param {string} phone         - 发送方 WhatsApp 号码
 * @param {string} base64Data    - 图片 Base64 数据（不含 data:image/... 前缀）
 * @param {string} mimeType      - 图片 MIME 类型
 * @param {string} [ic]          - 用户身份证号（来自 session.ic）
 * @param {string} [name]        - 消费者姓名（来自 session.name）
 * @param {number} [campaignId]  - 当前活跃 Campaign ID（可为 null）
 * @returns {{ id: string, imageFilename: string }}
 */
function addPendingReceipt(phone, base64Data, mimeType, ic = null, name = null, campaignId = null) {
  ensureImagesDir();

  const id            = generateId();
  const ext           = extFromMime(mimeType);
  const imageFilename = `${id}.${ext}`;
  const imagePath     = path.join(IMAGES_DIR, imageFilename);
  const submittedAt   = new Date().toISOString();

  fs.writeFileSync(imagePath, Buffer.from(base64Data, "base64"));

  db.db.prepare(`
    INSERT INTO receipts (id, phone, name, ic, campaign_id, image_filename, status, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending_review', ?)
  `).run(id, phone, name, ic, campaignId, imageFilename, submittedAt);

  return { id, imageFilename };
}

/**
 * 获取全部记录（按 submittedAt 倒序）
 * @returns {Array}
 */
function getAll() {
  db.init();
  const rows = db.db.prepare(
    "SELECT * FROM receipts ORDER BY submitted_at DESC"
  ).all();
  return rows.map(rowToRecord);
}

/**
 * 按 ID 查询单条记录
 * @param {string} id
 * @returns {object|null}
 */
function getById(id) {
  db.init();
  const row = db.db.prepare("SELECT * FROM receipts WHERE id = ?").get(id);
  return rowToRecord(row);
}

/**
 * 保存 AI 提取结果，状态流转为 ai_extracted
 */
function saveAiResult(id, aiResult) {
  db.init();
  const info = db.db.prepare(`
    UPDATE receipts SET status = 'ai_extracted', ai_result_json = ?
    WHERE id = ?
  `).run(JSON.stringify(aiResult), id);
  if (info.changes === 0) throw new Error(`Receipt not found: ${id}`);
}

/**
 * 人工确认收据，状态流转为 confirmed
 */
function confirmReceipt(id, note = "") {
  db.init();
  const info = db.db.prepare(`
    UPDATE receipts SET status = 'confirmed', reviewed_at = ?, review_note = ?
    WHERE id = ?
  `).run(new Date().toISOString(), note, id);
  if (info.changes === 0) throw new Error(`Receipt not found: ${id}`);
}

/**
 * 人工拒绝收据，状态流转为 rejected
 */
function rejectReceipt(id, note = "") {
  db.init();
  const info = db.db.prepare(`
    UPDATE receipts SET status = 'rejected', reviewed_at = ?, review_note = ?
    WHERE id = ?
  `).run(new Date().toISOString(), note, id);
  if (info.changes === 0) throw new Error(`Receipt not found: ${id}`);
}

/**
 * 人工主动向用户发消息，状态流转为 waiting_user_reply
 */
function sendMessageToUser(id, message) {
  db.init();
  const row = db.db.prepare("SELECT status FROM receipts WHERE id = ?").get(id);
  if (!row) throw new Error(`Receipt not found: ${id}`);

  db.db.prepare(`
    UPDATE receipts
    SET previous_status = status,
        status          = 'waiting_user_reply',
        sent_message    = ?,
        sent_at         = ?
    WHERE id = ?
  `).run(message, new Date().toISOString(), id);
}

/**
 * 更新 Receipt 字段（Admin 手动编辑）
 * @param {string} id        - Receipt ID
 * @param {object} updates  - 要更新的字段（如 { ic, name, aiResult }）
 * @param {string} modifiedBy - 修改人（Admin 用户名）
 */
function updateReceipt(id, updates, modifiedBy) {
  db.init();
  const row = db.db.prepare("SELECT * FROM receipts WHERE id = ?").get(id);
  if (!row) throw new Error(`Receipt not found: ${id}`);

  // 记录修改历史
  for (const [field, newValue] of Object.entries(updates)) {
    const oldValue = row[field] ?? null;
    if (String(oldValue) !== String(newValue)) {
      addModification(id, modifiedBy, field, oldValue, newValue);
    }
  }

  // 更新字段
  const setClauses = [];
  const params = [];
  for (const [field, value] of Object.entries(updates)) {
    setClauses.push(`${field} = ?`);
    params.push(value);
  }
  params.push(id);

  db.db.prepare(`
    UPDATE receipts SET ${setClauses.join(', ')} WHERE id = ?
  `).run(...params);
}

/**
 * 记录 Receipt 修改历史
 * @param {string} receiptId   - Receipt ID
 * @param {string} modifiedBy  - 修改人（Admin 用户名）
 * @param {string} fieldName   - 修改的字段名
 * @param {string} oldValue    - 修改前的值
 * @param {string} newValue    - 修改后的值
 */
function addModification(receiptId, modifiedBy, fieldName, oldValue, newValue) {
  db.init();
  const id = generateId();
  const modifiedAt = new Date().toISOString();

  db.db.prepare(`
    INSERT INTO receipt_modifications (id, receipt_id, modified_at, modified_by, field_name, old_value, new_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, receiptId, modifiedAt, modifiedBy, fieldName, oldValue, newValue);
}

/**
 * 获取 Receipt 修改历史
 * @param {string} receiptId - Receipt ID
 * @returns {Array}
 */
function getModifications(receiptId) {
  db.init();
  const rows = db.db.prepare(
    "SELECT * FROM receipt_modifications WHERE receipt_id = ? ORDER BY modified_at DESC"
  ).all(receiptId);
  return rows;
}

/**
 * 获取当前活跃 Campaign ID
 * @returns {number|null}
 */
async function getActiveCampaign() {
  db.init();
  const row = db.db.prepare(
    "SELECT id FROM campaigns WHERE is_active = 1 AND start_date <= date('now') AND end_date >= date('now') LIMIT 1"
  ).get();
  return row ? row.id : null;
}

/**
 * 返回图片的绝对磁盘路径（供 Express res.sendFile 使用）
 */
function getImagePath(filename) {
  return path.join(IMAGES_DIR, filename);
}

module.exports = {
  init,
  addPendingReceipt,
  getAll,
  getById,
  saveAiResult,
  confirmReceipt,
  rejectReceipt,
  sendMessageToUser,
  updateReceipt,
  getModifications,
  getImagePath,
};
