"use strict";

/**
 * feedback-routes.test.js — Feedback 路由单元测试
 */

const request = require("supertest");
const session = require("express-session");

// These tests always inject MemoryStore. Avoid reloading FileStore and other
// export-only dependencies on every reset because their transitive modules
// register process exit listeners.
jest.mock("session-file-store", () => () => class TestFileStore {});

// Mock 工厂函数
function createMocks() {
  return {
    adminUserService: {
      isEmpty: jest.fn(() => false),
      authenticate: jest.fn(() => false),
      createUser: jest.fn(() => ({ ok: true })),
      listUsers: jest.fn(() => []),
      deleteUser: jest.fn(() => ({ ok: true })),
      resetPassword: jest.fn(() => ({ ok: true })),
    },
    feedbackStore: {
      init: jest.fn(),
      create: jest.fn(() => ({ id: "test-feedback-id-123" })),
      getAll: jest.fn(() => ({ items: [], total: 0 })),
      getStats: jest.fn(() => ({ total: 0, open: 0, resolved: 0 })),
      getById: jest.fn(() => null),
      updateStatus: jest.fn(),
      updateGitHubInfo: jest.fn(),
      updateScreenshotUrl: jest.fn(),
      getScreenshotPath: jest.fn((filename) => `/fake/data/uploads/feedback/${filename}`),
    },
    githubService: {
      createIssue: jest.fn(),
      getIssue: jest.fn(),
      syncIssueStatus: jest.fn(),
    },
    excelService: {
      getExcelPath: jest.fn(() => "/fake/export.xlsx"),
    },
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
    i18n: {
      getLang: jest.fn(() => "zh"),
      t: jest.fn((key) => {
        const translations = {
          load_fail: "加载失败：",
          feedback_required_fields: "请填写所有必填字段",
          feedback_title_too_long: "标题过长（最多 200 字符）",
          feedback_description_too_long: "描述过长（最多 5000 字符）",
          feedback_invalid_type: "反馈类型无效",
          feedback_submit_fail: "提交失败：",
          feedback_not_found: "反馈不存在",
          feedback_no_github_issue: "该反馈未关联 GitHub Issue",
          feedback_upload_fail: "上传失败：",
          feedback_no_file: "未收到文件",
          feedback_screenshot_not_found: "截图不存在",
        };
        return translations[key] || key;
      }),
    },
    bot: {
      requestPairingCode: jest.fn(),
    },
    db: {
      init: jest.fn(),
      db: {
        prepare: jest.fn(() => ({
          get: jest.fn(() => ({ cnt: 1 })),
          run: jest.fn(),
          all: jest.fn(() => []),
        })),
        exec: jest.fn(),
      },
    },
  };
}

let mocks;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mocks = createMocks();
  
  jest.doMock("../../services/adminUserService", () => mocks.adminUserService);
  jest.doMock("../../services/feedbackStore", () => mocks.feedbackStore);
  jest.doMock("../../services/githubService", () => mocks.githubService);
  jest.doMock("../../services/excelService", () => mocks.excelService);
  jest.doMock("../../utils/logger", () => mocks.logger);
  jest.doMock("../i18n", () => mocks.i18n);
  jest.doMock("../../bot", () => mocks.bot);
  jest.doMock("../../db", () => mocks.db);
  
  // Mock views
  jest.doMock("../views/feedback-list", () => ({
    feedbackListPage: () => "<html>feedback_list</html>"
  }));
  jest.doMock("../views/feedback-form", () => ({
    feedbackFormPage: () => "<html>feedback_form</html>"
  }));
  jest.doMock("../views/feedback-detail", () => ({
    feedbackDetailPage: () => "<html>feedback_detail</html>"
  }));
});

function buildApp() {
  process.env.NODE_ENV = "test";
  const { _createApp } = require("../../adminServer");
  const memStore = new session.MemoryStore();
  return _createApp(memStore);
}

async function getAuthCookie(app) {
  mocks.adminUserService.authenticate.mockReturnValueOnce(true);
  const res = await request(app)
    .post("/admin/login")
    .send("username=admin&password=pass");
  const cookies = res.headers["set-cookie"];
  if (!cookies) throw new Error("登录后未收到 Set-Cookie");
  return Array.isArray(cookies) ? cookies[0].split(";")[0] : cookies.split(";")[0];
}

// ── 测试套件 ─────────────────────────────────────────────────────────────────────

describe("Feedback Routes - GET /admin/feedback", () => {
  it("未登录时 302 重定向到 /admin/login", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/feedback");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });

  it("已登录时返回 200", async () => {
    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .get("/admin/feedback")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
  });
});

describe("Feedback Routes - GET /admin/feedback/new", () => {
  it("未登录时 302 重定向", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/feedback/new");
    expect(res.status).toBe(302);
  });

  it("已登录时返回 200", async () => {
    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .get("/admin/feedback/new")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
  });
});

describe("Feedback Routes - POST /admin/feedback", () => {
  it("未登录时 302 重定向", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/admin/feedback")
      .send("title=Test&type=bug&description=Test desc");
    expect(res.status).toBe(302);
  });

  it("缺少 title 时返回 400", async () => {
    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post("/admin/feedback")
      .set("Cookie", cookie)
      .send("type=bug&description=Test desc");
    expect(res.status).toBe(400);
  });
});

describe("Feedback Routes - GET /admin/feedback/:id", () => {
  it("未登录时 302 重定向", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/feedback/test-id");
    expect(res.status).toBe(302);
  });

  it("已登录且反馈存在时返回 200", async () => {
    mocks.feedbackStore.getById.mockReturnValueOnce({
      id: "test-id",
      title: "Test",
      type: "bug",
      description: "Test",
      status: "open",
      submittedBy: "admin",
      submittedAt: Date.now(),
    });
    
    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .get("/admin/feedback/test-id")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
  });
});

describe("Feedback Routes - POST /admin/feedback/:id/sync", () => {
  it("未登录时 302 重定向到 /admin/login", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/admin/feedback/test-id/sync");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });
});

describe("Feedback Routes - POST /admin/feedback/:id/screenshot", () => {
  it("未登录时 302 重定向到 /admin/login", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/admin/feedback/test-id/screenshot");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });
});

describe("Feedback Routes - GET /admin/uploads/feedback/:filename", () => {
  it("未登录时 302 重定向", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/uploads/feedback/test.png");
    expect(res.status).toBe(302);
  });
});
