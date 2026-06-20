"use strict";

/**
 * feedbackStore.test.js — feedbackStore 数据层单元测试
 *
 * 测试策略：
 *  - 使用临时 SQLite 数据库（better-sqlite3）
 *  - 每个测试前清空 feedback 表
 *  - 验证所有 CRUD 操作和边界情况
 */

const os = require("os");
const fs = require("fs");
const path = require("path");

// DATA_DIR 在模块级设置，require 前必须有效
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "test-feedback-store-"));
process.env.DATA_DIR = DATA_DIR;

// 重置 db 单例，确保使用当前 DATA_DIR
const dbModule = require("../../db");
dbModule._reset();

const store = require("../feedbackStore");

// ─── 测试辅助 ──────────────────────────────────────────────────────────────────

function createFakeFeedback(overrides = {}) {
  return {
    title: "Test Feedback",
    type: "bug",
    description: "This is a test feedback description",
    screenshotUrl: null,
    submittedBy: "admin-test",
    ...overrides,
  };
}

function addFeedback(overrides = {}) {
  const feedbackData = createFakeFeedback(overrides);
  const { id } = store.create(feedbackData);
  return { id, ...feedbackData, submittedAt: Date.now() };
}

beforeAll(() => {
  store.init();
});

beforeEach(() => {
  // 清空 feedback 表
  dbModule.db.prepare("DELETE FROM feedback").run();
});

