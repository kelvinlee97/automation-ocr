"use strict";

/**
 * db.test.js — SQLite 数据层并发写测试
 *
 * 策略：用 worker_threads 模拟 100 个并发写入，
 * 验证 WAL 模式下不丢数据。
 *
 * 注意：better-sqlite3 的同步 API 在单线程中串行执行，
 * 多 worker 通过独立的 DB 连接并发写入同一 SQLite 文件。
 */

const os     = require("os");
const fs     = require("fs");
const path   = require("path");
const { Worker, isMainThread, workerData } = require("worker_threads");

// 使用临时目录，保证测试隔离
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "db-concurrency-"));
process.env.DATA_DIR = DATA_DIR;

if (!isMainThread) {
  // ── Worker 线程代码 ────────────────────────────────────────────────────────
  // 每个 worker 独立 require db（获得独立连接），执行一次 INSERT
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
  // ── 主线程（Jest 测试）─────────────────────────────────────────────────────
  const dbModule = require("../../db");

  beforeAll(() => {
    dbModule._reset(); // 确保使用当前 DATA_DIR
    process.env.DATA_DIR = DATA_DIR;
    dbModule.init();
  });

  afterAll(() => {
    dbModule.close();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  });

  const WORKER_COUNT = 100;

  test(`${WORKER_COUNT} 个并发 worker 写入后数据不丢失`, done => {
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
            // 重新打开连接读取数据（worker 已关闭各自连接）
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
  }, 30000); // 30s 超时
}
