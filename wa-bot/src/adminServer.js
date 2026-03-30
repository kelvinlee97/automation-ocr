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
const rateLimit = require("express-rate-limit");
const { getExcelPath } = require("./services/excelService");
const receiptStore = require("./services/receiptStore");
const { processReceipt } = require("./services/aiService");
const adminUserService = require("./services/adminUserService");
const logger = require("./utils/logger");

const ADMIN_PORT = 3000;

// ─── Rate Limiter 配置 ──────────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 20, // 每个 IP 最多 20 次尝试
  message: "尝试次数过多，请 15 分钟后重试",
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 分钟
  max: 60, // 每个 IP 最多 60 次请求
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── 模块级状态（通过 setClient/setQR 注入，无需传参） ─────────────────────────

let _client = null;
let _qrBase64 = null;    // QR 码 data URI（base64 PNG）
let _waConnected = false;
// qr 事件触发后置为 true，表示 client 已进入认证窗口期，可调用 requestPairingCode
let _pairingCodeReady = false;

/**
 * Bot 就绪后注入 client 实例
 * 同时清空 QR（连接后不再需要）
 */
function setClient(client) {
  _client = client;
  _waConnected = true;
  _qrBase64 = null;
  _pairingCodeReady = false; // 已认证，重置配对码窗口期标志
  logger.info("WhatsApp client 已注入管理后台");
}

/**
 * QR 码刷新时注入新的 base64 data URI
 */
function setQR(base64DataUri) {
  _qrBase64 = base64DataUri;
  _waConnected = false;
}

/**
 * 通知 adminServer：client 已进入配对码请求窗口期（qr 事件触发后）
 */
function setPairingCodeReady(ready) {
  _pairingCodeReady = ready;
}

// ─── 认证中间件 ────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect("/admin/login");
}

/**
 * 首次设置守卫：尚未创建任何账户时，强制所有 /admin/* 请求跳转到设置页
 * 放在 requireAuth 之前，确保安装引导优先执行
 */
function requireSetup(req, res, next) {
  // 放行设置页本身，防止无限重定向
  if (req.path === "/admin/setup") return next();
  if (adminUserService.isEmpty()) return res.redirect("/admin/setup");
  next();
}

// ─── HTML 骨架 ─────────────────────────────────────────────────────────────────

