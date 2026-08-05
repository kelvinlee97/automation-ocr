"use strict";

/**
 * db.test.js — SQLite data layer concurrent writing test
 *
 * Strategy: Use worker_threads to simulate 100 concurrent writes,
 * Verify that no data is lost in WAL mode.
 *
 * Note: better-sqlite3’s synchronization API is executed serially in a single thread.
 * Multiple workers write concurrently to the same SQLite file via independent DB connections.
 */

const os     = require("os");
const fs     = require("fs");
const path   = require("path");
const { Worker, isMainThread, workerData } = require("worker_threads");

// Use temporary directories to ensure test isolation
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "db-concurrency-"));
process.env.DATA_DIR = DATA_DIR;

if (!isMainThread) {
  // ── Worker thread code ────────────────────────────────────────────────────
  // Each worker requires db independently (obtains an independent connection) and executes INSERT once
  const { workerId } = workerData;
  process.env.DATA_DIR = workerData.dataDir;
  const dbModule = require("../../db");
  dbModule.init();
  dbModule.db.prepare(`
    INSERT INTO receipts (id, phone, ic, image_filename, status, submitted_at)
    VALUES (?, ?, NULL, ?, 'pending_review', ?)
  `).run(
    `worker-${workerId}-0000`,
    `worker${workerId}@c.us`,
    `w${workerId}.jpg`,
    new Date().toISOString(),
  );
  dbModule.close();
  process.exit(0);
} else {
  // ── Main thread (Jest test)──────────────────────────────────────────────────
  const dbModule = require("../../db");

  beforeAll(() => {
    dbModule._reset(); // Make sure to use the current DATA_DIR
    process.env.DATA_DIR = DATA_DIR;
    dbModule.init();
  });

  afterAll(() => {
    dbModule.close();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  });

  const WORKER_COUNT = 100;

  test(`No data loss after writing by ${WORKER_COUNT} concurrent workers`, done => {
    let finished = 0;
    let errors   = 0;

    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new Worker(__filename, {
        workerData: { workerId: i, dataDir: DATA_DIR },
      });
      worker.on("exit", code => {
        if (code !== 0) errors++;
        finished++;
        if (finished === WORKER_COUNT) {
          try {
            expect(errors).toBe(0);
            // Reopen the connection to read data (workers have closed their respective connections)
            dbModule._reset();
            dbModule.init();
            const count = dbModule.db.prepare(
              "SELECT COUNT(*) as c FROM receipts"
            ).get().c;
            expect(count).toBe(WORKER_COUNT);
            done();
          } catch (err) {
            done(err);
          }
        }
      });
    }
  }, 30000); // 30s timeout
}
