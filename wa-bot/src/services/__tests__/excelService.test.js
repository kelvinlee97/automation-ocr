"use strict";

/**
 * excelService.test.js
 *
 * 覆盖重点：
 *   1. DATA_DIR 路径策略（环境变量优先）
 *   2. getExcelPath 返回正确绝对路径
 *   3. initExcel / addRegistration / addReceipt / updateReviewStatus 行为
 *
 * ExcelJS 读写真实文件（使用 OS 临时目录），不 mock ExcelJS。
 */

const os   = require("os");
const fs   = require("fs");
const path = require("path");

describe("excelService — DATA_DIR 路径策略", () => {
  const origEnv = process.env.DATA_DIR;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = origEnv;
    jest.resetModules();
  });

  it("设置 DATA_DIR 时，getExcelPath 使用该目录", () => {
    process.env.DATA_DIR = "/custom/data";
    jest.resetModules();
    const { getExcelPath } = require("../excelService");
    expect(getExcelPath()).toBe("/custom/data/excel/records.xlsx");
  });

  it("未设置 DATA_DIR 时，getExcelPath 回退到相对路径（含 /data/excel/）", () => {
    delete process.env.DATA_DIR;
    jest.resetModules();
    const { getExcelPath } = require("../excelService");
    expect(getExcelPath()).toContain(path.join("data", "excel", "records.xlsx"));
  });
});

describe("excelService — Excel 功能", () => {
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

  it("initExcel 创建 Excel 文件", () => {
    const excelPath = svc.getExcelPath();
    expect(fs.existsSync(excelPath)).toBe(true);
  });

  it("initExcel 幂等：重复调用不抛错", async () => {
    await expect(svc.initExcel()).resolves.not.toThrow();
  });

  // ── addRegistration ────────────────────────────────────────────────────────

  it("addRegistration 新用户成功写入，返回 { success: true }", async () => {
    const result = await svc.addRegistration("60123456789@c.us", "880101-01-1234");
    expect(result).toEqual({ success: true });
  });

  it("addRegistration 同 IC 重复注册返回 { success: false, duplicate: true }", async () => {
    await svc.addRegistration("60123456789@c.us", "880101-01-1234");
    const dup = await svc.addRegistration("60199999999@c.us", "880101-01-1234");
    expect(dup).toEqual({ success: false, duplicate: true });
  });

  it("addRegistration 后 getRegistrations 能读回记录", async () => {
    await svc.addRegistration("60123456789@c.us", "880101-01-1234");
    const rows = await svc.getRegistrations();
    expect(rows.length).toBe(1);
    expect(rows[0]["IC Number"]).toBe("880101-01-1234");
  });

  // ── addReceipt ─────────────────────────────────────────────────────────────

  it("addReceipt 写入一行，getReceipts 能读回", async () => {
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

  it("updateReviewStatus 更新指定行的审核状态", async () => {
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
    expect(info.phone).toBe("60123456789"); // stripWaId 去掉 @c.us
    expect(info.receipt_no).toBe("RC-002");

    const updated = await svc.getReceipts();
    expect(updated[0]["Review Status"]).toBe("approved");
    expect(updated[0]["Reviewer Note"]).toBe("OK");
  });
});
