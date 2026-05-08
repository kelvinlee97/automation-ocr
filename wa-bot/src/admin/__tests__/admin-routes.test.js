"use strict";

/**
 * Phase 3：管理后台路由集成测试
 *
 * 测试策略：
 *  - 使用 supertest 发起 HTTP 请求（不 listen，零端口占用）
 *  - express-session 注入 MemoryStore，避免 FileStore 磁盘依赖
 *  - jest.mock 替代 receiptStore、adminUserService、aiService、bot
 *  - 快照基线落关键 HTML 片段，供 Phase 4 拆分后等价性校验
 */

const request = require("supertest");
const session = require("express-session");

// ── 在 require adminServer 之前先 mock 所有依赖 ──────────────────────────────

jest.mock("../../services/receiptStore", () => ({
  init: jest.fn(),
  getAll: jest.fn(() => []),
  getById: jest.fn(() => null),
  getImagePath: jest.fn((filename) => `/fake/data/images/${filename}`),
  addPendingReceipt: jest.fn(),
  saveAiResult: jest.fn(),
  confirmReceipt: jest.fn(),
  rejectReceipt: jest.fn(),
  sendMessageToUser: jest.fn(),
}));

jest.mock("../../services/adminUserService", () => ({
  isEmpty: jest.fn(() => false),    // 默认已有账户
  authenticate: jest.fn(() => false),
  createUser: jest.fn(() => ({ ok: true })),
  listUsers: jest.fn(() => []),
  deleteUser: jest.fn(() => ({ ok: true })),
  resetPassword: jest.fn(() => ({ ok: true })),
}));

jest.mock("../../services/aiService", () => ({
  processReceipt: jest.fn(),
}));

// bot 模块在 request-pairing-code 路由中动态 require，需 mock 掉
jest.mock("../../bot", () => ({
  requestPairingCode: jest.fn(),
}));

// db 模块供 adminUserService、receiptStore 使用，mock 掉防止磁盘 I/O
jest.mock("../../db", () => ({
  init: jest.fn(),
  db: {
    prepare: jest.fn(() => ({
      get: jest.fn(() => ({ cnt: 1 })),
      run: jest.fn(),
      all: jest.fn(() => []),
    })),
    exec: jest.fn(),
  },
}));

// ── 工具：构造带 MemoryStore 的 app，避免 session-file-store 磁盘依赖 ─────────

function buildApp() {
  process.env.NODE_ENV = "test";
  // 每次 build 前清除缓存，保证模块状态干净
  delete require.cache[require.resolve("../../adminServer")];
  const { _createApp } = require("../../adminServer");
  const memStore = new session.MemoryStore();
  return _createApp(memStore);
}

// ── 工具：在 MemoryStore 中植入已认证 session，返回 cookie 字符串 ─────────────

async function getAuthCookie(app) {
  const adminUserService = require("../../services/adminUserService");
  adminUserService.authenticate.mockReturnValueOnce(true);

  const res = await request(app)
    .post("/admin/login")
    .send("username=admin&password=pass");

  const cookies = res.headers["set-cookie"];
  if (!cookies) throw new Error("登录后未收到 Set-Cookie");
  // 取第一个 cookie（connect.sid）
  return Array.isArray(cookies) ? cookies[0].split(";")[0] : cookies.split(";")[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// 测试套件
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  test("返回 200 + JSON { status: ok }", async () => {
    const app = buildApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
    expect(res.body).toHaveProperty("whatsapp");
    expect(res.body).toHaveProperty("timestamp");
  });
});

describe("GET /admin 未登录", () => {
  test("302 重定向到 /admin/login", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });
});

describe("POST /admin/setup（首次建号）", () => {
  test("DB 为空时创建用户并 302 到 /admin/login", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.isEmpty
      .mockReturnValueOnce(true)   // GET setup guard
      .mockReturnValueOnce(true);  // POST setup guard
    adminUserService.createUser.mockReturnValueOnce({ ok: true });

    const app = buildApp();
    const res = await request(app)
      .post("/admin/setup")
      .send("username=admin&password=secret&confirm=secret");

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });

  test("DB 已有账户时 302 到 /admin/login（不重复设置）", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.isEmpty.mockReturnValue(false);

    const app = buildApp();
    const res = await request(app)
      .post("/admin/setup")
      .send("username=admin&password=secret&confirm=secret");

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });
});

describe("POST /admin/login", () => {
  test("正确凭证 → 302 到 /admin，session 已写入", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.authenticate.mockReturnValueOnce(true);

    const app = buildApp();
    const res = await request(app)
      .post("/admin/login")
      .send("username=admin&password=correct");

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin$/);
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  test("错误凭证 → 200 返回登录页（含错误提示）", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.authenticate.mockReturnValueOnce(false);

    const app = buildApp();
    const res = await request(app)
      .post("/admin/login")
      .send("username=admin&password=wrong");

    expect(res.status).toBe(200);
    // 页面中包含错误信息（中文界面）
    expect(res.text).toMatch(/用户名或密码错误|login_error/i);
  });
});

describe("POST /admin/logout", () => {
  test("登出后 302 到 /admin/login", async () => {
    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post("/admin/logout")
      .set("Cookie", cookie);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });
});

describe("GET /admin/qr（WhatsApp 未连接）", () => {
  test("返回 200，页面包含 QR / 配对码相关内容", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/qr");
    expect(res.status).toBe(200);
    // QR 页面包含 tab 或配对码相关文本
    expect(res.text.toLowerCase()).toMatch(/qr|pairing|配对|扫码/);
  });
});

describe("GET /admin/wa-status", () => {
  test("返回 JSON { connected, hasQR }", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/wa-status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("connected");
    expect(res.body).toHaveProperty("hasQR");
  });
});

