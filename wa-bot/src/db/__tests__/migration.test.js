"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

describe("campaign database migration", () => {
  let dataDir;
  let dbModule;
  let migration;
  let consoleLog;

  beforeEach(() => {
    jest.resetModules();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "claimflow-migration-"));
    process.env.DATA_DIR = dataDir;
    consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
    dbModule = require("../index");
    migration = require("../../../scripts/migrate-add-campaign-fields");
  });

  afterEach(() => {
    dbModule.close();
    consoleLog.mockRestore();
    delete process.env.DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test("initializes a new database with the latest schema", async () => {
    await migration.apply();

    const tables = dbModule.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all().map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining([
      "campaigns", "reject_templates", "receipt_modifications",
    ]));
  });

  test("migrates old data, promotes the oldest admin, and is idempotent", async () => {
    const sqlite = new Database(path.join(dataDir, "app.db"));
    sqlite.exec(`
      CREATE TABLE receipts (
        id TEXT PRIMARY KEY, phone TEXT NOT NULL, ic TEXT,
        image_filename TEXT NOT NULL, status TEXT NOT NULL,
        submitted_at TEXT NOT NULL
      );
      CREATE TABLE admin_users (
        username TEXT PRIMARY KEY, password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO receipts VALUES ('receipt-1', '60123456789', NULL, 'one.jpg', 'pending_review', '2026-01-01');
      INSERT INTO admin_users VALUES ('first-admin', 'hash-1', '2025-01-01');
      INSERT INTO admin_users VALUES ('second-admin', 'hash-2', '2025-02-01');
    `);
    sqlite.close();

    await migration.apply();
    await migration.apply();

    expect(dbModule.db.prepare("SELECT COUNT(*) AS count FROM receipts").get().count).toBe(1);
    expect(dbModule.db.prepare(
      "SELECT username FROM admin_users WHERE is_super_admin = 1"
    ).all()).toEqual([{ username: "first-admin" }]);
    expect(fs.readdirSync(path.join(dataDir, "backup"))).toHaveLength(2);
  });

  test("rolls back all schema changes when a migration step fails", async () => {
    const sqlite = new Database(path.join(dataDir, "app.db"));
    sqlite.exec(`
      CREATE TABLE receipts (
        id TEXT PRIMARY KEY, phone TEXT NOT NULL, ic TEXT,
        image_filename TEXT NOT NULL, status TEXT NOT NULL,
        submitted_at TEXT NOT NULL
      );
      CREATE TABLE admin_users (
        username TEXT PRIMARY KEY, password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE campaigns (id INTEGER PRIMARY KEY);
    `);
    expect(() => migration.migrateDatabase(sqlite)).toThrow();

    const columns = sqlite.prepare("PRAGMA table_info(receipts)").all().map((row) => row.name);
    expect(columns).not.toContain("name");
    expect(columns).not.toContain("campaign_id");
    sqlite.close();
  });
});