afterAll(() => {
  dbModule.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

// ─── create ────────────────────────────────────────────────────────────────────

describe("feedbackStore.create", () => {
  it("创建反馈后返回 id", () => {
    const { id } = store.create(createFakeFeedback());
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("创建的反馈可以在数据库中找到", () => {
    const { id } = store.create(createFakeFeedback());
    const record = store.getById(id);
    expect(record).not.toBeNull();
    expect(record.id).toBe(id);
  });

  it("title 正确保存", () => {
    const { id } = store.create(createFakeFeedback({ title: "Bug in receipt page" }));
    const record = store.getById(id);
    expect(record.title).toBe("Bug in receipt page");
  });

  it("type 正确保存（bug）", () => {
    const { id } = store.create(createFakeFeedback({ type: "bug" }));
    const record = store.getById(id);
    expect(record.type).toBe("bug");
  });

  it("type 正确保存（improvement）", () => {
    const { id } = store.create(createFakeFeedback({ type: "improvement" }));
    const record = store.getById(id);
    expect(record.type).toBe("improvement");
  });

  it("description 正确保存", () => {
    const desc = "When clicking on Receipts tab, page shows 500 error";
    const { id } = store.create(createFakeFeedback({ description: desc }));
    const record = store.getById(id);
    expect(record.description).toBe(desc);
  });

  it("screenshotUrl 为 null 时正确保存", () => {
    const { id } = store.create(createFakeFeedback({ screenshotUrl: null }));
    const record = store.getById(id);
    expect(record.screenshotUrl).toBeNull();
  });

  it("screenshotUrl 有值时正确保存", () => {
    const url = "/uploads/feedback/test-123.png";
    const { id } = store.create(createFakeFeedback({ screenshotUrl: url }));
    const record = store.getById(id);
    expect(record.screenshotUrl).toBe(url);
  });

  it("submittedBy 正确保存", () => {
    const { id } = store.create(createFakeFeedback({ submittedBy: "admin-kelvin" }));
    const record = store.getById(id);
    expect(record.submittedBy).toBe("admin-kelvin");
  });

  it("初始 status 为 open", () => {
    const { id } = store.create(createFakeFeedback());
    const record = store.getById(id);
    expect(record.status).toBe("open");
  });

  it("初始 github_issue_id 为 null", () => {
    const { id } = store.create(createFakeFeedback());
    const record = store.getById(id);
    expect(record.githubIssueId).toBeNull();
  });

  it("初始 github_issue_url 为 null", () => {
    const { id } = store.create(createFakeFeedback());
    const record = store.getById(id);
    expect(record.githubIssueUrl).toBeNull();
  });

  it("初始 github_issue_state 为 open", () => {
    const { id } = store.create(createFakeFeedback());
    const record = store.getById(id);
    expect(record.githubIssueState).toBe("open");
  });

  it("createdAt 和 updatedAt 自动设置", () => {
    const before = Date.now();
    const { id } = store.create(createFakeFeedback());
    const after = Date.now();
    const record = store.getById(id);
    expect(record.createdAt).toBeGreaterThanOrEqual(before);
    expect(record.createdAt).toBeLessThanOrEqual(after);
    expect(record.updatedAt).toBeGreaterThanOrEqual(before);
    expect(record.updatedAt).toBeLessThanOrEqual(after);
  });
});

// ─── getAll ────────────────────────────────────────────────────────────────────

describe("feedbackStore.getAll", () => {
  it("空数据库返回空数组", () => {
    const result = store.getAll();
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("一条记录时返回该记录", () => {
    addFeedback({ title: "Test 1" });
    const result = store.getAll();
    expect(result.items.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.items[0].title).toBe("Test 1");
  });

  it("多条记录：按 submitted_at DESC 排列", async () => {
    addFeedback({ title: "First" });
    await new Promise(r => setTimeout(r, 2));
    addFeedback({ title: "Second" });
    const result = store.getAll();
    expect(result.items.length).toBe(2);
    expect(result.items[0].title).toBe("Second");
    expect(result.items[1].title).toBe("First");
  });

  it("过滤：status=open 只返回 open 状态", () => {
    addFeedback({ title: "Open Feedback" });
    const resolvedId = addFeedback({ title: "Resolved Feedback" }).id;
    store.updateStatus(resolvedId, "resolved", "closed");

    const result = store.getAll({ status: "open" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].status).toBe("open");
  });

  it("过滤：status=resolved 只返回 resolved 状态", () => {
    addFeedback({ title: "Open Feedback" });
    const resolvedId = addFeedback({ title: "Resolved Feedback" }).id;
    store.updateStatus(resolvedId, "resolved", "closed");

    const result = store.getAll({ status: "resolved" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].status).toBe("resolved");
  });

  it("过滤：type=bug 只返回 bug 类型", () => {
    addFeedback({ title: "Bug Report", type: "bug" });
    addFeedback({ title: "Feature Request", type: "improvement" });

    const result = store.getAll({ type: "bug" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].type).toBe("bug");
  });

  it("过滤：type=improvement 只返回 improvement 类型", () => {
    addFeedback({ title: "Bug Report", type: "bug" });
    addFeedback({ title: "Feature Request", type: "improvement" });

    const result = store.getAll({ type: "improvement" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].type).toBe("improvement");
  });

  it("搜索：q 参数搜索 title", () => {
    addFeedback({ title: "Receipt page crash" });
    addFeedback({ title: "Export to Excel feature" });

    const result = store.getAll({ q: "receipt" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].title).toContain("Receipt");
  });

  it("搜索：q 参数搜索 description", () => {
    addFeedback({ title: "Bug 1", description: "The page crashes when filtering" });
    addFeedback({ title: "Bug 2", description: "Export feature needed" });

    const result = store.getAll({ q: "filtering" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].description).toContain("filtering");
  });

  it("搜索：q 参数不区分大小写", () => {
    addFeedback({ title: "RECEIPT CRASH", description: "Page crashes" });

    const result = store.getAll({ q: "receipt" });
    expect(result.items.length).toBe(1);
  });

  it("分页：page=1, limit=2 返回前2条", async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 2));
      addFeedback({ title: `Feedback ${i}` });
    }

    const result = store.getAll({}, { page: 1, limit: 2 });
    expect(result.items.length).toBe(2);
    expect(result.total).toBe(5);
  });

  it("分页：page=3, limit=2 返回第5条", async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 2));
      addFeedback({ title: `Feedback ${i}` });
    }

    const result = store.getAll({}, { page: 3, limit: 2 });
    expect(result.items.length).toBe(1);
    expect(result.total).toBe(5);
  });

  it("组合过滤：status + type + q", () => {
    addFeedback({ title: "Bug: crash", type: "bug", description: "Page crashes" });
    addFeedback({ title: "Bug: slow", type: "bug", description: "Page is slow" });
    addFeedback({ title: "Feature: export", type: "improvement", description: "Export to Excel" });

    const result = store.getAll(
      { status: "open", type: "bug", q: "crash" },
      { page: 1, limit: 10 }
    );
    expect(result.items.length).toBe(1);
    expect(result.items[0].title).toBe("Bug: crash");
  });
});