describe("POST /admin/request-pairing-code", () => {
  test("非法手机号 → 400", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/admin/request-pairing-code")
      .send("phone=123");  // 太短，不符合 10-15 位

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("POST /admin/receipts/:id/ai-extract", () => {
  test("不存在的 ID → 404", async () => {
    const receiptStore = require("../../services/receiptStore");
    receiptStore.getById.mockReturnValueOnce(null);

    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post("/admin/receipts/nonexistent-id/ai-extract")
      .set("Cookie", cookie);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});

describe("POST /admin/receipts/:id/reject", () => {
  test("拒绝后 302 到 /admin（数据库状态变化）", async () => {
    const receiptStore = require("../../services/receiptStore");
    receiptStore.rejectReceipt.mockReturnValueOnce(undefined);

    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post("/admin/receipts/test-id-123/reject")
      .set("Cookie", cookie)
      .send("note=测试拒绝");

    expect(res.status).toBe(302);
    expect(receiptStore.rejectReceipt).toHaveBeenCalledWith("test-id-123", "测试拒绝");
  });
});

describe("POST /admin/receipts/:id/send-message（_client=null）", () => {
  test("WhatsApp 未连接时 → 503", async () => {
    const app = buildApp();
    const cookie = await getAuthCookie(app);
    // _client 默认为 null（未调用 setClient），直接触发 503
    const res = await request(app)
      .post("/admin/receipts/test-id/send-message")
      .set("Cookie", cookie)
      .send("message=hello");

    expect(res.status).toBe(503);
  });
});

describe("GET /admin/export 未登录", () => {
  test("302 重定向（未登录无法下载）", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/export");
    expect(res.status).toBe(302);
  });
});

describe("GET /admin/images/:filename", () => {
  test("不存在的图片 → 404", async () => {
    const receiptStore = require("../../services/receiptStore");
    receiptStore.getImagePath.mockReturnValueOnce("/nonexistent/path/fake.jpg");

    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .get("/admin/images/nonexistent.jpg")
      .set("Cookie", cookie);

    expect(res.status).toBe(404);
  });
});

describe("GET /admin（已登录）", () => {
  test("返回 200 收据列表页", async () => {
    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .get("/admin")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("收据审核");
  });

  test("支持搜索查询参数", async () => {
    const receiptStore = require("../../services/receiptStore");
    receiptStore.getAll.mockReturnValueOnce([]);

    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .get("/admin?q=test&status=pending_review")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
  });
});

describe("GET /admin/setup（无账户时）", () => {
  test("返回 200 设置页面", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.isEmpty.mockReturnValue(true);

    const app = buildApp();
    const res = await request(app).get("/admin/setup");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/setup|设置|首次/i);
  });

  test("已有账户时 302 到登录页", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.isEmpty.mockReturnValue(false);

    const app = buildApp();
    const res = await request(app).get("/admin/setup");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });
});

describe("GET /admin/users（已登录）", () => {
  test("返回 200 用户管理页", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.listUsers.mockReturnValueOnce([]);

    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .get("/admin/users")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("用户管理");
  });
});

describe("GET /admin/receipts", () => {
  test("重定向到 /admin（向后兼容）", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/receipts");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin/);
  });
});

describe("GET / 根路径", () => {
  test("已有账户、未登录时跳转到 /admin/login", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.isEmpty.mockReturnValue(false);

    const app = buildApp();
    const res = await request(app).get("/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });

  test("无账户时跳转到 /admin/setup", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.isEmpty.mockReturnValue(true);

    const app = buildApp();
    const res = await request(app).get("/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/setup/);
  });
});

// ── 快照基线（供 Phase 4 拆分后等价性校验）──────────────────────────────────

describe("HTML 快照基线", () => {
  let mod;

  beforeAll(() => {
    process.env.NODE_ENV = "test";
    delete require.cache[require.resolve("../../adminServer")];
    mod = require("../../adminServer");
  });

  test("receiptsPage - 空列表包含 empty 提示（无 table）", () => {
    const html = mod._receiptsPage([], "zh");
    // 空状态渲染 empty div，不含 table
    expect(html).toContain("empty");
    expect(html).toContain("收据审核");
    expect(html.match(/<title>[^<]+<\/title>/)?.[0]).toMatchSnapshot("receiptsPage title");
  });

  test("receiptsPage - 有数据时含关键元素（badge、table）", () => {
    const fakeReceipts = [
      {
        id: "1",
        phone: "60123456789",
        ic: "010101-01-0001",
        imageFilename: "test.jpg",
        status: "pending_review",
        submittedAt: new Date().toISOString(),
        aiResult: null,
        reviewedAt: null,
        reviewNote: null,
        sentMessage: null,
        sentAt: null,
        previousStatus: null,
      },
    ];
    const html = mod._receiptsPage(fakeReceipts, "zh");
    expect(html).toContain("badge-pending_review");
    expect(html).toContain("<table");
    expect(html.match(/class="badge[^"]*"/g)?.slice(0, 5)).toMatchSnapshot("receiptsPage badge classes");
  });

  test("usersPage - 包含用户管理关键元素", () => {
    const html = mod._usersPage([], "admin", "", "zh");
    expect(html).toContain("用户管理");
    expect(html.match(/<title>[^<]+<\/title>/)?.[0]).toMatchSnapshot("usersPage title");
  });

  test("qrPage - 包含 QR 相关关键元素", () => {
    const html = mod._qrPage("zh");
    expect(html.toLowerCase()).toMatch(/qr|扫码|配对/);
    expect(html.match(/<title>[^<]+<\/title>/)?.[0]).toMatchSnapshot("qrPage title");
  });
});
