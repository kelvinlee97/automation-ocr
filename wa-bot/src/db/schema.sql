-- receipts: 收据主表
CREATE TABLE IF NOT EXISTS receipts (
  id               TEXT PRIMARY KEY,
  phone            TEXT NOT NULL,
  ic               TEXT,
  image_filename   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending_review',
  submitted_at     TEXT NOT NULL,
  ai_result_json   TEXT,
  reviewed_at      TEXT,
  review_note      TEXT,
  sent_message     TEXT,
  sent_at          TEXT,
  previous_status  TEXT
);

CREATE INDEX IF NOT EXISTS idx_receipts_status       ON receipts(status);
CREATE INDEX IF NOT EXISTS idx_receipts_submitted_at ON receipts(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_phone        ON receipts(phone);

-- sessions: 用户会话表
CREATE TABLE IF NOT EXISTS sessions (
  phone              TEXT PRIMARY KEY,
  ic                 TEXT,
  state              TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  receipt_count      INTEGER NOT NULL DEFAULT 0,
  receipt_count_date TEXT NOT NULL
);

-- admin_users: 管理员账户表
CREATE TABLE IF NOT EXISTS admin_users (
  username      TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
