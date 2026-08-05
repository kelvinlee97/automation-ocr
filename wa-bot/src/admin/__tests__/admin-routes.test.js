"use strict";

/**
 * Phase 3: admin panel routing integration test
 *
 * Test strategy:
 *  - Use supertest to initiate HTTP requests (no listen, zero port occupation)
 *  - express-session injects MemoryStore to avoid FileStore disk dependence
 *  - jest.mock replaces receiptStore, adminUserService, aiService, bot
 *  - The snapshot baseline drops key HTML fragments for equivalence verification after Phase 4 splitting
 */

const request = require("supertest");
const session = require("express-session");

// ── Mock all dependencies before require adminServer ──────────────────────────────

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
  isEmpty: jest.fn(() => false),    // Already have an account by default
  authenticate: jest.fn(() => false),
  isSuperAdmin: jest.fn(() => false),
  createUser: jest.fn(() => ({ ok: true })),
  listUsers: jest.fn(() => []),
  deleteUser: jest.fn(() => ({ ok: true })),
  resetPassword: jest.fn(() => ({ ok: true })),
}));

jest.mock("../../services/aiService", () => ({
  processReceipt: jest.fn(),
}));

// The bot module is dynamically required in the request-pairing-code route and needs to be mocked.
jest.mock("../../bot", () => ({
  requestPairingCode: jest.fn(),
}));

// The db module is used by adminUserService and receiptStore, and is mocked to prevent disk I/O.
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

// ── Tool: Construct an app with MemoryStore to avoid session-file-store disk dependency ─────────

function buildApp() {
  process.env.NODE_ENV = "test";
  // Clear the cache before each build to ensure that the module status is clean
  delete require.cache[require.resolve("../../adminServer")];
  const { _createApp } = require("../../adminServer");
  const memStore = new session.MemoryStore();
  return _createApp(memStore);
}

// ── Tool: embed authenticated session in MemoryStore and return cookie string ─────────────

async function getAuthCookie(app) {
  const adminUserService = require("../../services/adminUserService");
  adminUserService.authenticate.mockReturnValueOnce(true);

  const res = await request(app)
    .post("/admin/login")
    .send("username=admin&password=pass");

  const cookies = res.headers["set-cookie"];
  if (!cookies) throw new Error("Set-Cookie not received after logging in");
  // Get the first cookie (connect.sid)
  return Array.isArray(cookies) ? cookies[0].split(";")[0] : cookies.split(";")[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// test suite
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  test("Return 200 + JSON { status: ok }", async () => {
    const app = buildApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
    expect(res.body).toHaveProperty("whatsapp");
    expect(res.body).toHaveProperty("timestamp");
  });

  test("Returns 503 degraded when Bot initialization fails", async () => {
    const state = require("../state");
    state.setBotError("startup failed");
    const app = buildApp();
    const res = await request(app).get("/health");
    state.clearBotError();

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "degraded", whatsapp: "error" });
  });
});

describe("GET /admin not logged in", () => {
  test("302 redirect to /admin/login", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });
});