function htmlLayout(title, content, currentPath = '') {
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
    /* ── 字体引入（Google Fonts CDN） ── */
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

    /* ── 色彩系统：所有颜色通过 CSS 变量统一管理，方便后续调整 ── */
    :root {
      --bg-base:        #0F172A;  /* 深板岩底色 */
      --bg-surface:     #1E293B;  /* 卡片/表格背景 */
      --bg-surface-2:   #263549;  /* 表头/行悬停 */
      --border:         #334155;  /* 边界线 */
      --text-primary:   #E2E8F0;  /* 主文字 */
      --text-secondary: #94A3B8;  /* 次级文字 */
      --text-muted:     #64748B;  /* 弱化文字（表头标签等） */
      --accent-primary: #6366F1;  /* 靛蓝主色（导航线/按钮/悬停条） */
      --accent-emerald: #10B981;  /* 翠绿（已确认/发送成功） */
      --accent-amber:   #F59E0B;  /* 琥珀（待提取/待审核） */
      --accent-blue:    #3B82F6;  /* 蓝（AI 已提取） */
      --accent-rose:    #F43F5E;  /* 玫红（已拒绝/错误） */
    }

    /* ── 亮色主题：覆盖所有颜色变量，强调色保持不变以维持品牌一致性 ── */
    [data-theme="light"] {
      --bg-base:        #F8FAFC;
      --bg-surface:     #FFFFFF;
      --bg-surface-2:   #F1F5F9;
      --border:         #E2E8F0;
      --text-primary:   #0F172A;
      --text-secondary: #475569;
      --text-muted:     #94A3B8;
    }

    /* 亮色下导航背景需单独覆盖（暗色用了 rgba 半透明） */
    [data-theme="light"] nav {
      background: rgba(248, 250, 252, 0.92);
      box-shadow: 0 1px 0 var(--border);
    }

    /* 亮色下徽标发光降低以避免在白底上过亮 */
    [data-theme="light"] .badge-pending_review { box-shadow: 0 0 6px rgba(245,158,11,0.15); }
    [data-theme="light"] .badge-ai_extracted   { box-shadow: 0 0 6px rgba(59,130,246,0.15); }
    [data-theme="light"] .badge-confirmed      { box-shadow: 0 0 6px rgba(16,185,129,0.15); }
    [data-theme="light"] .badge-rejected       { box-shadow: 0 0 6px rgba(244,63,94,0.12);  }

    /* 主题切换时所有颜色平滑过渡 */
    *, *::before, *::after {
      transition: background-color .25s ease, border-color .25s ease, color .2s ease,
                  box-shadow .25s ease;
    }
    /* 排除动画元素避免过渡干扰 */
    .status-dot, .btn, nav a { transition: none; }
    .btn { transition: opacity .15s, transform .1s; }
    nav a { transition: color .15s; }

    /* ── 主题切换按钮 ── */
    .theme-toggle {
      width: 32px; height: 32px; border-radius: 8px;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 15px; padding: 0;
      transition: background .15s, border-color .15s, transform .1s !important;
    }
    .theme-toggle:hover {
      background: var(--bg-surface-2);
      border-color: var(--text-muted);
      transform: rotate(20deg);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg-base);
      color: var(--text-primary);
      min-height: 100vh;
    }

    /* ── 导航：玻璃态背景 + 顶部靛蓝边界线（品牌记忆点） ── */
    nav {
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      border-top: 3px solid var(--accent-primary);
      color: var(--text-primary);
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 52px;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    nav a {
      color: var(--text-secondary);
      text-decoration: none;
      margin-left: 20px;
      font-size: 14px;
      font-weight: 500;
      transition: color .15s;
    }
    nav a:hover { color: var(--text-primary); }
    nav .brand {
      font-family: 'Syne', sans-serif;
      font-weight: 700;
      font-size: 16px;
      color: var(--text-primary);
      letter-spacing: .5px;
      margin-left: 0;
    }
    nav .nav-active {
      color: var(--text-primary);
      border-bottom: 2px solid var(--accent-primary);
      padding-bottom: 2px;
    }
    nav .nav-right { display: flex; align-items: center; gap: 8px; }

    main { max-width: 1400px; margin: 32px auto; padding: 0 24px; }

    h1 {
      font-family: 'Syne', sans-serif;
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 20px;
    }

    /* ── 表格：暗色背景 + 行悬停左侧彩条（视觉焦点引导） ── */
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-surface);
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    th {
      background: var(--bg-surface-2);
      color: var(--text-muted);
      font-size: 11px;
      text-transform: uppercase;
      padding: 10px 14px;
      text-align: left;
      letter-spacing: .8px;
      font-weight: 600;
      border-bottom: 1px solid var(--border);
    }
    td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      vertical-align: middle;
      color: var(--text-secondary);
      /* 悬停左边彩条用透明 border-left 占位，避免布局跳动 */
      border-left: 3px solid transparent;
      transition: border-left-color .15s, background .15s;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td {
      background: var(--bg-surface-2);
      border-left-color: var(--accent-primary);
    }

    /* ── 状态徽标：宝石色系 + 微发光阴影（暗色背景下可感知） ── */
    .badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: .3px;
    }
    .badge-pending_review {
      background: rgba(245, 158, 11, 0.15);
      color: var(--accent-amber);
      border: 1px solid rgba(245, 158, 11, 0.3);
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.2);
    }
    .badge-ai_extracted {
      background: rgba(59, 130, 246, 0.15);
      color: var(--accent-blue);
      border: 1px solid rgba(59, 130, 246, 0.3);
      box-shadow: 0 0 8px rgba(59, 130, 246, 0.2);
    }
    .badge-confirmed {
      background: rgba(16, 185, 129, 0.15);
      color: var(--accent-emerald);
      border: 1px solid rgba(16, 185, 129, 0.3);
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.2);
    }
    .badge-rejected {
      background: rgba(244, 63, 94, 0.15);
      color: var(--accent-rose);
      border: 1px solid rgba(244, 63, 94, 0.3);
      box-shadow: 0 0 8px rgba(244, 63, 94, 0.15);
    }

    /* ── 按钮系统 ── */
    .btn {
      display: inline-block;
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-family: 'Outfit', sans-serif;
      font-weight: 600;
      cursor: pointer;
      border: none;
      text-decoration: none;
      transition: opacity .15s, transform .1s;
    }
    .btn:hover { opacity: .85; transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }
    .btn-primary { background: var(--accent-primary); color: #fff; }
    .btn-ai      { background: var(--accent-blue);    color: #fff; }
    .btn-send    { background: var(--accent-emerald);  color: #fff; }
    .btn-reject  { background: var(--accent-rose);     color: #fff; }
    .btn-logout  {
      background: transparent;
      color: var(--text-secondary);
      border: 1px solid var(--border);
    }
    .btn-logout:hover { color: var(--text-primary); border-color: var(--text-secondary); }
    .btn:disabled { opacity: .4; cursor: not-allowed; transform: none; }

    /* ── 表单辅助元素 ── */
    .reject-form { margin-top: 6px; display: flex; gap: 6px; align-items: center; }
    .reject-form input {
      flex: 1; padding: 4px 8px;
      background: var(--bg-base);
      border: 1px solid var(--border);
      border-radius: 4px; font-size: 13px;
      color: var(--text-primary);
    }
    .reject-note { color: var(--accent-rose); font-size: 12px; margin-bottom: 2px; }
    form.inline { display: inline; }
    .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .empty { text-align: center; padding: 40px; color: var(--text-muted); font-size: 14px; }

    /* ── 统计卡片 ── */
    .stats-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .stat-card { background: var(--bg-surface); padding: 16px; border-radius: 8px; text-align: center; }
    .stat-label { color: var(--text-muted); font-size: 12px; margin-bottom: 4px; }
    .stat-value { font-size: 24px; font-weight: 600; }
    .stat-pending .stat-value { color: var(--accent-amber); }
    .stat-ai .stat-value { color: var(--accent-blue); }
    .stat-confirmed .stat-value { color: var(--accent-emerald); }
    .stat-rejected .stat-value { color: var(--accent-rose); }

    /* ── 表格横向滚动 ── */
    .table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    /* 限定只影响收据表格，避免污染其他页面的 table */
    .table-wrapper table { min-width: 900px; }

    /* ── 按钮触控优化（仅移动端） ── */
    @media (max-width: 768px) {
      .btn { min-height: 44px; padding: 10px 16px; }
    }

    /* ── 响应式布局 ── */
    @media (max-width: 768px) {
      nav { flex-wrap: wrap; gap: 8px; padding: 12px; }
      nav .nav-right { flex-wrap: wrap; }
      main { padding: 16px; }
      .toolbar { flex-direction: column; align-items: stretch; }
      .toolbar input, .toolbar select { max-width: 100% !important; }
    }

    /* ── 图片缩略图 ── */
    .thumb {
      width: 56px; height: 56px; object-fit: cover; border-radius: 6px;
      cursor: pointer; border: 1px solid var(--border); transition: transform .15s;
    }
    .thumb:hover { transform: scale(1.08); }

    /* ── 图片灯箱 ── */
    #lightbox {
      display: none; position: fixed; inset: 0;
      background: rgba(0, 0, 0, .85);
      z-index: 999; align-items: center; justify-content: center;
    }
    #lightbox.active { display: flex; }
    #lightbox img {
      max-width: 90vw; max-height: 90vh; border-radius: 8px;
      box-shadow: 0 8px 40px rgba(0, 0, 0, .6);
    }
    #lightbox-close {
      position: absolute; top: 20px; right: 28px; font-size: 32px;
      color: #fff; cursor: pointer; line-height: 1;
    }

    /* ── AI 结果展示 ── */
    .ai-result { font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
    .ai-result strong { color: var(--text-primary); }

    /* ── 发送消息表单 ── */
    .send-form { display: flex; gap: 6px; align-items: flex-start; flex-direction: column; }
    .send-form textarea {
      width: 200px; font-size: 12px; padding: 6px 8px;
      background: var(--bg-base);
      border: 1px solid var(--border);
      border-radius: 4px; resize: vertical;
      min-height: 52px;
      color: var(--text-primary);
      font-family: 'Outfit', sans-serif;
    }
    .send-form textarea:focus { outline: none; border-color: var(--accent-emerald); }

    /* ── 已发送记录 ── */
    .sent-record { font-size: 11px; color: var(--text-muted); line-height: 1.5; }
    .sent-record .sent-msg {
      background: rgba(16, 185, 129, 0.08);
      border-left: 3px solid var(--accent-emerald);
      padding: 4px 8px; border-radius: 0 4px 4px 0; margin-bottom: 4px;
      white-space: pre-wrap; word-break: break-word;
      color: var(--text-secondary);
    }
    .sent-record .sent-time { color: var(--text-muted); font-size: 10px; }

    /* ── 等宽数据字段（手机号、IC 号） ── */
    .mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; letter-spacing: .5px; }
  </style>
  <!-- 防止主题闪烁（FOUC）：在 DOM 渲染前同步读取 localStorage 并设置 data-theme -->
  <script>
    (function() {
      var t = localStorage.getItem('admin-theme') || 'dark';
      document.documentElement.setAttribute('data-theme', t);
    })();
  </script>
</head>
<body>
  <nav>
    <a href="/admin" class="brand">⚙ 管理后台</a>
    <div class="nav-right">
      ${statusBadge}
      <a href="/admin" class="${currentPath === '/admin' ? 'nav-active' : ''}">📋 收据审核</a>
      <a href="/admin/export">⬇ 下载 Excel</a>
      <a href="/admin/users" class="${currentPath === '/admin/users' ? 'nav-active' : ''}">👥 用户管理</a>
      <a href="/admin/change-password" class="${currentPath === '/admin/change-password' ? 'nav-active' : ''}">🔑 修改密码</a>
      <button class="theme-toggle" id="themeToggle" title="切换主题" aria-label="切换明暗主题">🌙</button>
      <form class="inline" method="POST" action="/admin/logout">
        <button class="btn btn-logout" style="margin-left:4px">退出</button>
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

    // ── 主题切换逻辑 ──────────────────────────────────────────────
    (function() {
      const STORAGE_KEY = 'admin-theme';
      const btn = document.getElementById('themeToggle');

      // 根据当前主题更新按钮图标
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        btn.textContent = theme === 'light' ? '🌙' : '☀️';
        btn.title = theme === 'light' ? '切换到深色模式' : '切换到浅色模式';
        localStorage.setItem(STORAGE_KEY, theme);
      }

      // 读取持久化设置，默认深色
      const saved = localStorage.getItem(STORAGE_KEY) || 'dark';
      applyTheme(saved);

      btn.addEventListener('click', function() {
        const current = document.documentElement.getAttribute('data-theme');
        applyTheme(current === 'light' ? 'dark' : 'light');
      });
    })();
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
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Outfit:wght@400;500;600&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Outfit', -apple-system, sans-serif;
      /* 径向渐变：顶部稍亮，底部深黑，营造景深感 */
      background: radial-gradient(ellipse at top, #1E293B 0%, #0F172A 100%);
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
    }

    /* 深色磨砂卡片：半透明背景 + 高斯模糊 + 微内光 */
    .card {
      background: rgba(30, 41, 59, 0.8);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(99, 102, 241, 0.2);
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      border-radius: 16px; padding: 40px; width: 360px;
    }

    h1 {
      font-family: 'Syne', sans-serif;
      font-size: 20px; font-weight: 700; margin-bottom: 28px;
      text-align: center; color: #E2E8F0;
    }

    label { display: block; font-size: 13px; color: #94A3B8; margin-bottom: 6px; font-weight: 500; }

    input {
      width: 100%; padding: 10px 12px;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid #334155; border-radius: 6px;
      font-size: 14px; margin-bottom: 16px; outline: none;
      color: #E2E8F0; font-family: 'Outfit', sans-serif;
      transition: border-color .15s;
    }
    input:focus { border-color: #6366F1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15); }
    input::placeholder { color: #475569; }

    button {
      width: 100%; padding: 11px; background: #6366F1; color: #fff;
      border: none; border-radius: 6px; font-size: 15px;
      font-family: 'Outfit', sans-serif; font-weight: 600;
      cursor: pointer; transition: opacity .15s, transform .1s;
    }
    button:hover { opacity: .88; transform: translateY(-1px); }
    button:active { transform: translateY(0); }

    .error { color: #F43F5E; font-size: 13px; margin-bottom: 14px; text-align: center; }
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

// ─── 首次设置页（无任何账户时展示） ────────────────────────────────────────────

function setupPage(errorMsg = "") {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>初始化设置 — 管理后台</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Outfit:wght@400;500;600&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Outfit', -apple-system, sans-serif;
      background: radial-gradient(ellipse at top, #1E293B 0%, #0F172A 100%);
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
    }

    .card {
      background: rgba(30, 41, 59, 0.8);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(99, 102, 241, 0.2);
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      border-radius: 16px; padding: 40px; width: 400px;
    }

    h1 {
      font-family: 'Syne', sans-serif;
      font-size: 20px; font-weight: 700; margin-bottom: 8px;
      text-align: center; color: #E2E8F0;
    }
    .sub { font-size: 13px; color: #64748B; text-align: center; margin-bottom: 28px; }

    label { display: block; font-size: 13px; color: #94A3B8; margin-bottom: 6px; font-weight: 500; }

    input {
      width: 100%; padding: 10px 12px;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid #334155; border-radius: 6px;
      font-size: 14px; margin-bottom: 16px; outline: none;
      color: #E2E8F0; font-family: 'Outfit', sans-serif;
      transition: border-color .15s;
    }
    input:focus { border-color: #6366F1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15); }
    input::placeholder { color: #475569; }

    button {
      width: 100%; padding: 11px; background: #6366F1; color: #fff;
      border: none; border-radius: 6px; font-size: 15px;
      font-family: 'Outfit', sans-serif; font-weight: 600;
      cursor: pointer; transition: opacity .15s, transform .1s;
    }
    button:hover { opacity: .88; transform: translateY(-1px); }
    button:active { transform: translateY(0); }

    .error { color: #F43F5E; font-size: 13px; margin-bottom: 14px; text-align: center; }
    .hint { font-size: 11px; color: #475569; margin-top: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚀 初始化管理后台</h1>
    <div class="sub">首次使用，请创建管理员账号</div>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ""}
    <form method="POST" action="/admin/setup">
      <label>用户名（至少 3 位，字母/数字/下划线）</label>
      <input type="text" name="username" required autofocus minlength="3" pattern="[\\w-]+" />
      <label>密码（至少 8 位）</label>
      <input type="password" name="password" required minlength="8" />
      <label>确认密码</label>
      <input type="password" name="confirm" required minlength="8" />
      <button type="submit">创建管理员账号</button>
    </form>
    <div class="hint">此页面只在尚无账户时出现，创建后自动消失</div>
  </div>
</body>
</html>`;
}

// ─── 用户管理页 ────────────────────────────────────────────────────────────────

function usersPage(users, currentUser, flash = "") {
  const rows = users.map(u => {
    // 禁止删除当前登录账户（防止自锁），按钮置灰
    const isSelf = u.username === currentUser;
    const deleteBtn = isSelf
      ? `<button class="btn" disabled title="不能删除当前登录账户">🚫 删除</button>`
      : `<form class="inline" method="POST" action="/admin/users/${encodeURIComponent(u.username)}/delete"
              onsubmit="return confirm('确认删除用户 ${u.username}？')">
           <button class="btn btn-reject">删除</button>
         </form>`;

    return `<tr>
      <td>${u.username}${isSelf ? ' <span style="color:#888;font-size:11px">(当前)</span>' : ""}</td>
      <td>${u.createdAt ? new Date(u.createdAt).toLocaleString("zh-CN") : "—"}</td>
      <td>
        <form class="inline" method="POST" action="/admin/users/${encodeURIComponent(u.username)}/reset-password"
              onsubmit="return promptReset(this, '${u.username}')">
          <input type="hidden" name="newPassword" id="rp-${u.username}" />
          <button type="submit" class="btn btn-primary">重置密码</button>
        </form>
        ${deleteBtn}
      </td>
    </tr>`;
  }).join("");

  const content = `
    ${flash ? `<div style="background:#e6f9f0;border-left:4px solid #10b981;padding:10px 14px;border-radius:4px;margin-bottom:16px;font-size:13px">${flash}</div>` : ""}
    <div class="toolbar">
      <a href="/admin/users/new" class="btn btn-primary">＋ 新建用户</a>
    </div>
    <table>
      <thead><tr><th>用户名</th><th>创建时间</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" style="text-align:center;color:#aaa">暂无用户</td></tr>'}</tbody>
    </table>
    <script>
      function promptReset(form, username) {
        const pwd = prompt('请输入 ' + username + ' 的新密码（至少 8 位）：');
        if (!pwd || pwd.length < 8) { alert('密码至少 8 位'); return false; }
        form.querySelector('#rp-' + username).value = pwd;
        return true;
      }
    </script>`;

  return htmlLayout("用户管理", content, '/admin/users');
}

// ─── 新建用户页 ────────────────────────────────────────────────────────────────

function newUserPage(errorMsg = "") {
  const content = `
    ${errorMsg ? `<div style="background:#fff0f0;border-left:4px solid #c0392b;padding:10px 14px;border-radius:4px;margin-bottom:16px;font-size:13px">${errorMsg}</div>` : ""}
    <form method="POST" action="/admin/users/new" style="max-width:400px;background:#fff;padding:32px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08)">
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:13px;color:#555;margin-bottom:6px">用户名（至少 3 位）</label>
        <input type="text" name="username" required minlength="3" pattern="[\\w-]+"
               style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px" />
      </div>
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:13px;color:#555;margin-bottom:6px">密码（至少 8 位）</label>
        <input type="password" name="password" required minlength="8"
               style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px" />
      </div>
      <div style="margin-bottom:24px">
        <label style="display:block;font-size:13px;color:#555;margin-bottom:6px">确认密码</label>
        <input type="password" name="confirm" required minlength="8"
               style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px" />
      </div>
      <div style="display:flex;gap:12px">
        <button type="submit" class="btn btn-primary" style="padding:10px 24px">创建用户</button>
        <a href="/admin/users" class="btn btn-logout" style="padding:10px 24px">取消</a>
      </div>
    </form>`;
  return htmlLayout("新建用户", content, '/admin/users');
}

// ─── 修改密码页 ────────────────────────────────────────────────────────────────

function changePasswordPage(errorMsg = "", successMsg = "") {
  const content = `
    ${errorMsg   ? `<div style="background:#fff0f0;border-left:4px solid #c0392b;padding:10px 14px;border-radius:4px;margin-bottom:16px;font-size:13px">${errorMsg}</div>` : ""}
    ${successMsg ? `<div style="background:#e6f9f0;border-left:4px solid #10b981;padding:10px 14px;border-radius:4px;margin-bottom:16px;font-size:13px">${successMsg}</div>` : ""}
    <form method="POST" action="/admin/change-password" style="max-width:400px;background:#fff;padding:32px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08)">
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:13px;color:#555;margin-bottom:6px">当前密码</label>
        <input type="password" name="oldPassword" required
               style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px" />
      </div>
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:13px;color:#555;margin-bottom:6px">新密码（至少 8 位）</label>
        <input type="password" name="newPassword" required minlength="8"
               style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px" />
      </div>
      <div style="margin-bottom:24px">
        <label style="display:block;font-size:13px;color:#555;margin-bottom:6px">确认新密码</label>
        <input type="password" name="confirm" required minlength="8"
               style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px" />
      </div>
      <button type="submit" class="btn btn-primary" style="padding:10px 24px">更新密码</button>
    </form>`;
  return htmlLayout("修改密码", content, '/admin/change-password');
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
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Outfit:wght@400;500;600&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0F172A;
      color: #E2E8F0;
    }

    /* 导航：与 htmlLayout 保持一致的玻璃态风格 */
    nav {
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid #334155;
      border-top: 3px solid #6366F1;
      color: #E2E8F0; padding: 0 24px;
      display: flex; align-items: center;
      justify-content: space-between; height: 52px;
    }
    nav .brand {
      font-family: 'Syne', sans-serif;
      font-weight: 700; font-size: 16px;
      color: #E2E8F0; letter-spacing: .5px;
    }

    .container {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      min-height: calc(100vh - 52px); gap: 20px; padding: 40px;
      background: radial-gradient(ellipse at top, #1E293B 0%, #0F172A 100%);
    }

    .card {
      background: rgba(30, 41, 59, 0.8);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(99, 102, 241, 0.2);
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      border-radius: 16px; padding: 40px 48px; text-align: center;
      min-width: 340px;
    }

    h2 {
      font-family: 'Syne', sans-serif;
      font-size: 18px; font-weight: 700; margin-bottom: 16px; color: #E2E8F0;
    }

    .hint { color: #64748B; font-size: 13px; margin-top: 16px; line-height: 1.6; }
    .hint small { color: #475569; font-size: 12px; }

    /* 玫红脉冲状态点：未连接时提示用户注意 */
    .status-dot {
      display: inline-block; width: 8px; height: 8px; border-radius: 50%;
      background: #F43F5E; margin-right: 6px;
      animation: pulse 2s infinite;
      box-shadow: 0 0 6px rgba(244, 63, 94, 0.5);
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }

    /* ─── Tab 切换 ─────────────────────────────────── */
    .tabs {
      display: flex; gap: 4px;
      background: rgba(15, 23, 42, 0.6);
      border-radius: 10px; padding: 4px;
      margin-bottom: 28px;
    }
    .tab-btn {
      flex: 1; padding: 8px 16px;
      background: transparent; border: none; cursor: pointer;
      color: #64748B; font-family: inherit; font-size: 14px; font-weight: 500;
      border-radius: 7px; transition: all 0.2s;
    }
    .tab-btn.active {
      background: rgba(99, 102, 241, 0.2);
      color: #A5B4FC;
      box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.3);
    }
    .tab-btn:hover:not(.active) { color: #94A3B8; background: rgba(255,255,255,0.04); }

    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* ─── 配对码 Tab 专属样式 ─────────────────────────── */
    .phone-input-group {
      display: flex; gap: 8px; margin-bottom: 16px;
    }
    .phone-input {
      flex: 1; padding: 10px 14px;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid #334155; border-radius: 8px;
      color: #E2E8F0; font-family: inherit; font-size: 14px;
      outline: none; transition: border-color 0.2s;
    }
    .phone-input:focus { border-color: #6366F1; }
    .phone-input::placeholder { color: #475569; }

    .btn-pairing {
      padding: 10px 18px; white-space: nowrap;
      background: linear-gradient(135deg, #6366F1, #8B5CF6);
      border: none; border-radius: 8px; cursor: pointer;
      color: #fff; font-family: inherit; font-size: 14px; font-weight: 600;
      transition: opacity 0.2s;
    }
    .btn-pairing:hover { opacity: 0.85; }
    .btn-pairing:disabled { opacity: 0.5; cursor: not-allowed; }

    /* 配对码展示框 */
    .code-display {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 10px; padding: 20px;
      margin: 16px 0; min-height: 70px;
      display: flex; align-items: center; justify-content: center;
    }
    .code-value {
      font-family: 'Syne', monospace; font-size: 28px; font-weight: 700;
      color: #A5B4FC; letter-spacing: 4px;
    }
    .code-placeholder { color: #475569; font-size: 14px; }

    /* 错误提示 */
    .error-msg {
      color: #F87171; font-size: 13px; margin-top: 8px;
      background: rgba(248, 113, 113, 0.1); border-radius: 6px;
      padding: 8px 12px; display: none;
    }

    /* 使用说明步骤 */
    .steps {
      text-align: left; margin-top: 16px;
      background: rgba(15, 23, 42, 0.4);
      border-radius: 8px; padding: 12px 16px;
    }
    .steps p { font-size: 12px; color: #64748B; margin-bottom: 6px; font-weight: 600; }
    .steps ol { padding-left: 18px; }
    .steps li { font-size: 12px; color: #475569; line-height: 1.8; }
  </style>
</head>
<body>
  <nav>
    <span class="brand">⚙ 管理后台</span>
    <span style="color:#fca5a5;font-size:12px"><span class="status-dot"></span>未连接</span>
  </nav>
  <div class="container">
    <div class="card">
      <h2>📱 连接 WhatsApp</h2>

      <!-- Tab 切换按钮 -->
      <div class="tabs">
        <button class="tab-btn active" onclick="switchTab('qr', this)">扫描二维码</button>
        <button class="tab-btn" onclick="switchTab('pairing', this)">配对码登录</button>
      </div>

      <!-- Tab A：QR 码 -->
      <div id="tab-qr" class="tab-panel active">
        <div style="margin:0 0 16px;display:flex;justify-content:center">
          ${qrContent}
        </div>
        <div class="hint">
          用 WhatsApp 扫码后页面自动跳转<br>
          <small>二维码约每 20 秒刷新一次</small>
        </div>
      </div>

      <!-- Tab B：配对码 -->
      <div id="tab-pairing" class="tab-panel">
        <div class="phone-input-group">
          <input
            type="text" id="phone-input" class="phone-input"
            placeholder="601234567890（含区号，纯数字）"
            maxlength="15" inputmode="numeric"
          />
          <button class="btn-pairing" id="get-code-btn" onclick="requestCode()">获取配对码</button>
        </div>

        <div class="code-display" id="code-display">
          <span class="code-placeholder" id="code-placeholder">点击上方按钮获取配对码</span>
          <span class="code-value" id="code-value" style="display:none"></span>
        </div>

        <div class="error-msg" id="error-msg"></div>

        <div class="steps">
          <p>📌 如何使用配对码</p>
          <ol>
            <li>打开手机 WhatsApp</li>
            <li>进入「设置」→「已连接的设备」</li>
            <li>点击「用手机号码连接」</li>
            <li>输入上方显示的 8 位配对码</li>
          </ol>
        </div>
      </div>
    </div>
  </div>
  <script>
    // ─── Tab 切换 ────────────────────────────────────────
    function switchTab(name, btn) {
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('tab-' + name).classList.add('active');
      btn.classList.add('active');
    }

    // ─── 配对码请求 ──────────────────────────────────────
    async function requestCode() {
      const phone = document.getElementById('phone-input').value.trim();
      const btn = document.getElementById('get-code-btn');
      const errEl = document.getElementById('error-msg');
      const codeVal = document.getElementById('code-value');
      const codePlaceholder = document.getElementById('code-placeholder');

      // 重置上次状态
      errEl.style.display = 'none';
      codeVal.style.display = 'none';
      codePlaceholder.style.display = 'block';
      codePlaceholder.textContent = '正在请求配对码…';

      btn.disabled = true;
      btn.textContent = '请求中…';

      try {
        const res = await fetch('/admin/request-pairing-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        });
        const data = await res.json();

        if (!res.ok) {
          errEl.textContent = data.error || '请求失败，请稍后重试';
          errEl.style.display = 'block';
          codePlaceholder.textContent = '点击上方按钮获取配对码';
        } else {
          // 展示配对码
          codeVal.textContent = data.code;
          codeVal.style.display = 'block';
          codePlaceholder.style.display = 'none';
        }
      } catch (e) {
        errEl.textContent = '网络错误，请检查连接后重试';
        errEl.style.display = 'block';
        codePlaceholder.textContent = '点击上方按钮获取配对码';
      } finally {
        btn.disabled = false;
        btn.textContent = '重新获取';
      }
    }

    // ─── 连接状态轮询（QR 和配对码 Tab 共用） ────────────
    const CHECK_INTERVAL = 3000;
    let lastHasQR = ${!!_qrBase64};

    async function checkStatus() {
      try {
        const res = await fetch('/admin/wa-status');
        const { connected, hasQR } = await res.json();

        if (connected) {
          // 认证成功，跳转到审核页
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
    return htmlLayout("收据审核", '<div class="empty">暂无收据记录</div>', '/admin');
  }

  // 收据状态枚举——用于白名单校验，防止非法值混入 HTML 属性
  const VALID_RECEIPT_STATUSES = new Set(['pending_review', 'ai_extracted', 'confirmed', 'rejected']);

  // 统计各状态数量
  const stats = receipts.reduce((acc, r) => {
    const s = r.status || 'pending_review';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  const statsCards = `
    <div class="stats-cards">
      <div class="stat-card">
        <div class="stat-label">总计</div>
        <div class="stat-value">${receipts.length}</div>
      </div>
      <div class="stat-card stat-pending">
        <div class="stat-label">待审核</div>
        <div class="stat-value">${stats.pending_review || 0}</div>
      </div>
      <div class="stat-card stat-ai">
        <div class="stat-label">AI已提取</div>
        <div class="stat-value">${stats.ai_extracted || 0}</div>
      </div>
      <div class="stat-card stat-confirmed">
        <div class="stat-label">已通过</div>
        <div class="stat-value">${stats.confirmed || 0}</div>
      </div>
      <div class="stat-card stat-rejected">
        <div class="stat-label">已拒绝</div>
        <div class="stat-value">${stats.rejected || 0}</div>
      </div>
    </div>
  `;

  const rows = receipts
    .map((r, idx) => {
      const statusBadge = `<span class="badge badge-${r.status}">${STATUS_LABEL[r.status] || r.status}</span>`;
      const thumbSrc = `/admin/images/${r.imageFilename}`;
      const thumb = `<img class="thumb" src="${thumbSrc}" alt="收据" onclick="openLightbox('${thumbSrc}')" />`;

      // 白名单校验 status，防止非法值注入 HTML 属性
      const safeStatus = VALID_RECEIPT_STATUSES.has(r.status) ? r.status : '';
      return `<tr data-status="${safeStatus}" id="row-${r.id}">
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
    ${statsCards}
    <div class="toolbar">
      <input type="text" id="searchInput" placeholder="搜索手机号/IC号..." 
        style="padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);flex:1;min-width:200px;max-width:300px">
      <select id="statusFilter" style="padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary)">
        <option value="">全部状态</option>
        <option value="pending_review">待审核</option>
        <option value="ai_extracted">AI已提取</option>
        <option value="confirmed">已通过</option>
        <option value="rejected">已拒绝</option>
      </select>
      <span id="resultCount" style="color:var(--text-muted);font-size:13px">共 ${receipts.length} 条</span>
    </div>
    <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>#</th><th>提交时间</th><th>手机号</th><th>身份证号</th><th>收据图片</th>
          <th>状态</th><th>AI 提取结果</th><th>操作 / 记录</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
    <script>
      (function() {
        var rows = document.querySelectorAll('table tbody tr');
        var searchInput = document.getElementById('searchInput');
        var statusFilter = document.getElementById('statusFilter');
        var resultCount = document.getElementById('resultCount');

        function filter() {
          var query = (searchInput.value || '').toLowerCase();
          var status = statusFilter.value;
          var visible = 0;
          rows.forEach(function(row) {
            var text = row.textContent.toLowerCase();
            var rowStatus = row.dataset.status || '';
            var matchText = !query || text.includes(query);
            var matchStatus = !status || rowStatus === status;
            row.style.display = matchText && matchStatus ? '' : 'none';
            if (matchText && matchStatus) visible++;
          });
          resultCount.textContent = '共 ' + visible + ' 条';
        }

        // 元素不存在时静默退出，防止 DOM 缺失时 TypeError 崩溃
        if (!searchInput || !statusFilter || !resultCount) return;

        searchInput.addEventListener('input', filter);
        statusFilter.addEventListener('change', filter);
      })();

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

  return htmlLayout("收据审核", content, '/admin');
}

// ─── 主函数：启动 Express 服务器 ───────────────────────────────────────────────

function startAdminServer() {
  const app = express();

  // Nginx 反代后 req.ip 会是 127.0.0.1，rate-limit 和日志无法获取真实客户端 IP
  // trust proxy = 1：只信任第一跳（Nginx），防止客户端伪造多级 X-Forwarded-For
  app.set("trust proxy", 1);

  app.use(express.urlencoded({ extended: false }));
  // 限制 JSON body 大小，防止超大 payload 打满内存（管理后台不需要大 JSON）
  app.use(express.json({ limit: "1mb" }));

  // session 配置
  // secret 从环境变量读取，保证重启后 cookie 签名仍有效；未配置时用随机值（开发环境）
  // 注意：当前使用 MemoryStore，进程重启后 session 数据必然清空，SESSION_SECRET 仅防止 cookie 签名失效
  // rolling: true — 每次请求自动续期，真正实现"久不用才踢出"而非"固定 N 小时过期"
  if (!process.env.SESSION_SECRET) {
    logger.warn("未配置 SESSION_SECRET，将使用随机值——重启后所有 session 失效，用户须重新登录");
  }
  const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true, // 有操作就续期，避免活跃使用中途被踢
      cookie: {
        httpOnly: true,
        // 根据实际请求协议决定是否启用 secure，而非依赖 NODE_ENV
        // 'auto' 模式：express-session 会检查 req.secure（已设置 trust proxy），
        // HTTP 访问时 secure=false，HTTPS 访问时 secure=true，无需改代码即可平滑升级到 HTTPS
        secure: "auto",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天无操作后过期
      },
    })
  );

  // ── 路由 ──────────────────────────────────────────────────────────────────

  // Health check（无需认证，用于容器健康探测）
  app.get("/health", (req, res) => {
    res.json({ 
      status: "ok", 
      whatsapp: _waConnected ? "connected" : "disconnected",
      timestamp: new Date().toISOString()
    });
  });

  // 根路径：已登录直接渲染收据审核页，未登录跳登录
  app.get("/admin", requireSetup, (req, res) => {
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

  // ── 首次设置（无账户时的引导页）────────────────────────────────────────────

  app.get("/admin/setup", (req, res) => {
    // 已有账户，直接跳登录（防止已初始化后重访）
    if (!adminUserService.isEmpty()) return res.redirect("/admin/login");
    res.send(setupPage());
  });

  app.post("/admin/setup", (req, res) => {
    if (!adminUserService.isEmpty()) return res.redirect("/admin/login");
    const { username, password, confirm } = req.body;

    if (password !== confirm) return res.send(setupPage("两次密码输入不一致"));
    const result = adminUserService.createUser(username, password);
    if (!result.ok) return res.send(setupPage(result.error));

    logger.info("首次设置完成，管理员账号已创建", { username });
    res.redirect("/admin/login");
  });

  // QR 码扫码页（无需登录，Bot 未就绪时供非技术用户扫码）
  app.get("/admin/qr", (req, res) => {
    if (_waConnected) {
      return res.redirect("/admin");
    }
    res.send(qrPage());
  });

  // 配对码登录 API（无需登录）
  // 接收手机号，调用 whatsapp-web.js requestPairingCode，返回 8 位配对码
  app.post("/admin/request-pairing-code", apiLimiter, async (req, res) => {
    const { phone } = req.body;

    // 验证手机号格式：含国际区号的纯数字，长度 10-15 位
    if (!phone || !/^\d{10,15}$/.test(phone)) {
      return res.status(400).json({
        error: "手机号格式错误，请输入含区号的纯数字（如 601234567890）",
      });
    }

    if (_waConnected) {
      return res.status(400).json({ error: "WhatsApp 已连接，无需配对" });
    }

    // _pairingCodeReady 由 qr 事件触发后置为 true
    // 若尚未进入认证窗口期，拒绝调用，防止 client 抛 "Already authenticated"
    if (!_pairingCodeReady) {
      return res.status(503).json({
        error: "WhatsApp 客户端尚未就绪，请等待初始化完成后重试（通常需要 10-20 秒）",
      });
    }

    try {
      const { requestPairingCode } = require("./bot");
      const code = await requestPairingCode(phone);
      logger.info("配对码已生成", { phone: phone.slice(0, 5) + "****" }); // 手机号脱敏
      res.json({ code });
    } catch (err) {
      logger.error("请求配对码失败", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // WhatsApp 连接状态 API（供 QR 页轮询）
  app.get("/admin/wa-status", (req, res) => {
    res.json({ connected: _waConnected, hasQR: !!_qrBase64 });
  });

  // ── 登录/登出 ──────────────────────────────────────────────────────────────

  app.get("/admin/login", requireSetup, (req, res) => {
    if (req.session.authenticated) return res.redirect("/admin");
    res.send(loginPage());
  });

  app.post("/admin/login", requireSetup, authLimiter, (req, res) => {
    const { username, password } = req.body;
    if (adminUserService.authenticate(username, password)) {
      req.session.authenticated = true;
      req.session.username = username;
      // 等 session 写入 store 完成再跳转，避免 redirect 先到达时认证状态尚未提交
      req.session.save((err) => {
        if (err) {
          logger.error("session 写入失败", { error: String(err) });
          return res.send(loginPage("登录失败，请重试"));
        }
        res.redirect("/admin");
      });
      return;
    }
    res.send(loginPage("用户名或密码错误，请重试"));
  });

  // 登出
  app.post("/admin/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        // destroy 失败不阻塞用户登出流程，但需记录日志排查
        logger.error("session 销毁失败（登出）", { error: String(err) });
      }
      res.redirect("/admin/login");
    });
  });

  // ── 用户管理 ───────────────────────────────────────────────────────────────

  app.get("/admin/users", requireAuth, (req, res) => {
    const users = adminUserService.listUsers();
    const flash = req.query.flash || "";
    res.send(usersPage(users, req.session.username, flash));
  });

  app.get("/admin/users/new", requireAuth, (req, res) => {
    res.send(newUserPage());
  });

  app.post("/admin/users/new", requireAuth, (req, res) => {
    const { username, password, confirm } = req.body;
    if (password !== confirm) return res.send(newUserPage("两次密码输入不一致"));
    const result = adminUserService.createUser(username, password);
    if (!result.ok) return res.send(newUserPage(result.error));
    logger.info("新管理员账号已创建", { by: req.session.username, newUser: username });
    res.redirect("/admin/users?flash=用户创建成功");
  });

  // 重置指定用户密码（管理员操作，无需旧密码）
  app.post("/admin/users/:username/reset-password", requireAuth, (req, res) => {
    const { username } = req.params;
    const { newPassword } = req.body;
    const result = adminUserService.resetPassword(username, newPassword);
    if (!result.ok) return res.redirect(`/admin/users?flash=错误：${result.error}`);
    logger.info("密码已重置", { by: req.session.username, target: username });
    res.redirect("/admin/users?flash=密码重置成功");
  });

  // 删除用户
  app.post("/admin/users/:username/delete", requireAuth, (req, res) => {
    const { username } = req.params;
    const result = adminUserService.deleteUser(username, req.session.username);
    if (!result.ok) return res.redirect(`/admin/users?flash=错误：${result.error}`);
    logger.info("管理员账号已删除", { by: req.session.username, deleted: username });
    res.redirect("/admin/users?flash=用户已删除");
  });

  // ── 修改当前用户密码 ────────────────────────────────────────────────────────

  app.get("/admin/change-password", requireAuth, (req, res) => {
    res.send(changePasswordPage());
  });

  app.post("/admin/change-password", requireAuth, (req, res) => {
    const { oldPassword, newPassword, confirm } = req.body;
    if (newPassword !== confirm) return res.send(changePasswordPage("两次密码输入不一致"));
    const result = adminUserService.changePassword(req.session.username, oldPassword, newPassword);
    if (!result.ok) return res.send(changePasswordPage(result.error));
    logger.info("密码已更新", { username: req.session.username });
    // 改密后销毁 session，要求重新登录
    req.session.destroy((err) => {
      if (err) {
        logger.error("session 销毁失败（改密）", { error: String(err) });
      }
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
  app.post("/admin/receipts/:id/ai-extract", requireAuth, apiLimiter, async (req, res) => {
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
   * 严格约束：只有 ai_extracted 状态才允许发送，防止重复发送或跳过 AI 提取直接发
   * 操作顺序：先落状态 confirmed，再发 WhatsApp
   *   - 若发 WhatsApp 失败，状态已 confirmed 不会重复发送，管理员可在日志中追查
   *   - 若先发消息再落状态，发送成功但写盘失败会导致状态停在 ai_extracted，出现重复发送风险
   */
  app.post("/admin/receipts/:id/send-message", requireAuth, async (req, res) => {
    const { id } = req.params;
    const message = (req.body.message || "").trim();

    if (!message) {
      return res.status(400).send("消息内容不能为空");
    }

    // WhatsApp client 未就绪时提前退出，不浪费后续状态变更
    if (!_client || typeof _client.sendMessage !== "function") {
      return res.status(503).send("WhatsApp 尚未连接，请先扫码");
    }

    try {
      const record = receiptStore.getById(id);
      if (!record) return res.status(404).send("收据不存在");

      // 服务端状态守卫：只有 ai_extracted 允许发送
      // 防止 UI 绕过（双击、直接 POST）导致对 confirmed / pending_review / rejected 记录重复发送
      if (record.status !== "ai_extracted") {
        logger.warn("拒绝发送：状态不符", { id, status: record.status });
        return res.status(409).send(`操作不允许：当前状态为 ${record.status}，只有 ai_extracted 状态可发送`);
      }

      // 补全 chatId 格式（whatsapp-web.js 存储时已含 @c.us，此处兼容万一缺失的情况）
      const chatId = record.phone.includes("@") ? record.phone : `${record.phone}@c.us`;

      // 先落状态为 confirmed，避免 sendMessage 成功但状态未更新时被重复发送
      receiptStore.saveSentMessage(id, message);
      logger.info("收据状态已更新为 confirmed，准备发送 WhatsApp", { id, chatId });

      // 状态已持久化后再发消息：即使此处失败，状态也不会回滚到 ai_extracted
      await _client.sendMessage(chatId, message);
      logger.info("WhatsApp 消息已发送", { id, chatId, messageLength: message.length });

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

  // ── 根路径智能跳转 ────────────────────────────────────────────────────────
  // 访问 / 或任何未匹配路径时，根据当前状态重定向到有效页面，避免 404
  app.get("/", (req, res) => {
    if (adminUserService.isEmpty()) return res.redirect("/admin/setup");
    if (req.session && req.session.authenticated) return res.redirect("/admin");
    res.redirect("/admin/login");
  });

  // 其余未匹配路由统一跳到根路径，让上面的逻辑接管
  app.use((req, res) => {
    res.redirect("/");
  });

  // ── 启动监听 ──────────────────────────────────────────────────────────────
  app.listen(ADMIN_PORT, () => {
    logger.info(`管理后台已启动，监听端口 ${ADMIN_PORT}`);
  });
}

module.exports = { startAdminServer, setClient, setQR, setPairingCodeReady };
