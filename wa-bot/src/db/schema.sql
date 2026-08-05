-- receipts: main receipt table
CREATE TABLE IF NOT EXISTS receipts (
  id               TEXT PRIMARY KEY,
  phone            TEXT NOT NULL,
  name             TEXT,
  ic               TEXT,
  campaign_id      INTEGER,
  image_filename   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending_review',
  submitted_at     TEXT NOT NULL,
  ai_result_json   TEXT,
  reviewed_at      TEXT,
  review_note      TEXT,
  sent_message     TEXT,
  sent_at          TEXT,
  previous_status  TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE INDEX IF NOT EXISTS idx_receipts_status       ON receipts(status);
CREATE INDEX IF NOT EXISTS idx_receipts_submitted_at ON receipts(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_phone        ON receipts(phone);

-- sessions: user session table
CREATE TABLE IF NOT EXISTS sessions (
  phone              TEXT PRIMARY KEY,
  name               TEXT,
  ic                 TEXT,
  state              TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  receipt_count      INTEGER NOT NULL DEFAULT 0,
  receipt_count_date TEXT NOT NULL
);

-- admin_users: Administrator account table
CREATE TABLE IF NOT EXISTS admin_users (
  username       TEXT PRIMARY KEY,
  password_hash  TEXT NOT NULL,
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

-- feedback: developer feedback form
CREATE TABLE IF NOT EXISTS feedback (
  id                  TEXT PRIMARY KEY,
  github_issue_id     INTEGER,
  github_issue_url    TEXT,
  github_issue_state  TEXT DEFAULT 'open',
  title               TEXT NOT NULL,
  type                TEXT NOT NULL CHECK(type IN ('bug', 'improvement')),
  description         TEXT NOT NULL,
  screenshot_url      TEXT,
  submitted_by        TEXT NOT NULL,
  submitted_at        INTEGER NOT NULL,
  status              TEXT DEFAULT 'open',
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_submitted_at ON feedback(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback(type);

-- campaigns: activity configuration table
CREATE TABLE IF NOT EXISTS campaigns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  brand       TEXT NOT NULL,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  min_amount  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(is_active);
CREATE INDEX IF NOT EXISTS idx_campaigns_dates ON campaigns(start_date, end_date);

-- reject_templates: reject message template table
CREATE TABLE IF NOT EXISTS reject_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

-- receipt_modifications: receipt modification history table
CREATE TABLE IF NOT EXISTS receipt_modifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id   TEXT NOT NULL,
  modified_at  TEXT NOT NULL,
  modified_by  TEXT NOT NULL,
  field_name   TEXT NOT NULL,
  old_value    TEXT,
  new_value    TEXT,
  FOREIGN KEY (receipt_id) REFERENCES receipts(id)
);