describe("POST /admin/setup (first account creation)", () => {
  test("Create user when DB is empty and 302 to /admin/login", async () => {
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

  test("When DB already has an account, 302 go to /admin/login (no repeated settings)", async () => {
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
  test("Correct credentials → 302 to /admin, session written", async () => {
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

  test("Wrong credentials → 200 Return to login page (including error message)", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.authenticate.mockReturnValueOnce(false);

    const app = buildApp();
    const res = await request(app)
      .post("/admin/login")
      .send("username=admin&password=wrong");

    expect(res.status).toBe(200);
    // The page contains an English error message.
    expect(res.text).toMatch(/Invalid username or password|login_error/i);
  });
});

describe("POST /admin/logout", () => {
  test("302 to /admin/login after logging out", async () => {
    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post("/admin/logout")
      .set("Cookie", cookie);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });
});

describe("GET /admin/qr (WhatsApp is not connected)", () => {
  test("Return 200, the page contains QR/pairing code related content", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/qr");
    expect(res.status).toBe(200);
    // The QR page contains tab or matching code related text
    expect(res.text.toLowerCase()).toMatch(/qr|pairing/);
  });
});

describe("GET /admin/wa-status", () => {
  test("Return JSON { connected, hasQR }", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/wa-status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("connected");
    expect(res.body).toHaveProperty("hasQR");
  });
});

describe("POST /admin/request-pairing-code", () => {
  test("Illegal mobile phone number → 400", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/admin/request-pairing-code")
      .send("phone=123");  // Too short for 10-15 characters

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("POST /admin/receipts/:id/ai-extract", () => {
  test("Non-existent ID → 404", async () => {
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
  test("302 to /admin after rejection (database status change)", async () => {
    const receiptStore = require("../../services/receiptStore");
    receiptStore.rejectReceipt.mockReturnValueOnce(undefined);

    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post("/admin/receipts/test-id-123/reject")
      .set("Cookie", cookie)
      .send("note=test rejected");

    expect(res.status).toBe(302);
    expect(receiptStore.rejectReceipt).toHaveBeenCalledWith("test-id-123", "test rejected");
  });
});

describe("POST /admin/receipts/:id/send-message (_client=null)", () => {
  test("When WhatsApp is not connected → 503", async () => {
    const app = buildApp();
    const cookie = await getAuthCookie(app);
    // _client defaults to null (setClient is not called), triggering 503 directly.
    const res = await request(app)
      .post("/admin/receipts/test-id/send-message")
      .set("Cookie", cookie)
      .send("message=hello");

    expect(res.status).toBe(503);
  });
});

describe("GET /admin/export Not logged in", () => {
  test("302 redirect (cannot download without logging in)", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/export");
    expect(res.status).toBe(302);
  });
});

describe("GET /admin/images/:filename", () => {
  test("Non-existent image → 404", async () => {
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

describe("GET /admin (logged in)", () => {
  test("Returns HTTP 200 with the receipt list page", async () => {
    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .get("/admin")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Receipt Review");
  });

  test("Support search query parameters", async () => {
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

describe("GET /admin/setup (when there is no account)", () => {
  test("Returns HTTP 200 with the setup page", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.isEmpty.mockReturnValue(true);

    const app = buildApp();
    const res = await request(app).get("/admin/setup");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/setup|first time/i);
  });

  test("When you already have an account 302 Go to the login page", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.isEmpty.mockReturnValue(false);

    const app = buildApp();
    const res = await request(app).get("/admin/setup");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });
});

describe("GET /admin/users (permission level)", () => {
  test("Ordinary administrator returns 403", async () => {
    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .get("/admin/users")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  test("Super Admin receives the user management page with HTTP 200", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.isSuperAdmin.mockReturnValueOnce(true);
    adminUserService.listUsers.mockReturnValueOnce([]);

    const app = buildApp();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .get("/admin/users")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("User Management");
  });
});

describe("GET /admin/receipts", () => {
  test("Redirect to /admin (backward compatibility)", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/receipts");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin/);
  });
});

describe("GET / root path", () => {
  test("If you already have an account and are not logged in, jump to /admin/login", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.isEmpty.mockReturnValue(false);

    const app = buildApp();
    const res = await request(app).get("/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });

  test("Jump to /admin/setup when there is no account", async () => {
    const adminUserService = require("../../services/adminUserService");
    adminUserService.isEmpty.mockReturnValue(true);

    const app = buildApp();
    const res = await request(app).get("/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/setup/);
  });
});

// ──Snapshot baseline (for equivalence verification after Phase 4 split)──────────────────────────────────

describe("HTML snapshot baseline", () => {
  let mod;

  beforeAll(() => {
    process.env.NODE_ENV = "test";
    delete require.cache[require.resolve("../../adminServer")];
    mod = require("../../adminServer");
  });

  test("receiptsPage - empty list contains empty hint (no table)", () => {
    const html = mod._receiptsPage([], "en");
    // Empty state rendering empty div, without table
    expect(html).toContain("empty");
    expect(html).toContain("Receipt Review");
    expect(html.match(/<title>[^<]+<\/title>/)?.[0]).toMatchSnapshot("receiptsPage title");
  });

  test("receiptsPage - contains key elements (badge, table) when there is data", () => {
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
    const html = mod._receiptsPage(fakeReceipts, "en");
    expect(html).toContain("badge-pending_review");
    expect(html).toContain("<table");
    expect(html.match(/class="badge[^"]*"/g)?.slice(0, 5)).toMatchSnapshot("receiptsPage badge classes");
  });

  test("usersPage - contains key elements of user management", () => {
    const html = mod._usersPage([], "admin", "", "en");
    expect(html).toContain("User Management");
    expect(html.match(/<title>[^<]+<\/title>/)?.[0]).toMatchSnapshot("usersPage title");
  });

  test("qrPage - Contains key QR related elements", () => {
    const html = mod._qrPage("en");
    expect(html.toLowerCase()).toMatch(/qr|pairing/);
    expect(html.match(/<title>[^<]+<\/title>/)?.[0]).toMatchSnapshot("qrPage title");
  });
});
