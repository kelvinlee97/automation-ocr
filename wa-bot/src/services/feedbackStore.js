"use strict";

/**
 * feedbackStore.js — feedback data layer (SQLite implementation)
 *
 * Responsibility: Manage the reading and writing of feedback tables.
 * CRUD operations that provide feedback to external APIs.
 */

const db = require("../db");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../../../../data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads", "feedback");

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Generate UUID v4
 */
function generateId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/** Convert DB rows to external objects (snake_case → camelCase) */
function rowToRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    githubIssueId: row.github_issue_id,
    githubIssueUrl: row.github_issue_url,
    githubIssueState: row.github_issue_state,
    title: row.title,
    type: row.type,
    description: row.description,
    screenshotUrl: row.screenshot_url,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─────────────────────────────────────────────
// External interface
// ─────────────────────────────────────────────

/**
 * Initialize the data layer (idempotent, callable repeatedly)
 */
function init() {
  ensureUploadsDir();
  db.init();
}

/**
 * Create new feedback
 *
 * @param {object} feedbackData - { title, type, description, screenshotUrl, submittedBy }
 * @returns {{ id: string }}
 */
function create(feedbackData) {
  const id = generateId();
  const now = Date.now();
  const { title, type, description, screenshotUrl, submittedBy } = feedbackData;

  db.db.prepare(`
    INSERT INTO feedback (id, title, type, description, screenshot_url, submitted_by, submitted_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(id, title, type, description, screenshotUrl || null, submittedBy, now, now, now);

  return { id };
}

/**
 * Get all feedback (in reverse order by submittedAt)
 * @param {object} filters - { status, type, q }
 * @param {object} pagination - { page, limit }
 * @returns {{ items: Array, total: number }}
 */
function getAll(filters = {}, pagination = { page: 1, limit: 20 }) {
  db.init();

      let query = "SELECT * FROM feedback WHERE 1=1";
      const params = [];

  if (filters.status) {
    query += " AND status = ?";
    params.push(filters.status);
  }

  if (filters.type) {
    query += " AND type = ?";
    params.push(filters.type);
  }

  if (filters.q) {
    query += " AND (title LIKE ? OR description LIKE ?)";
    const searchTerm = `%${filters.q}%`;
    params.push(searchTerm, searchTerm);
  }

  // Get total
  const countQuery = query.replace("SELECT *", "SELECT COUNT(*) as count");
  const total = db.db.prepare(countQuery).get(...params).count;

  // Pagination
  const offset = (pagination.page - 1) * pagination.limit;
  query += " ORDER BY submitted_at DESC LIMIT ? OFFSET ?";
  params.push(pagination.limit, offset);

  const rows = db.db.prepare(query).all(...params);
  return {
    items: rows.map(rowToRecord),
    total,
  };
}

/**
 * Get feedback statistics (efficient COUNT query)
 * @returns {{ total: number, open: number, resolved: number }}
 */
function getStats() {
  db.init();

  const total = db.db.prepare("SELECT COUNT(*) as count FROM feedback").get().count;
  const open = db.db.prepare("SELECT COUNT(*) as count FROM feedback WHERE status = 'open'").get().count;
  const resolved = db.db.prepare("SELECT COUNT(*) as count FROM feedback WHERE status = 'resolved'").get().count;

  return {
    total,
    open,
    inProgress: 0, // MVP doesn't have in_progress status
    resolved,
  };
}

/**
 * Query single feedback by ID
 * @param {string} id
 * @returns {object|null}
 */
function getById(id) {
  db.init();
  const row = db.db.prepare("SELECT * FROM feedback WHERE id = ?").get(id);
  return rowToRecord(row);
}

/**
 * Update feedback status
 * @param {string} id
 * @param {string} status - "open" | "resolved"
 * @param {string} githubIssueState - "open" | "closed"
 */
function updateStatus(id, status, githubIssueState) {
  db.init();
  const now = Date.now();
  const info = db.db.prepare(`
    UPDATE feedback
    SET status = ?, github_issue_state = ?, updated_at = ?
    WHERE id = ?
  `).run(status, githubIssueState, now, id);

  if (info.changes === 0) throw new Error(`Feedback not found: ${id}`);
}

/**
 * Update GitHub Issue information
 * @param {string} id
 * @param {number} githubIssueId
 * @param {string} githubIssueUrl
 */
function updateGitHubInfo(id, githubIssueId, githubIssueUrl) {
  db.init();
  const now = Date.now();
  const info = db.db.prepare(`
    UPDATE feedback
    SET github_issue_id = ?, github_issue_url = ?, updated_at = ?
    WHERE id = ?
  `).run(githubIssueId, githubIssueUrl, now, id);

  if (info.changes === 0) throw new Error(`Feedback not found: ${id}`);
}

/**
 * Get the absolute path of the screenshot file
 * @param {string} filename
 * @returns {string}
 */
function getScreenshotPath(filename) {
  return path.join(UPLOADS_DIR, filename);
}

/**
 * Update feedback screenshot URL
 * @param {string} id
 * @param {string} screenshotUrl
 */
function updateScreenshotUrl(id, screenshotUrl) {
  db.init();
  const now = Date.now();
  const info = db.db.prepare(`
    UPDATE feedback
    SET screenshot_url = ?, updated_at = ?
    WHERE id = ?
  `).run(screenshotUrl, now, id);

  if (info.changes === 0) throw new Error(`Feedback not found: ${id}`);
}

module.exports = {
  init,
  create,
  getAll,
  getStats,
  getById,
  updateStatus,
  updateGitHubInfo,
  updateScreenshotUrl,
  getScreenshotPath,
};
