"use strict";

const os   = require("os");
const fs   = require("fs");
const path = require("path");

// DATA_DIR is set at the module level and must be valid before require
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "test-store-"));
process.env.DATA_DIR = DATA_DIR;

// Reset the db singleton, making sure to use the current DATA_DIR
const dbModule = require("../../db");
dbModule._reset();

const store = require("../receiptStore");

// ───Testing assistance─────────────────────────────────────────────────────────────

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
  it("Returns id (timestamp format) and imageFilename", () => {
    const { id, imageFilename } = addOne();
    expect(id).toMatch(/^\d+-\d{4}$/);
    expect(imageFilename).toBe(`${id}.jpg`);
  });

  it("The record status is pending_review and the fields are complete.", () => {
    const { id } = addOne({ phone: "60198765432@c.us", ic: "900202-02-2345" });
    const record = store.getById(id);
    expect(record.status).toBe("pending_review");
    expect(record.phone).toBe("60198765432@c.us");
    expect(record.ic).toBe("900202-02-2345");
    expect(record.aiResult).toBeNull();
  });

  it("mimeType=image/png → .png extension", () => {
    const { imageFilename } = addOne({ mimeType: "image/png" });
    expect(imageFilename).toMatch(/\.png$/);
  });

  it("mimeType=image/webp → .webp extension", () => {
    const { imageFilename } = addOne({ mimeType: "image/webp" });
    expect(imageFilename).toMatch(/\.webp$/);
  });

  it("Unknown mimeType fallback to .jpg", () => {
    const { imageFilename } = addOne({ mimeType: "image/bmp" });
    expect(imageFilename).toMatch(/\.jpg$/);
  });
});

// ─── getAll ───────────────────────────────────────────────────────────────────

describe("getAll", () => {
  it("Multiple records: arranged by submitted_at DESC, both exist", async () => {
    const before = store.getAll().length;
    addOne({ phone: "a@c.us" });
    // Make sure the timestamps are different (SQLite sorts by submitted_at DESC)
    await new Promise(r => setTimeout(r, 2));
    addOne({ phone: "b@c.us" });
    const all = store.getAll();
    expect(all.length).toBe(before + 2);
    const phones = all.map(r => r.phone);
    expect(phones).toContain("a@c.us");
    expect(phones).toContain("b@c.us");
    // The latest (b@c.us) is ranked first
    expect(phones.indexOf("b@c.us")).toBeLessThan(phones.indexOf("a@c.us"));
  });
});

// ─── getById ──────────────────────────────────────────────────────────────────

describe("getById", () => {
  it("Existing id returns record object", () => {
    const { id } = addOne();
    expect(store.getById(id)).not.toBeNull();
  });

  it("Returns null for non-existent id", () => {
    expect(store.getById("nonexistent-0000")).toBeNull();
  });
});

// ─── saveAiResult ─────────────────────────────────────────────────────────────

describe("saveAiResult", () => {
  it("status is transferred to ai_extracted, aiResult is saved correctly", () => {
    const { id } = addOne();
    const aiResult = { qualified: true, amount: "10.00", brand: "TestBrand" };
    store.saveAiResult(id, aiResult);

    const record = store.getById(id);
    expect(record.status).toBe("ai_extracted");
    expect(record.aiResult).toEqual(aiResult);
  });

  it("Throws Error if id does not exist", () => {
    expect(() => store.saveAiResult("bad-id-0000", {})).toThrow("Receipt not found");
  });
});

// ─── confirmReceipt ───────────────────────────────────────────────────────────

describe("confirmReceipt", () => {
  it("status is transferred to confirmed, reviewedAt + reviewNote is written", () => {
    const { id } = addOne();
    store.confirmReceipt(id, "looks good");

    const record = store.getById(id);
    expect(record.status).toBe("confirmed");
    expect(record.reviewNote).toBe("looks good");
    expect(record.reviewedAt).toBeTruthy();
  });

  it("note defaults to an empty string", () => {
    const { id } = addOne();
    store.confirmReceipt(id);
    expect(store.getById(id).reviewNote).toBe("");
  });

  it("Throws Error if id does not exist", () => {
    expect(() => store.confirmReceipt("bad-id-0000")).toThrow("Receipt not found");
  });
});

// ─── rejectReceipt ────────────────────────────────────────────────────────────

describe("rejectReceipt", () => {
  it("status flows to rejected", () => {
    const { id } = addOne();
    store.rejectReceipt(id, "duplicate");

    const record = store.getById(id);
    expect(record.status).toBe("rejected");
    expect(record.reviewNote).toBe("duplicate");
  });

  it("Throws Error if id does not exist", () => {
    expect(() => store.rejectReceipt("bad-id-0000")).toThrow("Receipt not found");
  });
});

// ─── sendMessageToUser ────────────────────────────────────────────────────────

describe("sendMessageToUser", () => {
  it("status flows to waiting_user_reply, save previousStatus + sentMessage + sentAt", () => {
    const { id } = addOne();
    store.confirmReceipt(id);
    store.sendMessageToUser(id, "Please reply with IC");

    const record = store.getById(id);
    expect(record.status).toBe("waiting_user_reply");
    expect(record.previousStatus).toBe("confirmed");
    expect(record.sentMessage).toBe("Please reply with IC");
    expect(record.sentAt).toBeTruthy();
  });

  it("Throws Error if id does not exist", () => {
    expect(() => store.sendMessageToUser("bad-id-0000", "msg")).toThrow("Receipt not found");
  });
});

// ─── updateReceipt ───────────────────────────────────────────────────────────

describe("updateReceipt", () => {
  it("Update allowed fields and record modification history", () => {
    const { id } = addOne({ ic: "880101-01-1234" });

    store.updateReceipt(id, { name: "Kelvin", ic: "900202-02-2345" }, "admin");

    const record = store.getById(id);
    expect(record.name).toBe("Kelvin");
    expect(record.ic).toBe("900202-02-2345");

    const modifications = store.getModifications(id);
    expect(modifications).toHaveLength(2);
    expect(modifications.every(item => Number.isInteger(item.id))).toBe(true);
  });

  it("Deny fields not in allow list", () => {
    const { id } = addOne();
    expect(() => store.updateReceipt(id, { status: "confirmed" }, "admin"))
      .toThrow("Field not editable: status");
  });
});

// ─── getImagePath ─────────────────────────────────────────────────────────────

describe("getImagePath", () => {
  it("Returns the absolute path under IMAGES_DIR", () => {
    const result = store.getImagePath("test.jpg");
    expect(result).toBe(path.join(DATA_DIR, "images", "test.jpg"));
  });
});

// ─── saveSentMessage Deleted Verification ──────────────────────────────────────────────

describe("saveSentMessage removal", () => {
  it("saveSentMessage is not in exports", () => {
    expect(store.saveSentMessage).toBeUndefined();
  });
});
