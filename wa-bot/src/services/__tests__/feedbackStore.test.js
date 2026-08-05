"use strict";

/**
 * feedbackStore.test.js — feedbackStore data layer unit test
 *
 * Test strategy:
 *  - Use temporary SQLite database (better-sqlite3)
 *  - Clear the feedback table before each test
 *  - Validate all CRUD operations and edge cases
 */

const os = require("os");
const fs = require("fs");
const path = require("path");

// DATA_DIR is set at the module level and must be valid before require
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "test-feedback-store-"));
process.env.DATA_DIR = DATA_DIR;

// Reset the db singleton, making sure to use the current DATA_DIR
const dbModule = require("../../db");
dbModule._reset();

const store = require("../feedbackStore");

// ───Testing assistance─────────────────────────────────────────────────────────────

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
  // Clear feedback table
  dbModule.db.prepare("DELETE FROM feedback").run();
});

afterAll(() => {
  dbModule.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

// ─── create ────────────────────────────────────────────────────────────────────

describe("feedbackStore.create", () => {
  it("Return id after creating feedback", () => {
    const { id } = store.create(createFakeFeedback());
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("Created feedback can be found in the database", () => {
    const { id } = store.create(createFakeFeedback());
    const record = store.getById(id);
    expect(record).not.toBeNull();
    expect(record.id).toBe(id);
  });

  it("title saved correctly", () => {
    const { id } = store.create(createFakeFeedback({ title: "Bug in receipt page" }));
    const record = store.getById(id);
    expect(record.title).toBe("Bug in receipt page");
  });

  it("type is saved correctly (bug)", () => {
    const { id } = store.create(createFakeFeedback({ type: "bug" }));
    const record = store.getById(id);
    expect(record.type).toBe("bug");
  });

  it("type is saved correctly (improvement)", () => {
    const { id } = store.create(createFakeFeedback({ type: "improvement" }));
    const record = store.getById(id);
    expect(record.type).toBe("improvement");
  });

  it("description saved correctly", () => {
    const desc = "When clicking on Receipts tab, page shows 500 error";
    const { id } = store.create(createFakeFeedback({ description: desc }));
    const record = store.getById(id);
    expect(record.description).toBe(desc);
  });

  it("Save correctly when screenshotUrl is null", () => {
    const { id } = store.create(createFakeFeedback({ screenshotUrl: null }));
    const record = store.getById(id);
    expect(record.screenshotUrl).toBeNull();
  });

  it("Save correctly when screenshotUrl has a value", () => {
    const url = "/uploads/feedback/test-123.png";
    const { id } = store.create(createFakeFeedback({ screenshotUrl: url }));
    const record = store.getById(id);
    expect(record.screenshotUrl).toBe(url);
  });

  it("submittedBy is saved correctly", () => {
    const { id } = store.create(createFakeFeedback({ submittedBy: "admin-kelvin" }));
    const record = store.getById(id);
    expect(record.submittedBy).toBe("admin-kelvin");
  });

  it("The initial status is open", () => {
    const { id } = store.create(createFakeFeedback());
    const record = store.getById(id);
    expect(record.status).toBe("open");
  });

  it("Initial github_issue_id is null", () => {
    const { id } = store.create(createFakeFeedback());
    const record = store.getById(id);
    expect(record.githubIssueId).toBeNull();
  });

  it("Initial github_issue_url is null", () => {
    const { id } = store.create(createFakeFeedback());
    const record = store.getById(id);
    expect(record.githubIssueUrl).toBeNull();
  });

  it("The initial github_issue_state is open", () => {
    const { id } = store.create(createFakeFeedback());
    const record = store.getById(id);
    expect(record.githubIssueState).toBe("open");
  });

  it("createdAt and updatedAt are automatically set", () => {
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
  it("Empty database returns empty array", () => {
    const result = store.getAll();
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("Returns a record", () => {
    addFeedback({ title: "Test 1" });
    const result = store.getAll();
    expect(result.items.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.items[0].title).toBe("Test 1");
  });

  it("Multiple records: sorted by submitted_at DESC", async () => {
    addFeedback({ title: "First" });
    await new Promise(r => setTimeout(r, 2));
    addFeedback({ title: "Second" });
    const result = store.getAll();
    expect(result.items.length).toBe(2);
    expect(result.items[0].title).toBe("Second");
    expect(result.items[1].title).toBe("First");
  });

  it("Filter: status=open returns only open status", () => {
    addFeedback({ title: "Open Feedback" });
    const resolvedId = addFeedback({ title: "Resolved Feedback" }).id;
    store.updateStatus(resolvedId, "resolved", "closed");

    const result = store.getAll({ status: "open" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].status).toBe("open");
  });

  it("Filter: status=resolved returns only resolved status", () => {
    addFeedback({ title: "Open Feedback" });
    const resolvedId = addFeedback({ title: "Resolved Feedback" }).id;
    store.updateStatus(resolvedId, "resolved", "closed");

    const result = store.getAll({ status: "resolved" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].status).toBe("resolved");
  });

  it("Filter: type=bug returns only bug types", () => {
    addFeedback({ title: "Bug Report", type: "bug" });
    addFeedback({ title: "Feature Request", type: "improvement" });

    const result = store.getAll({ type: "bug" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].type).toBe("bug");
  });

  it("Filter: type=improvement returns only improvement type", () => {
    addFeedback({ title: "Bug Report", type: "bug" });
    addFeedback({ title: "Feature Request", type: "improvement" });

    const result = store.getAll({ type: "improvement" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].type).toBe("improvement");
  });

  it("Search: q parameter search title", () => {
    addFeedback({ title: "Receipt page crash" });
    addFeedback({ title: "Export to Excel feature" });

    const result = store.getAll({ q: "receipt" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].title).toContain("Receipt");
  });

  it("Search: q parameter search description", () => {
    addFeedback({ title: "Bug 1", description: "The page crashes when filtering" });
    addFeedback({ title: "Bug 2", description: "Export feature needed" });

    const result = store.getAll({ q: "filtering" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].description).toContain("filtering");
  });

  it("Search for: q parameters are not case sensitive", () => {
    addFeedback({ title: "RECEIPT CRASH", description: "Page crashes" });

    const result = store.getAll({ q: "receipt" });
    expect(result.items.length).toBe(1);
  });

  it("Pagination: page=1, limit=2 Return to the first 2 items", async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 2));
      addFeedback({ title: `Feedback ${i}` });
    }

    const result = store.getAll({}, { page: 1, limit: 2 });
    expect(result.items.length).toBe(2);
    expect(result.total).toBe(5);
  });

  it("Pagination: page=3, limit=2 Return to item 5", async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 2));
      addFeedback({ title: `Feedback ${i}` });
    }

    const result = store.getAll({}, { page: 3, limit: 2 });
    expect(result.items.length).toBe(1);
    expect(result.total).toBe(5);
  });

  it("Combined filtering: status + type + q", () => {
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
  it("Empty database returns zero value", () => {
    const stats = store.getStats();
    expect(stats.total).toBe(0);
    expect(stats.open).toBe(0);
    expect(stats.resolved).toBe(0);
    expect(stats.inProgress).toBe(0);
  });

  it("An open feedback", () => {
    addFeedback({ title: "Open Feedback" });
    const stats = store.getStats();
    expect(stats.total).toBe(1);
    expect(stats.open).toBe(1);
    expect(stats.resolved).toBe(0);
  });

  it("A resolved feedback", () => {
    const { id } = addFeedback({ title: "Resolved Feedback" });
    store.updateStatus(id, "resolved", "closed");
    const stats = store.getStats();
    expect(stats.total).toBe(1);
    expect(stats.open).toBe(0);
    expect(stats.resolved).toBe(1);
  });

  it("mixed state", () => {
    addFeedback({ title: "Open 1" });
    addFeedback({ title: "Open 2" });
    const { id } = addFeedback({ title: "Resolved" });
    store.updateStatus(id, "resolved", "closed");

    const stats = store.getStats();
    expect(stats.total).toBe(3);
    expect(stats.open).toBe(2);
    expect(stats.resolved).toBe(1);
  });

  it("inProgress always returns 0 (not supported by MVP)", () => {
    const stats = store.getStats();
    expect(stats.inProgress).toBe(0);
  });
});

// ─── getById ──────────────────────────────────────────────────────────────────

describe("feedbackStore.getById", () => {
  it("Existing id returns record object", () => {
    const { id } = addFeedback({ title: "Test" });
    const record = store.getById(id);
    expect(record).not.toBeNull();
    expect(record.id).toBe(id);
    expect(record.title).toBe("Test");
  });

  it("Returns null for non-existent id", () => {
    const record = store.getById("nonexistent-uuid-0000");
    expect(record).toBeNull();
  });

  it("The returned object fields are complete", () => {
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
  it("Update status and githubIssueState", () => {
    const { id } = addFeedback({ title: "Test" });
    store.updateStatus(id, "resolved", "closed");

    const record = store.getById(id);
    expect(record.status).toBe("resolved");
    expect(record.githubIssueState).toBe("closed");
  });

  it("UpdatedAfter updatedAt changes", () => {
    const { id } = addFeedback({ title: "Test" });
    const original = store.getById(id);
    const originalUpdatedAt = original.updatedAt;

    // Wait at least 1ms to ensure the timestamps are different
    return new Promise(r => setTimeout(r, 2)).then(() => {
      store.updateStatus(id, "resolved", "closed");
      const updated = store.getById(id);
      expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  it("Non-existent id throws error", () => {
    expect(() => {
      store.updateStatus("nonexistent-id", "resolved", "closed");
    }).toThrow(/Feedback not found/);
  });
});

// ─── updateGitHubInfo ──────────────────────────────────────────────────────────

describe("feedbackStore.updateGitHubInfo", () => {
  it("Update githubIssueId and githubIssueUrl", () => {
    const { id } = addFeedback({ title: "Test" });
    store.updateGitHubInfo(id, 456, "https://github.com/test/456");

    const record = store.getById(id);
    expect(record.githubIssueId).toBe(456);
    expect(record.githubIssueUrl).toBe("https://github.com/test/456");
  });

  it("UpdatedAfter updatedAt changes", () => {
    const { id } = addFeedback({ title: "Test" });
    const original = store.getById(id);
    const originalUpdatedAt = original.updatedAt;

    return new Promise(r => setTimeout(r, 2)).then(() => {
      store.updateGitHubInfo(id, 456, "https://github.com/test/456");
      const updated = store.getById(id);
      expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  it("Non-existent id throws error", () => {
    expect(() => {
      store.updateGitHubInfo("nonexistent-id", 456, "https://github.com/test/456");
    }).toThrow(/Feedback not found/);
  });
});

// ─── updateScreenshotUrl ───────────────────────────────────────────────────────

describe("feedbackStore.updateScreenshotUrl", () => {
  it("Update screenshotUrl", () => {
    const { id } = addFeedback({ title: "Test" });
    store.updateScreenshotUrl(id, "/uploads/feedback/new-screenshot.png");

    const record = store.getById(id);
    expect(record.screenshotUrl).toBe("/uploads/feedback/new-screenshot.png");
  });

  it("UpdatedAfter updatedAt changes", () => {
    const { id } = addFeedback({ title: "Test" });
    const original = store.getById(id);
    const originalUpdatedAt = original.updatedAt;

    return new Promise(r => setTimeout(r, 2)).then(() => {
      store.updateScreenshotUrl(id, "/uploads/feedback/new.png");
      const updated = store.getById(id);
      expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  it("Non-existent id throws error", () => {
    expect(() => {
      store.updateScreenshotUrl("nonexistent-id", "/uploads/feedback/test.png");
    }).toThrow(/Feedback not found/);
  });
});

// ─── getScreenshotPath ────────────────────────────────────────────────────────

describe("feedbackStore.getScreenshotPath", () => {
  it("Returns the correct absolute path", () => {
    const filename = "test-screenshot.png";
    const expectedPath = path.join(DATA_DIR, "uploads", "feedback", filename);
    const result = store.getScreenshotPath(filename);
    expect(result).toBe(expectedPath);
  });
});

// ─── rowToRecord conversion ───────────────────────────────────────────────────

describe("rowToRecord conversion (snake_case → camelCase)", () => {
  it("All fields converted correctly", () => {
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

  it("null values are handled correctly", () => {
    const { id } = addFeedback({ screenshotUrl: null });
    const record = store.getById(id);
    expect(record.screenshotUrl).toBeNull();
    expect(record.githubIssueId).toBeNull();
    expect(record.githubIssueUrl).toBeNull();
  });
});
