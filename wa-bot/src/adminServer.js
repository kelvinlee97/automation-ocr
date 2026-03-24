/**
 * 管理后台 Express 服务器
 * 与 Bot 同进程运行，通过 setClient()/setQR() 注入 WhatsApp 状态
 * 端口：3000（docker-compose 映射到宿主机 80）
 *
 * 单一界面设计：只保留收据审核页，人工主动发消息给用户
 */

const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { getExcelPath } = require("./services/excelService");
const receiptStore = require("./services/receiptStore");
const { processReceipt } = require("./services/aiService");
const logger = require("./utils/logger");

const ADMIN_PORT = 3000;

// ─── 模块级状态（通过 setClient/setQR 注入，无需传参） ─────────────────────────

let _client = null;
let _qrBase64 = null;    // QR 码 data URI（base64 PNG）
let _waConnected = false;

/**
 * Bot 就绪后注入 client 实例
 * 同时清空 QR（连接后不再需要）
 */
function setClient(client) {
  _client = client;
  _waConnected = true;
  _qrBase64 = null;
  logger.info("WhatsApp client 已注入管理后台");
}

/**
 * QR 码刷新时注入新的 base64 data URI
 */
function setQR(base64DataUri) {
  _qrBase64 = base64DataUri;
  _waConnected = false;
}

// ─── 认证凭据 ──────────────────────────────────────────────────────────────────

function getAdminCredentials() {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!user || !pass) {
    throw new Error(
      "缺少必要环境变量 ADMIN_USER / ADMIN_PASS，请在 .env 或 docker-compose.yml 中配置"
    );
  }
  return { user, pass };
}

// ─── 认证中间件 ────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect("/admin/login");
}

// ─── HTML 骨架 ─────────────────────────────────────────────────────────────────