// ─── getStats ──────────────────────────────────────────────────────────────────

describe("feedbackStore.getStats", () => {
  it("空数据库返回零值", () => {
    const stats = store.getStats();
    expect(stats.total).toBe(0);
    expect(stats.open).toBe(0);
    expect(stats.resolved).toBe(0);
    expect(stats.inProgress).toBe(0);
  });

  it("一条 open 反馈", () => {
    addFeedback({ title: "Open Feedback" });
    const stats = store.getStats();
    expect(stats.total).toBe(1);
    expect(stats.open).toBe(1);
    expect(stats.resolved).toBe(0);
  });

  it("一条 resolved 反馈", () => {
    const { id } = addFeedback({ title: "Resolved Feedback" });
    store.updateStatus(id, "resolved", "closed");
    const stats = store.getStats();
    expect(stats.total).toBe(1);
    expect(stats.open).toBe(0);
    expect(stats.resolved).toBe(1);
  });

  it("混合状态", () => {
    addFeedback({ title: "Open 1" });
    addFeedback({ title: "Open 2" });
    const { id } = addFeedback({ title: "Resolved" });
    store.updateStatus(id, "resolved", "closed");

    const stats = store.getStats();
    expect(stats.total).toBe(3);
    expect(stats.open).toBe(2);
    expect(stats.resolved).toBe(1);
  });

  it("inProgress 始终返回 0（MVP 不支持）", () => {
    const stats = store.getStats();
    expect(stats.inProgress).toBe(0);
  });
});

// ─── getById ──────────────────────────────────────────────────────────────────

