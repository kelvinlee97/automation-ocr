"use strict";

const os   = require("os");
const fs   = require("fs");
const path = require("path");

// DATA_DIR 在模块级设置，require 前必须有效
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "test-store-"));
process.env.DATA_DIR = DATA_DIR;

// 重置 db 单例，确保使用当前 DATA_DIR
const dbModule = require("../../db");
dbModule._reset();

const store = require("../receiptStore");

// ─── 测试辅助 ──────────────────────────────────────────────────────────────────

function addOne(overrides = {}) {
  return store.addPendingReceipt(
    overrides.phone      ?? "60123456789@c.us",
    Buffer.from("fake-image").toString("base64"),
    overrides.mimeType   ?? "image/jpeg",
    overrides.ic         ?? "880101-01-1234"
  );
}

beforeAll(() => {
  store.init();
});

afterAll(() => {
  dbModule.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

// ─── addPendingReceipt ────────────────────────────────────────────────────────

describe("addPendingReceipt", () => {
  it("返回 id（时间戳格式）和 imageFilename", () => {
    const { id, imageFilename } = addOne();
    expect(id).toMatch(/^\d+-\d{4}$/);
    expect(imageFilename).toBe(`${id}.jpg`);
  });

  it("记录 status 为 pending_review，字段齐全", () => {
    const { id } = addOne({ phone: "60198765432@c.us", ic: "900202-02-2345" });
    const record = store.getById(id);
    expect(record.status).toBe("pending_review");
    expect(record.phone).toBe("60198765432@c.us");
    expect(record.ic).toBe("900202-02-2345");
    expect(record.aiResult).toBeNull();
  });

  it("mimeType=image/png → .png 扩展名", () => {
    const { imageFilename } = addOne({ mimeType: "image/png" });
    expect(imageFilename).toMatch(/\.png$/);
  });

  it("mimeType=image/webp → .webp 扩展名", () => {
    const { imageFilename } = addOne({ mimeType: "image/webp" });
    expect(imageFilename).toMatch(/\.webp$/);
  });

  it("未知 mimeType 回退为 .jpg", () => {
    const { imageFilename } = addOne({ mimeType: "image/bmp" });
    expect(imageFilename).toMatch(/\.jpg$/);
  });
});

// ─── getAll ───────────────────────────────────────────────────────────────────

describe("getAll", () => {
  it("多条记录：按 submitted_at DESC 排列，两条都存在", async () => {
    const before = store.getAll().length;
    addOne({ phone: "a@c.us" });
    // 确保时间戳不同（SQLite 按 submitted_at DESC 排序）
    await new Promise(r => setTimeout(r, 2));
    addOne({ phone: "b@c.us" });
    const all = store.getAll();
    expect(all.length).toBe(before + 2);
    const phones = all.map(r => r.phone);
    expect(phones).toContain("a@c.us");
    expect(phones).toContain("b@c.us");
    // 最新的（b@c.us）排在前面
    expect(phones.indexOf("b@c.us")).toBeLessThan(phones.indexOf("a@c.us"));
  });
});

// ─── getById ──────────────────────────────────────────────────────────────────

describe("getById", () => {
  it("已存在的 id 返回记录对象", () => {
    const { id } = addOne();
    expect(store.getById(id)).not.toBeNull();
  });

  it("不存在的 id 返回 null", () => {
    expect(store.getById("nonexistent-0000")).toBeNull();
  });
});

// ─── saveAiResult ─────────────────────────────────────────────────────────────

describe("saveAiResult", () => {
  it("status 流转为 ai_extracted，aiResult 保存正确", () => {
    const { id } = addOne();
    const aiResult = { qualified: true, amount: "10.00", brand: "TestBrand" };
    store.saveAiResult(id, aiResult);

    const record = store.getById(id);
    expect(record.status).toBe("ai_extracted");
    expect(record.aiResult).toEqual(aiResult);
  });

  it("id 不存在时抛出 Error", () => {
    expect(() => store.saveAiResult("bad-id-0000", {})).toThrow("Receipt not found");
  });
});

// ─── confirmReceipt ───────────────────────────────────────────────────────────

describe("confirmReceipt", () => {
  it("status 流转为 confirmed，reviewedAt + reviewNote 写入", () => {
    const { id } = addOne();
    store.confirmReceipt(id, "looks good");

    const record = store.getById(id);
    expect(record.status).toBe("confirmed");
    expect(record.reviewNote).toBe("looks good");
    expect(record.reviewedAt).toBeTruthy();
  });

  it("note 默认为空字符串", () => {
    const { id } = addOne();
    store.confirmReceipt(id);
    expect(store.getById(id).reviewNote).toBe("");
  });

  it("id 不存在时抛出 Error", () => {
    expect(() => store.confirmReceipt("bad-id-0000")).toThrow("Receipt not found");
  });
});

// ─── rejectReceipt ────────────────────────────────────────────────────────────

describe("rejectReceipt", () => {
  it("status 流转为 rejected", () => {
    const { id } = addOne();
    store.rejectReceipt(id, "duplicate");

    const record = store.getById(id);
    expect(record.status).toBe("rejected");
    expect(record.reviewNote).toBe("duplicate");
  });

  it("id 不存在时抛出 Error", () => {
    expect(() => store.rejectReceipt("bad-id-0000")).toThrow("Receipt not found");
  });
});

// ─── sendMessageToUser ────────────────────────────────────────────────────────

describe("sendMessageToUser", () => {
  it("status 流转为 waiting_user_reply，保存 previousStatus + sentMessage + sentAt", () => {
    const { id } = addOne();
    store.confirmReceipt(id);
    store.sendMessageToUser(id, "Please reply with IC");

    const record = store.getById(id);
    expect(record.status).toBe("waiting_user_reply");
    expect(record.previousStatus).toBe("confirmed");
    expect(record.sentMessage).toBe("Please reply with IC");
    expect(record.sentAt).toBeTruthy();
  });

  it("id 不存在时抛出 Error", () => {
    expect(() => store.sendMessageToUser("bad-id-0000", "msg")).toThrow("Receipt not found");
  });
});

// ─── updateReceipt ───────────────────────────────────────────────────────────

describe("updateReceipt", () => {
  it("更新允许的字段并记录修改历史", () => {
    const { id } = addOne({ ic: "880101-01-1234" });

    store.updateReceipt(id, { name: "Kelvin", ic: "900202-02-2345" }, "admin");

    const record = store.getById(id);
    expect(record.name).toBe("Kelvin");
    expect(record.ic).toBe("900202-02-2345");

    const modifications = store.getModifications(id);
    expect(modifications).toHaveLength(2);
    expect(modifications.every(item => Number.isInteger(item.id))).toBe(true);
  });

  it("拒绝不在允许列表中的字段", () => {
    const { id } = addOne();
    expect(() => store.updateReceipt(id, { status: "confirmed" }, "admin"))
      .toThrow("Field not editable: status");
  });
});

// ─── getImagePath ─────────────────────────────────────────────────────────────

describe("getImagePath", () => {
  it("返回 IMAGES_DIR 下的绝对路径", () => {
    const result = store.getImagePath("test.jpg");
    expect(result).toBe(path.join(DATA_DIR, "images", "test.jpg"));
  });
});

// ─── saveSentMessage 已删除验证 ───────────────────────────────────────────────

describe("saveSentMessage removal", () => {
  it("saveSentMessage 不在 exports 中", () => {
    expect(store.saveSentMessage).toBeUndefined();
  });
});