function htmlLayout(title, content) {
  // 根据当前连接状态动态渲染导航栏徽标
  const statusBadge = _waConnected
    ? '<span style="color:#86efac;font-size:12px">🟢 已连接</span>'
    : '<a href="/admin/qr" style="color:#fca5a5;font-size:12px;text-decoration:none">🔴 未连接</a>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — 管理后台</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #f5f7fa; color: #1a1a2e; }
    nav { background: #1a1a2e; color: #fff; padding: 0 24px;
          display: flex; align-items: center; justify-content: space-between; height: 52px; }
    nav a { color: #a8b8d8; text-decoration: none; margin-left: 20px; font-size: 14px; }
    nav a:hover { color: #fff; }
    nav .brand { font-weight: 700; font-size: 16px; color: #fff; letter-spacing: .5px; }
    nav .nav-right { display: flex; align-items: center; gap: 8px; }
    main { max-width: 1400px; margin: 32px auto; padding: 0 24px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; background: #fff;
            border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    th { background: #f0f4ff; color: #3a4a6b; font-size: 12px; text-transform: uppercase;
         padding: 10px 14px; text-align: left; letter-spacing: .5px; }
    td { padding: 10px 14px; border-bottom: 1px solid #f0f0f0; font-size: 13px; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafbff; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px;
             font-size: 11px; font-weight: 600; letter-spacing: .3px; }
    .badge-pending_review { background: #fff8e1; color: #b45309; }
    .badge-ai_extracted  { background: #eff6ff; color: #1d4ed8; }
    .badge-confirmed     { background: #e6f9f0; color: #1a7f4e; }
    .badge-rejected      { background: #fff0f0; color: #c0392b; }
    .btn { display: inline-block; padding: 5px 12px; border-radius: 6px; font-size: 12px;
           font-weight: 600; cursor: pointer; border: none; text-decoration: none;
           transition: opacity .15s; }
    .btn:hover { opacity: .82; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-ai      { background: #6366f1; color: #fff; }
    .btn-send    { background: #10b981; color: #fff; }
    .btn-reject  { background: #dc3545; color: #fff; }
    .btn-reject:hover { background: #c82333; }
    .btn-logout  { background: transparent; color: #a8b8d8; border: 1px solid #3a4a6b; }
    .reject-form { margin-top: 6px; display: flex; gap: 6px; align-items: center; }
    .reject-form input { flex: 1; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; }
    .reject-note { color: #dc3545; font-size: 12px; margin-bottom: 2px; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    form.inline { display: inline; }
    .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
    .empty { text-align: center; padding: 40px; color: #888; font-size: 14px; }
    .thumb { width: 56px; height: 56px; object-fit: cover; border-radius: 6px;
             cursor: pointer; border: 1px solid #e0e0e0; transition: transform .15s; }
    .thumb:hover { transform: scale(1.08); }
    /* 图片灯箱 */
    #lightbox { display:none; position:fixed; inset:0; background:rgba(0,0,0,.75);
                z-index:999; align-items:center; justify-content:center; }
    #lightbox.active { display:flex; }
    #lightbox img { max-width:90vw; max-height:90vh; border-radius:8px;
                    box-shadow:0 8px 40px rgba(0,0,0,.5); }
    #lightbox-close { position:absolute; top:20px; right:28px; font-size:32px;
                      color:#fff; cursor:pointer; line-height:1; }
    /* AI 结果展示 */
    .ai-result { font-size: 12px; color: #374151; line-height: 1.6; }
    .ai-result strong { color: #1a1a2e; }
    /* 发送消息表单 */
    .send-form { display: flex; gap: 6px; align-items: flex-start; flex-direction: column; }
    .send-form textarea {
      width: 200px; font-size: 12px; padding: 6px 8px;
      border: 1px solid #ddd; border-radius: 4px; resize: vertical;
      min-height: 52px; font-family: inherit;
    }
    .send-form textarea:focus { outline: none; border-color: #10b981; }
    /* 已发送记录 */
    .sent-record { font-size: 11px; color: #555; line-height: 1.5; }
    .sent-record .sent-msg { background: #f0fdf4; border-left: 3px solid #10b981;
                              padding: 4px 8px; border-radius: 0 4px 4px 0; margin-bottom: 4px;
                              white-space: pre-wrap; word-break: break-word; }
    .sent-record .sent-time { color: #aaa; font-size: 10px; }
  </style>
</head>
<body>
  <nav>
    <span class="brand">⚙ 管理后台</span>
    <div class="nav-right">
      ${statusBadge}
      <a href="/admin/export">⬇ 下载 Excel</a>
      <form class="inline" method="POST" action="/admin/logout">
        <button class="btn btn-logout" style="margin-left:12px">退出</button>
      </form>
    </div>
  </nav>
  <main>
    <h1>${title}</h1>
    ${content}
  </main>
  <!-- 图片灯箱 -->
  <div id="lightbox">
    <span id="lightbox-close" onclick="closeLightbox()">✕</span>
    <img id="lightbox-img" src="" alt="收据大图" />
  </div>
  <script>
    function openLightbox(src) {
      document.getElementById('lightbox-img').src = src;
      document.getElementById('lightbox').classList.add('active');
    }
    function closeLightbox() {
      document.getElementById('lightbox').classList.remove('active');
    }
    // 点击背景关闭灯箱
    document.getElementById('lightbox').addEventListener('click', function(e) {
      if (e.target === this) closeLightbox();
    });
  </script>
</body>
</html>`;
}

// ─── 登录页 ────────────────────────────────────────────────────────────────────

function loginPage(errorMsg = "") {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>登录 — 管理后台</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #f5f7fa;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; padding: 40px;
            box-shadow: 0 4px 20px rgba(0,0,0,.10); width: 360px; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 28px; text-align: center; color: #1a1a2e; }
    label { display: block; font-size: 13px; color: #555; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px;
            font-size: 14px; margin-bottom: 16px; outline: none; }
    input:focus { border-color: #3b82f6; }
    button { width: 100%; padding: 11px; background: #1a1a2e; color: #fff;
             border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; }
    button:hover { opacity: .88; }
    .error { color: #c0392b; font-size: 13px; margin-bottom: 14px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔐 管理后台登录</h1>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ""}
    <form method="POST" action="/admin/login">
      <label>用户名</label>
      <input type="text" name="username" required autofocus />
      <label>密码</label>
      <input type="password" name="password" required />
      <button type="submit">登 录</button>
    </form>
  </div>
</body>
</html>`;
}

// ─── QR 码页（无需登录，供初始化时扫码用） ────────────────────────────────────

function qrPage() {
  // 已连接则直接跳转，无需渲染页面
  if (_waConnected) {
    return null; // 调用方 302 跳转
  }

  const qrContent = _qrBase64
    ? `<img src="${_qrBase64}" alt="WhatsApp QR 码"
            style="width:220px;height:220px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.15)" />`
    : `<div style="width:220px;height:220px;background:#f0f4ff;border-radius:8px;
                   display:flex;align-items:center;justify-content:center;
                   color:#888;font-size:14px;text-align:center;padding:20px">
         正在初始化，请稍候…
       </div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>扫码登录 — 管理后台</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #f5f7fa; color: #1a1a2e; }
    nav { background: #1a1a2e; color: #fff; padding: 0 24px;
          display: flex; align-items: center; justify-content: space-between; height: 52px; }
    nav .brand { font-weight: 700; font-size: 16px; color: #fff; letter-spacing: .5px; }
    .container { display: flex; flex-direction: column; align-items: center;
                 justify-content: center; min-height: calc(100vh - 52px); gap: 20px; padding: 40px; }
    .card { background: #fff; border-radius: 16px; padding: 40px 48px;
            box-shadow: 0 4px 20px rgba(0,0,0,.10); text-align: center; }
    h2 { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
    .hint { color: #666; font-size: 13px; margin-top: 16px; line-height: 1.6; }
    .hint small { color: #aaa; font-size: 12px; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
                  background: #fca5a5; margin-right: 6px; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  </style>
</head>
<body>
  <nav>
    <span class="brand">⚙ 管理后台</span>
    <span style="color:#fca5a5;font-size:12px"><span class="status-dot"></span>未连接</span>
  </nav>
  <div class="container">
    <div class="card">
      <h2>📱 扫描下方二维码登录 WhatsApp</h2>
      <div style="margin:24px 0;display:flex;justify-content:center">
        ${qrContent}
      </div>
      <div class="hint">
        用 WhatsApp 扫码后页面自动跳转<br>
        <small>二维码约每 20 秒刷新一次</small>
      </div>
    </div>
  </div>
  <script>
    // 每 3 秒轮询连接状态
    const CHECK_INTERVAL = 3000;
    let lastHasQR = ${!!_qrBase64};

    async function checkStatus() {
      try {
        const res = await fetch('/admin/wa-status');
        const { connected, hasQR } = await res.json();

        if (connected) {
          // 扫码成功，跳转到审核页
          window.location.href = '/admin';
          return;
        }

        // QR 码有变化（新 QR 刷新进来），重载页面以更新图片
        if (hasQR !== lastHasQR) {
          window.location.reload();
          return;
        }
      } catch (e) {
        // 网络异常静默处理，下次继续轮询
      }

      setTimeout(checkStatus, CHECK_INTERVAL);
    }

    setTimeout(checkStatus, CHECK_INTERVAL);
  </script>
</body>
</html>`;
}

// ─── 收据状态标签映射 ──────────────────────────────────────────────────────────

const STATUS_LABEL = {
  pending_review: "待 AI 提取",
  ai_extracted:   "待发消息",
  confirmed:      "已发送",
  rejected:       "已拒绝",
};

/**
 * 渲染单条收据的 AI 结果摘要（ai_extracted / confirmed 时显示）
 * 只显示金额和图片摘要，不显示合格/不合格判定（由人工决定）
 */
function renderAiResult(aiResult) {
  if (!aiResult) return '<span style="color:#aaa;font-size:12px">—</span>';
  return `<div class="ai-result">
    <strong>金额：</strong>RM ${aiResult.amount ?? "—"}<br>
    <strong>摘要：</strong>${aiResult.summary || "—"}
  </div>`;
}

/**
 * 渲染单行操作区
 * - pending_review  → [AI 提取] 按钮（AJAX）
 * - ai_extracted    → 自由文本输入框 + [发送给用户] 按钮
 * - confirmed       → 显示已发送的消息内容和时间（只读）
 * - rejected        → 仅显示时间（历史状态，保持兼容）
 */
function renderActions(r) {
  if (r.status === "pending_review") {
    return `<button class="btn btn-ai" onclick="aiExtract('${r.id}', this)">🤖 AI 提取</button>`;
  }

  if (r.status === "ai_extracted") {
    // 发送给用户 + 拒绝 两个操作并列，拒绝不发 WhatsApp，仅更新状态
    return `<form class="send-form" method="POST" action="/admin/receipts/${r.id}/send-message">
      <textarea name="message" placeholder="输入要发给用户的消息…" required></textarea>
      <button type="submit" class="btn btn-send">📤 发送给用户</button>
    </form>
    <form class="reject-form" method="POST" action="/admin/receipts/${r.id}/reject"
          onsubmit="return confirm('确认拒绝此收据？')">
      <input name="note" placeholder="拒绝原因（可选）" />
      <button type="submit" class="btn btn-reject">❌ 拒绝</button>
    </form>`;
  }

  if (r.status === "confirmed") {
    // 已发送：展示消息内容和时间（只读审计）
    const sentTime = r.sentAt ? new Date(r.sentAt).toLocaleString("zh-CN") : "—";
    const sentMsg  = r.sentMessage
      ? `<div class="sent-msg">${escapeHtml(r.sentMessage)}</div>`
      : "";
    return `<div class="sent-record">
      ${sentMsg}
      <span class="sent-time">发送于 ${sentTime}</span>
    </div>`;
  }

  // rejected：显示拒绝原因（若有）和拒绝时间
  const rejectTime = r.reviewedAt ? new Date(r.reviewedAt).toLocaleString("zh-CN") : "—";
  const rejectNote = r.reviewNote
    ? `<div class="reject-note">${escapeHtml(r.reviewNote)}</div>`
    : "";
  return `<div>${rejectNote}<span style="color:#aaa;font-size:12px">拒绝于 ${rejectTime}</span></div>`;
}

/** 转义 HTML 特殊字符，防止消息内容中含有尖括号等引发 XSS */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── 收据列表页 ────────────────────────────────────────────────────────────────

function receiptsPage(receipts) {
  if (receipts.length === 0) {
    return htmlLayout("收据审核", '<div class="empty">暂无收据记录</div>');
  }

  const rows = receipts
    .map((r, idx) => {
      const statusBadge = `<span class="badge badge-${r.status}">${STATUS_LABEL[r.status] || r.status}</span>`;
      const thumbSrc = `/admin/images/${r.imageFilename}`;
      const thumb = `<img class="thumb" src="${thumbSrc}" alt="收据" onclick="openLightbox('${thumbSrc}')" />`;

      return `<tr id="row-${r.id}">
      <td>${receipts.length - idx}</td>
      <td>${r.submittedAt ? new Date(r.submittedAt).toLocaleString("zh-CN") : "—"}</td>
      <td style="font-size:12px">${(r.phone || "—").replace(/@c\.us$/, "")}</td>
      <td style="font-size:12px">${r.ic || "—"}</td>
      <td>${thumb}</td>
      <td>${statusBadge}</td>
      <td>${renderAiResult(r.aiResult)}</td>
      <td style="max-width:220px">${renderActions(r)}</td>
    </tr>`;
    })
    .join("");

  const content = `
    <div class="toolbar">
      <span style="color:#666;font-size:13px">共 ${receipts.length} 条记录</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th><th>提交时间</th><th>手机号</th><th>身份证号</th><th>收据图片</th>
          <th>状态</th><th>AI 提取结果</th><th>操作 / 记录</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <script>
      /**
       * AJAX 触发 AI 提取，不刷整页
       * 提取成功后重载页面以显示最新状态和发送表单
       */
      async function aiExtract(id, btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 识别中…';

        try {
          const res = await fetch('/admin/receipts/' + id + '/ai-extract', { method: 'POST' });
          const data = await res.json();

          if (!res.ok) {
            alert('AI 提取失败：' + (data.error || res.statusText));
            btn.disabled = false;
            btn.textContent = '🤖 AI 提取';
            return;
          }

          // 提取成功，重载整页以显示发送表单
          window.location.reload();
        } catch (e) {
          alert('网络错误，请重试');
          btn.disabled = false;
          btn.textContent = '🤖 AI 提取';
        }
      }
    </script>`;

  return htmlLayout("收据审核", content);
}

// ─── 主函数：启动 Express 服务器 ───────────────────────────────────────────────

function startAdminServer() {
  // 启动时检查凭据是否已配置
  const credentials = getAdminCredentials();

  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // session 配置：secret 每次启动随机，重启自动清除所有登录态
  app.use(
    session({
      secret: crypto.randomBytes(32).toString("hex"),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        maxAge: 8 * 60 * 60 * 1000, // 8 小时自动过期
      },
    })
  );

  // ── 路由 ──────────────────────────────────────────────────────────────────

  // 根路径：已登录直接渲染收据审核页，未登录跳登录
  app.get("/admin", (req, res) => {
    if (!req.session.authenticated) {
      return res.redirect("/admin/login");
    }
    try {
      const receipts = receiptStore.getAll();
      res.send(receiptsPage(receipts));
    } catch (err) {
      logger.error("加载收据列表失败", { error: err.message });
      res.status(500).send("加载失败：" + err.message);
    }
  });

  // /admin/receipts 重定向到 /admin（向后兼容旧书签）
  app.get("/admin/receipts", (req, res) => {
    res.redirect("/admin");
  });

  // QR 码扫码页（无需登录，Bot 未就绪时供非技术用户扫码）
  app.get("/admin/qr", (req, res) => {
    if (_waConnected) {
      return res.redirect("/admin");
    }
    res.send(qrPage());
  });

  // WhatsApp 连接状态 API（供 QR 页轮询）
  app.get("/admin/wa-status", (req, res) => {
    res.json({ connected: _waConnected, hasQR: !!_qrBase64 });
  });

  // 登录页
  app.get("/admin/login", (req, res) => {
    if (req.session.authenticated) return res.redirect("/admin");
    res.send(loginPage());
  });

  app.post("/admin/login", (req, res) => {
    const { username, password } = req.body;
    if (username === credentials.user && password === credentials.pass) {
      req.session.authenticated = true;
      req.session.username = username;
      return res.redirect("/admin");
    }
    res.send(loginPage("用户名或密码错误，请重试"));
  });

  // 登出
  app.post("/admin/logout", (req, res) => {
    req.session.destroy(() => {
      res.redirect("/admin/login");
    });
  });

  // ── 收据相关路由 ──────────────────────────────────────────────────────────

  // 静态图片服务：将 data/images/ 中的图片暴露给前端缩略图和灯箱
  app.get("/admin/images/:filename", requireAuth, (req, res) => {
    // 防止路径穿越攻击：只取 basename，不允许 ../ 等
    const filename = path.basename(req.params.filename);
    const imagePath = receiptStore.getImagePath(filename);

    if (!fs.existsSync(imagePath)) {
      return res.status(404).send("图片不存在");
    }
    res.sendFile(imagePath);
  });

  // AI 提取：读取图片 → 调用 Gemini → 保存结果（JSON API，前端 AJAX 调用）
  app.post("/admin/receipts/:id/ai-extract", requireAuth, async (req, res) => {
    const { id } = req.params;

    const record = receiptStore.getById(id);
    if (!record) {
      return res.status(404).json({ error: "收据记录不存在" });
    }
    if (record.status !== "pending_review") {
      return res.status(400).json({ error: `当前状态 ${record.status} 不可触发 AI 提取` });
    }

    try {
      const imagePath = receiptStore.getImagePath(record.imageFilename);
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString("base64");

      // 根据文件名后缀推断实际 MIME 类型
      const imageMime = record.imageFilename.endsWith(".png")  ? "image/png"
                      : record.imageFilename.endsWith(".webp") ? "image/webp"
                      : "image/jpeg";
      const aiResult = await processReceipt(base64Image, imageMime);

      if (!aiResult.success) {
        return res.status(502).json({ error: `AI 识别失败：${aiResult.message}` });
      }

      receiptStore.saveAiResult(id, aiResult);
      logger.info("AI 提取完成", { id, amount: aiResult.amount });

      res.json({ ok: true, aiResult });
    } catch (err) {
      logger.error("AI 提取失败", { id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * 人工发送消息给用户
   * 输入任意文本 → 调用 WhatsApp 发送 → 保存记录 → 状态改为 confirmed
   */
  app.post("/admin/receipts/:id/send-message", requireAuth, async (req, res) => {
    const { id } = req.params;
    const message = (req.body.message || "").trim();

    if (!message) {
      return res.status(400).send("消息内容不能为空");
    }

    try {
      const record = receiptStore.getById(id);
      if (!record) return res.status(404).send("收据不存在");

      // 补全 chatId 格式
      const chatId = record.phone.includes("@") ? record.phone : `${record.phone}@c.us`;

      // 发送 WhatsApp 消息（client 未就绪时报错，让用户知道）
      if (!_client || typeof _client.sendMessage !== "function") {
        return res.status(503).send("WhatsApp 尚未连接，请先扫码");
      }

      await _client.sendMessage(chatId, message);
      logger.info("WhatsApp 消息已发送", { id, chatId, messageLength: message.length });

      // 保存发送记录，状态改为 confirmed
      receiptStore.saveSentMessage(id, message);

      res.redirect("/admin");
    } catch (err) {
      logger.error("发送消息失败", { id, error: err.message });
      res.status(500).send("发送失败：" + err.message);
    }
  });

  // ── 拒绝收据（不发 WhatsApp，仅更新内部状态）────────────────────────────────

  app.post("/admin/receipts/:id/reject", requireAuth, (req, res) => {
    const { id } = req.params;
    const note = (req.body.note || "").trim();
    try {
      receiptStore.rejectReceipt(id, note);
      logger.info("收据已拒绝", { id, note });
      res.redirect("/admin");
    } catch (err) {
      logger.error("拒绝收据失败", { id, error: err.message });
      res.status(500).send("操作失败：" + err.message);
    }
  });

  // ── 下载 Excel ────────────────────────────────────────────────────────────

  app.get("/admin/export", requireAuth, (req, res) => {
    const excelPath = getExcelPath();
    res.download(excelPath, "records.xlsx", (err) => {
      if (err) {
        logger.error("Excel 下载失败", { error: err.message });
        res.status(500).send("下载失败：" + err.message);
      }
    });
  });

  // ── 启动监听 ──────────────────────────────────────────────────────────────
  app.listen(ADMIN_PORT, () => {
    logger.info(`管理后台已启动，监听端口 ${ADMIN_PORT}`);
  });
}

module.exports = { startAdminServer, setClient, setQR };