describe("feedbackStore.getById", () => {
  it("已存在的 id 返回记录对象", () => {
    const { id } = addFeedback({ title: "Test" });
    const record = store.getById(id);
    expect(record).not.toBeNull();
    expect(record.id).toBe(id);
    expect(record.title).toBe("Test");
  });

  it("不存在的 id 返回 null", () => {
    const record = store.getById("nonexistent-uuid-0000");
    expect(record).toBeNull();
  });

  it("返回的对象字段完整", () => {
    const { id } = addFeedback({
      title: "Full Test",
      type: "improvement",
      description: "Full description",
      screenshotUrl: "/uploads/feedback/test.png",
      submittedBy: "admin1",
    });
    store.updateGitHubInfo(id, 123, "https://github.com/test/123");

    const record = store.getById(id);
    expect(record).toEqual({
      id,
      githubIssueId: 123,
      githubIssueUrl: "https://github.com/test/123",
      githubIssueState: "open",
      title: "Full Test",
      type: "improvement",
      description: "Full description",
      screenshotUrl: "/uploads/feedback/test.png",
      submittedBy: "admin1",
      submittedAt: expect.any(Number),
      status: "open",
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
  });
});

// ─── updateStatus ──────────────────────────────────────────────────────────────

describe("feedbackStore.updateStatus", () => {
  it("更新 status 和 githubIssueState", () => {
    const { id } = addFeedback({ title: "Test" });
    store.updateStatus(id, "resolved", "closed");

    const record = store.getById(id);
    expect(record.status).toBe("resolved");
    expect(record.githubIssueState).toBe("closed");
  });

  it("更新后 updatedAt 变化", () => {
    const { id } = addFeedback({ title: "Test" });
    const original = store.getById(id);
    const originalUpdatedAt = original.updatedAt;

    // 等待至少 1ms 确保时间戳不同
    return new Promise(r => setTimeout(r, 2)).then(() => {
      store.updateStatus(id, "resolved", "closed");
      const updated = store.getById(id);
      expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  it("不存在的 id 抛出错误", () => {
    expect(() => {
      store.updateStatus("nonexistent-id", "resolved", "closed");
    }).toThrow(/Feedback not found/);
  });
});

// ─── updateGitHubInfo ──────────────────────────────────────────────────────────

describe("feedbackStore.updateGitHubInfo", () => {
  it("更新 githubIssueId 和 githubIssueUrl", () => {
    const { id } = addFeedback({ title: "Test" });
    store.updateGitHubInfo(id, 456, "https://github.com/test/456");

    const record = store.getById(id);
    expect(record.githubIssueId).toBe(456);
    expect(record.githubIssueUrl).toBe("https://github.com/test/456");
  });

  it("更新后 updatedAt 变化", () => {
    const { id } = addFeedback({ title: "Test" });
    const original = store.getById(id);
    const originalUpdatedAt = original.updatedAt;

    return new Promise(r => setTimeout(r, 2)).then(() => {
      store.updateGitHubInfo(id, 456, "https://github.com/test/456");
      const updated = store.getById(id);
      expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  it("不存在的 id 抛出错误", () => {
    expect(() => {
      store.updateGitHubInfo("nonexistent-id", 456, "https://github.com/test/456");
    }).toThrow(/Feedback not found/);
  });
});

// ─── updateScreenshotUrl ───────────────────────────────────────────────────────

describe("feedbackStore.updateScreenshotUrl", () => {
  it("更新 screenshotUrl", () => {
    const { id } = addFeedback({ title: "Test" });
    store.updateScreenshotUrl(id, "/uploads/feedback/new-screenshot.png");

    const record = store.getById(id);
    expect(record.screenshotUrl).toBe("/uploads/feedback/new-screenshot.png");
  });

  it("更新后 updatedAt 变化", () => {
    const { id } = addFeedback({ title: "Test" });
    const original = store.getById(id);
    const originalUpdatedAt = original.updatedAt;

    return new Promise(r => setTimeout(r, 2)).then(() => {
      store.updateScreenshotUrl(id, "/uploads/feedback/new.png");
      const updated = store.getById(id);
      expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  it("不存在的 id 抛出错误", () => {
    expect(() => {
      store.updateScreenshotUrl("nonexistent-id", "/uploads/feedback/test.png");
    }).toThrow(/Feedback not found/);
  });
});

// ─── getScreenshotPath ────────────────────────────────────────────────────────

describe("feedbackStore.getScreenshotPath", () => {
  it("返回正确的绝对路径", () => {
    const filename = "test-screenshot.png";
    const expectedPath = path.join(DATA_DIR, "uploads", "feedback", filename);
    const result = store.getScreenshotPath(filename);
    expect(result).toBe(expectedPath);
  });
});

// ─── rowToRecord 转换 ────────────────────────────────────────────────────────

describe("rowToRecord 转换（snake_case → camelCase）", () => {
  it("所有字段正确转换", () => {
    const { id } = addFeedback({
      title: "Conversion Test",
      type: "bug",
      description: "Test description",
      screenshotUrl: "/uploads/feedback/test.png",
      submittedBy: "admin1",
    });
    store.updateGitHubInfo(id, 789, "https://github.com/test/789");
    store.updateStatus(id, "resolved", "closed");

    const record = store.getById(id);
    expect(record).toEqual({
      id: expect.any(String),
      githubIssueId: 789,
      githubIssueUrl: "https://github.com/test/789",
      githubIssueState: "closed",
      title: "Conversion Test",
      type: "bug",
      description: "Test description",
      screenshotUrl: "/uploads/feedback/test.png",
      submittedBy: "admin1",
      submittedAt: expect.any(Number),
      status: "resolved",
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
  });

  it("null 值正确处理", () => {
    const { id } = addFeedback({ screenshotUrl: null });
    const record = store.getById(id);
    expect(record.screenshotUrl).toBeNull();
    expect(record.githubIssueId).toBeNull();
    expect(record.githubIssueUrl).toBeNull();
  });
});
