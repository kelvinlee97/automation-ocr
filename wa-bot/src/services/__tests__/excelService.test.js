"use strict";

/**
 * excelService.test.js
 *
 * Key points covered:
 *   1. DATA_DIR path strategy (environment variables take precedence)
 *   2. getExcelPath returns the correct absolute path
 *   3. initExcel / addRegistration / addReceipt / updateReviewStatus behavior
 *
 * ExcelJS reads and writes real files (using OS temporary directories), does not mock ExcelJS.
 */

const os   = require("os");
const fs   = require("fs");
const path = require("path");

describe("excelService — DATA_DIR path strategy", () => {
  const origEnv = process.env.DATA_DIR;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = origEnv;
    jest.resetModules();
  });

  it("When DATA_DIR is set, getExcelPath uses this directory", () => {
    process.env.DATA_DIR = "/custom/data";
    jest.resetModules();
    const { getExcelPath } = require("../excelService");
    expect(getExcelPath()).toBe("/custom/data/excel/records.xlsx");
  });

  it("When DATA_DIR is not set, getExcelPath falls back to relative paths (including /data/excel/)", () => {
    delete process.env.DATA_DIR;
    jest.resetModules();
    const { getExcelPath } = require("../excelService");
    expect(getExcelPath()).toContain(path.join("data", "excel", "records.xlsx"));
  });
});

describe("excelService — Excel functions", () => {
  let tmpDir;
  let svc;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "excel-test-"));
    process.env.DATA_DIR = tmpDir;
    jest.resetModules();
    svc = require("../excelService");
    await svc.initExcel();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  // ── initExcel ──────────────────────────────────────────────────────────────

  it("initExcel creates Excel files", () => {
    const excelPath = svc.getExcelPath();
    expect(fs.existsSync(excelPath)).toBe(true);
  });

  it("initExcel is idempotent: repeated calls do not throw errors", async () => {
    await expect(svc.initExcel()).resolves.not.toThrow();
  });

  // ── addRegistration ────────────────────────────────────────────────────────

  it("addRegistration The new user is successfully written and returns { success: true }", async () => {
    const result = await svc.addRegistration("60123456789@c.us", "880101-01-1234");
    expect(result).toEqual({ success: true });
  });

  it("addRegistration returns { success: false, duplicate: true } for repeated registration with IC", async () => {
    await svc.addRegistration("60123456789@c.us", "880101-01-1234");
    const dup = await svc.addRegistration("60199999999@c.us", "880101-01-1234");
    expect(dup).toEqual({ success: false, duplicate: true });
  });

  it("After addRegistration getRegistrations can read back the records", async () => {
    await svc.addRegistration("60123456789@c.us", "880101-01-1234");
    const rows = await svc.getRegistrations();
    expect(rows.length).toBe(1);
    expect(rows[0]["IC Number"]).toBe("880101-01-1234");
  });

  // ── addReceipt ─────────────────────────────────────────────────────────────

  it("addReceipt writes a line, getReceipts can read it back", async () => {
    await svc.addReceipt({
      phone:            "60123456789@c.us",
      ic:               "880101-01-1234",
      receipt_no:       "RC-001",
      brand:            "TestBrand",
      amount:           "10.00",
      qualified:        true,
      disqualify_reason: "",
      confidence:       0.95,
    });

    const rows = await svc.getReceipts();
    expect(rows.length).toBe(1);
    expect(rows[0]["Receipt No"]).toBe("RC-001");
    expect(rows[0]["Review Status"]).toBe("pending");
  });

  // ── updateReviewStatus ─────────────────────────────────────────────────────

  it("updateReviewStatus updates the review status of the specified row", async () => {
    await svc.addReceipt({
      phone:            "60123456789@c.us",
      ic:               "880101-01-1234",
      receipt_no:       "RC-002",
      brand:            "Brand",
      amount:           "20.00",
      qualified:        false,
      disqualify_reason: "too low",
      confidence:       0.6,
    });

    const rows = await svc.getReceipts();
    const rowNo = rows[0].rowNo;

    const info = await svc.updateReviewStatus(rowNo, "approved", "OK");
    expect(info.phone).toBe("60123456789"); // stripWaId remove @c.us
    expect(info.receipt_no).toBe("RC-002");

    const updated = await svc.getReceipts();
    expect(updated[0]["Review Status"]).toBe("approved");
    expect(updated[0]["Reviewer Note"]).toBe("OK");
  });
});
