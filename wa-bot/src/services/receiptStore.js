"use strict";

/**
 * receiptStore.js — receipt data layer (SQLite implementation)
 *
 * Responsibility: Manage the reading and writing of receipts table and data/images/.
 * The external API signature is fully compatible with the original JSON version, with zero changes to the caller.
 *
 * Status flow:
 *   pending_review  ─┐
 *   ai_extracted ─┼──[Send message]──→ waiting_user_reply
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
 * Generate unique ID: timestamp + 4-digit random number
 * Format: 1714000000000-0042
 */
function generateId() {
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `${Date.now()}-${rand}`;
}

/**
 * Infer extension based on MIME type
 */
function extFromMime(mimeType) {
  if (!mimeType) return "jpg";
  if (mimeType.includes("png"))  return "png";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}

/** Convert DB rows to external objects (snake_case → camelCase, aiResult JSON deserialization) */
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
// External interface
// ─────────────────────────────────────────────

/**
 * Initialize the data layer (idempotent, callable repeatedly)
 * Called by index.js on startup; can also be called manually for testing.
 */
function init() {
  ensureImagesDir();
  db.init();
}

/**
 * Save the image received by WhatsApp and write a pending_review record
 *
 * @param {string} phone - Sender WhatsApp number
 * @param {string} base64Data - Image Base64 data (without data:image/... prefix)
 * @param {string} mimeType - Image MIME type
 * @param {string} [ic] - User ID number (from session.ic)
 * @param {string} [name] - Consumer name (from session.name)
 * @param {number} [campaignId] - Currently active Campaign ID (can be null)
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
 * Get all records (in reverse order by submittedAt)
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
 * Query a single record by ID
 * @param {string} id
 * @returns {object|null}
 */
function getById(id) {
  db.init();
  const row = db.db.prepare("SELECT * FROM receipts WHERE id = ?").get(id);
  return rowToRecord(row);
}

/**
 * Save the AI extraction result and the status flow is ai_extracted
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
 * Manually confirm the receipt, and the status will change to confirmed
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
 * If the receipt is manually rejected, the status will change to rejected.
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
 * Manually proactively send messages to users, and the status flow changes to waiting_user_reply
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
 * Update the Receipt field (Admin manual editing)
 * @param {string} id        - Receipt ID
 * @param {object} updates - the field to update (e.g. { ic, name, aiResult })
 * @param {string} modifiedBy - Modifier (Admin username)
 */
function updateReceipt(id, updates, modifiedBy) {
  db.init();
  const row = db.db.prepare("SELECT * FROM receipts WHERE id = ?").get(id);
  if (!row) throw new Error(`Receipt not found: ${id}`);

  const entries = Object.entries(updates);
  const editableFields = new Set(["name", "ic", "campaign_id", "ai_result_json"]);
  for (const [field] of entries) {
    if (!editableFields.has(field)) throw new Error(`Field not editable: ${field}`);
  }
  if (entries.length === 0) return;

  db.db.transaction(() => {
    for (const [field, newValue] of entries) {
      const oldValue = row[field] ?? null;
      if (String(oldValue) !== String(newValue)) {
        addModification(id, modifiedBy, field, oldValue, newValue);
      }
    }

    const setClauses = entries.map(([field]) => `${field} = ?`);
    const params = entries.map(([, value]) => value);
    db.db.prepare(`
      UPDATE receipts SET ${setClauses.join(", ")} WHERE id = ?
    `).run(...params, id);
  })();
}

/**
 * Record Receipt modification history
 * @param {string} receiptId   - Receipt ID
 * @param {string} modifiedBy - Modifier (Admin username)
 * @param {string} fieldName - modified field name
 * @param {string} oldValue - the value before modification
 * @param {string} newValue - modified value
 */
function addModification(receiptId, modifiedBy, fieldName, oldValue, newValue) {
  db.init();
  const modifiedAt = new Date().toISOString();

  db.db.prepare(`
    INSERT INTO receipt_modifications (receipt_id, modified_at, modified_by, field_name, old_value, new_value)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(receiptId, modifiedAt, modifiedBy, fieldName, oldValue, newValue);
}

/**
 * Get Receipt modification history
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
 * Get the currently active Campaign ID
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
 * Returns the absolute disk path to the image (for use by Express res.sendFile)
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
  getActiveCampaign,
  getImagePath,
};
