"use strict";

/**
 * receiptStore.js — 收据 JSON 中间层
 *
 * 职责：管理 data/pending_receipts.json 与 data/images/ 的读写。
 * 在 WhatsApp 收图（保存）和管理后台 AI 提取（触发）之间解耦。
 *
 * 状态流转：
 *   pending_review → ai_extracted → confirmed
 *                                 → rejected
 */

const fs   = require("fs");
const path = require("path");

// 优先使用环境变量 DATA_DIR（生产容器通过 docker-compose 注入）
// 回退到相对路径供本地开发：__dirname(/app/src/services) 向上四级 = 项目根目录/data
const DATA_DIR   = process.env.DATA_DIR || path.resolve(__dirname, "../../../../data");
const STORE_PATH = path.join(DATA_DIR, "pending_receipts.json");
const IMAGES_DIR = path.join(DATA_DIR, "images");

/**
 * 初始化必要目录和 JSON 文件（幂等，可重复调用）
 */
function ensureInit() {
  if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR,   { recursive: true });
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify([], null, 2), "utf-8");
  }
}

/** 读取全量记录 */
function readStore() {
  ensureInit();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } catch {
    // JSON 损坏时返回空数组，不阻断服务
    return [];
  }
}

/** 覆盖写入全量记录 */
function writeStore(records) {
  ensureInit();
  fs.writeFileSync(STORE_PATH, JSON.stringify(records, null, 2), "utf-8");
}

/**
 * 生成唯一 ID：时间戳 + 4 位随机数
 * 格式：1714000000000-0042
 * 不引入 uuid 依赖，精度足够用于单机场景
 */
function generateId() {
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `${Date.now()}-${rand}`;
}

/**
 * 根据 MIME 类型推断扩展名
 * WhatsApp 图片通常为 image/jpeg 或 image/png
 */
function extFromMime(mimeType) {
  if (!mimeType) return "jpg";
  if (mimeType.includes("png"))  return "png";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}

// ─────────────────────────────────────────────
// 对外接口
// ─────────────────────────────────────────────

/**
 * 保存 WhatsApp 收到的图片，并写入一条 pending_review 记录
 *
 * @param {string} phone       - 发送方 WhatsApp 号码（e.g. "60123456789@c.us"）
 * @param {string} base64Data  - 图片 Base64 数据（不含 data:image/... 前缀）
 * @param {string} mimeType    - 图片 MIME 类型
 * @param {string} [ic]        - 用户身份证号（来自 session.ic）
 * @returns {{ id: string, imageFilename: string }}
 */
function addPendingReceipt(phone, base64Data, mimeType, ic = null) {
  const id            = generateId();
  const ext           = extFromMime(mimeType);
  const imageFilename = `${id}.${ext}`;
  const imagePath     = path.join(IMAGES_DIR, imageFilename);

  // 将 Base64 写入磁盘，避免在 JSON 中存储大型 base64 字符串
  fs.writeFileSync(imagePath, Buffer.from(base64Data, "base64"));

  const record = {
    id,
    phone,
    ic,
    imageFilename,
    status:      "pending_review",
    submittedAt: new Date().toISOString(),
    aiResult:    null,
    reviewedAt:  null,
    reviewNote:  null,
  };

  const records = readStore();
  records.unshift(record); // 最新的排在最前
  writeStore(records);

  return { id, imageFilename };
}

/**
 * 获取全部记录（已按 submittedAt 倒序排列）
 * @returns {Array}
 */
function getAll() {
  return readStore();
}

/**
 * 按 ID 查询单条记录
 * @param {string} id
 * @returns {object|null}
 */
function getById(id) {
  return readStore().find(r => r.id === id) ?? null;
}

/**
 * 保存 AI 提取结果，状态流转为 ai_extracted
 * @param {string} id
 * @param {object} aiResult  - aiService.processReceipt 的返回值
 */
function saveAiResult(id, aiResult) {
  const records = readStore();
  const idx     = records.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`Receipt not found: ${id}`);

  records[idx].aiResult = aiResult;
  records[idx].status   = "ai_extracted";
  writeStore(records);
}

/**
 * 人工确认收据，状态流转为 confirmed，并写入操作时间和备注
 * @param {string} id
 * @param {string} [note]
 */
function confirmReceipt(id, note = "") {
  const records = readStore();
  const idx     = records.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`Receipt not found: ${id}`);

  records[idx].status     = "confirmed";
  records[idx].reviewedAt = new Date().toISOString();
  records[idx].reviewNote = note;
  writeStore(records);
}

/**
 * 人工拒绝收据，状态流转为 rejected
 * @param {string} id
 * @param {string} [note]
 */
function rejectReceipt(id, note = "") {
  const records = readStore();
  const idx     = records.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`Receipt not found: ${id}`);

  records[idx].status     = "rejected";
  records[idx].reviewedAt = new Date().toISOString();
  records[idx].reviewNote = note;
  writeStore(records);
}

/**
 * 记录人工发送给用户的消息内容，状态流转为 confirmed
 * 用于「发送给用户」操作后保存已发内容，方便审计
 *
 * @param {string} id
 * @param {string} message  发送的消息文本
 */
function saveSentMessage(id, message) {
  const records = readStore();
  const idx     = records.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`Receipt not found: ${id}`);

  records[idx].status      = "confirmed";
  records[idx].sentMessage = message;
  records[idx].sentAt      = new Date().toISOString();
  writeStore(records);
}

/**
 * 返回图片的绝对磁盘路径（供 Express res.sendFile 使用）
 * @param {string} filename
 * @returns {string}
 */
function getImagePath(filename) {
  return path.join(IMAGES_DIR, filename);
}

module.exports = {
  addPendingReceipt,
  getAll,
  getById,
  saveAiResult,
  confirmReceipt,
  rejectReceipt,
  saveSentMessage,
  getImagePath,
};
