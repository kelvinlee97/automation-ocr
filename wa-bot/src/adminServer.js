/**
 * 管理后台 Express 服务器
 * 与 Bot 同进程运行，通过 setClient()/setQR() 注入 WhatsApp 状态
 * 端口：3000（docker-compose 映射到宿主机 80）
 *
 * 单一界面设计：只保留收据审核页，人工主动发消息给用户
 */

const express = require("express");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
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
// 与 adminUserService / sessionManager 保持一致：优先使用容器注入的 DATA_DIR 环境变量
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../../data");

// ─── Rate Limiter 配置 ──────────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 20, // 每个 IP 最多 20 次尝试
  message: { error: "尝试次数过多，请 15 分钟后重试" },
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
// FileStore 实例引用，在 startAdminServer() 初始化后赋值，供 setDisconnected() 调用
let _sessionStore = null;

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

/**
 * WhatsApp 断线时重置连接状态，并强制清空所有管理后台 sessions
 * disconnected 事件触发时调用，防止后台仍显示"已连接"
 * 清空 sessions 后，所有已登录管理员下次请求时将被重定向到登录页，
 * 避免 WA 掉线期间后台仍可正常操作造成状态不一致
 */
function setDisconnected() {
  _waConnected = false;
  _client = null;
  _pairingCodeReady = false;
  logger.info("WhatsApp 已断线，连接状态重置");

  // 清空所有管理后台 sessions，强制管理员重新登录
  // _sessionStore 在 startAdminServer() 完成后才赋值，此处需判空防止启动阶段误触发
  if (_sessionStore) {
    _sessionStore.clear((err) => {
      if (err) {
        logger.error("断线后清空 admin sessions 失败", { error: String(err) });
      } else {
        logger.info("已清空所有 admin sessions（WA 断线触发）");
      }
    });
  }
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

function htmlLayout(title, content, currentPath = '', lang = 'zh') {
  // 根据当前连接状态动态渲染导航栏徽标
  const statusBadge = _waConnected
    ? `<span style="color:#86efac;font-size:12px">🟢 ${t('connected', lang)}</span>`
    : `<a href="/admin/qr" style="color:#fca5a5;font-size:12px;text-decoration:none">🔴 ${t('disconnected', lang)}</a>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — ${t('admin_panel', lang)}</title>
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
    [data-theme="light"] .badge-waiting_user_reply { box-shadow: 0 0 6px rgba(139,92,246,0.15); }

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

    /* ── 语言切换按钮 ── */
    .lang-toggle {
      min-width: 40px; height: 32px; border-radius: 8px;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 600; padding: 0 8px;
      transition: background .15s, border-color .15s, transform .1s !important;
      letter-spacing: .5px;
    }
    .lang-toggle:hover {
      background: var(--bg-surface-2);
      border-color: var(--text-muted);
      transform: scale(1.05);
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
      font-weight: 600;
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
      transition: background .15s;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td {
      background: var(--bg-surface-2);
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
    /* 紫色系，区分已完成（绿）和待处理（橙/蓝）的过渡状态 */
    .badge-waiting_user_reply {
      background: rgba(139, 92, 246, 0.15);
      color: #a78bfa;
      border: 1px solid rgba(139, 92, 246, 0.3);
      box-shadow: 0 0 8px rgba(139, 92, 246, 0.2);
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
    .stat-waiting .stat-value { color: #a78bfa; }

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

    /* ── 行内发送表单 ── */
    td .send-form { display: flex; flex-direction: column; gap: 4px; }
    td .send-form textarea {
      width: 100%; min-height: 48px; max-height: 80px; resize: vertical;
      padding: 6px 8px; border-radius: 6px; font-size: 12px;
      border: 1px solid var(--border); background: var(--bg-surface-2);
      color: var(--text-primary); font-family: inherit; outline: none;
      transition: border-color .15s;
    }
    td .send-form textarea:focus { border-color: var(--accent-primary); }
    td .send-form .btn-send { align-self: flex-start; padding: 5px 12px; font-size: 12px; }

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

    /* ── Toast 通知系统 ── */
    #toast-container {
      position: fixed; top: 64px; right: 24px; z-index: 10000;
      display: flex; flex-direction: column; gap: 8px; pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      padding: 12px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;
      color: #fff; box-shadow: 0 4px 20px rgba(0,0,0,.3);
      transform: translateX(120%); opacity: 0;
      animation: toast-in .3s ease forwards;
      max-width: 360px; word-break: break-word;
    }
    .toast.toast-out { animation: toast-out .25s ease forwards; }
    .toast-success { background: #059669; border-left: 4px solid #34d399; }
    .toast-error   { background: #dc2626; border-left: 4px solid #f87171; }
    .toast-info     { background: #2563eb; border-left: 4px solid #60a5fa; }
    @keyframes toast-in  { to { transform: translateX(0); opacity: 1; } }
    @keyframes toast-out { to { transform: translateX(120%); opacity: 0; } }

    /* ── 行展开面板 ── */
    .expand-row { display: none; }
    .expand-row.visible { display: table-row; }
    .expand-panel {
      background: var(--bg-surface);
      border-left: 3px solid var(--accent-primary);
      padding: 16px 20px;
    }
    .expand-section { margin-bottom: 14px; }
    .expand-section:last-child { margin-bottom: 0; }
    .expand-label {
      font-size: 11px; text-transform: uppercase; letter-spacing: .8px;
      color: var(--text-muted); font-weight: 600; margin-bottom: 6px;
    }
    .expand-chevron {
      display: inline-block; transition: transform .2s ease;
      font-size: 10px; color: var(--text-muted); margin-right: 6px;
    }
    .expand-chevron.rotated { transform: rotate(90deg); }
    tr.group-row.expandable { cursor: pointer; }
    tr.group-row.expandable:hover td { background: var(--bg-surface-2); }

    /* ── 分页按钮 ── */
    .btn-page {
      padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;
      border: 1px solid var(--border); background: var(--bg-surface);
      color: var(--text-secondary); text-decoration: none; cursor: pointer;
      transition: all .15s;
    }
    .btn-page:hover:not(:disabled) { background: var(--bg-surface-2); color: var(--text-primary); }
    .btn-page:disabled { opacity: .4; cursor: not-allowed; }
    .btn-page.active { background: var(--accent-primary); color: #fff; border-color: var(--accent-primary); }

    /* ── Toast 通知 ── */
    #toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .toast {
      min-width: 250px;
      padding: 12px 16px;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transform: translateX(120%);
      transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .toast.show {
      transform: translateX(0);
    }
    .toast-success {
      background: var(--accent-emerald);
    }
    .toast-error {
      background: var(--accent-rose);
    }
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
    <a href="/admin" class="brand">⚙ ${t('admin_panel', lang)}</a>
    <div class="nav-right">
      ${statusBadge}
      <a href="/admin" class="${currentPath === '/admin' ? 'nav-active' : ''}">📋 ${t('receipt_review', lang)}</a>
      <a href="/admin/export">⬇ ${t('download_excel', lang)}</a>
      <a href="/admin/users" class="${currentPath === '/admin/users' ? 'nav-active' : ''}">👥 ${t('user_management', lang)}</a>
      <button class="lang-toggle" id="langToggle" title="${t('switch_language', lang)}" aria-label="${t('switch_language', lang)}">${lang === 'zh' ? t('lang_en', lang) : t('lang_zh', lang)}</button>
      <button class="theme-toggle" id="themeToggle" title="${lang === 'zh' ? t('switch_to_dark', lang) : t('switch_to_light', lang)}" aria-label="${lang === 'zh' ? t('switch_to_dark', lang) : t('switch_to_light', lang)}">🌙</button>
      <form class="inline" method="POST" action="/admin/logout">
        <button class="btn btn-logout" style="margin-left:4px">${t('logout', lang)}</button>
      </form>
    </div>
  </nav>
  <main>
    <h1>${title}</h1>
    ${content}
  </main>
  <!-- Toast 通知容器 -->
  <div id="toast-container"></div>
  <!-- 图片灯箱 -->
  <div id="lightbox">
    <span id="lightbox-close" onclick="closeLightbox()">✕</span>
    <img id="lightbox-img" src="" alt="${t('receipt_large', lang)}" />
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

    // ── Toast 通知系统 ──────────────────────────────────────────────
    window.showToast = function(message, type = 'info') {
      var container = document.getElementById('toast-container');
      if (!container) return;
      var toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(function() {
        toast.classList.add('toast-out');
        setTimeout(function() { toast.remove(); }, 250);
      }, 3000);
    };

    // ── 语言切换逻辑 ──────────────────────────────────────────────
    (function() {
      var LANG_KEY = 'admin-lang';
      var langBtn = document.getElementById('langToggle');
      if (!langBtn) return;

      function applyLang(lang) {
        document.documentElement.lang = lang;
        langBtn.textContent = lang === 'zh' ? 'EN' : '中文';
        localStorage.setItem(LANG_KEY, lang);
      }

      var saved = localStorage.getItem(LANG_KEY) || '${lang}';
      applyLang(saved);

      langBtn.addEventListener('click', function() {
        var current = localStorage.getItem(LANG_KEY) || '${lang}';
        var next = current === 'zh' ? 'en' : 'zh';
        applyLang(next);
        // 重载页面以应用新语言
        var url = window.location.pathname;
        var sep = url.indexOf('?') === -1 ? '?' : '&';
        window.location.href = url + sep + 'lang=' + next;
      });
    })();

    // ── 主题切换逻辑 ──────────────────────────────────────────────
    (function() {
      const STORAGE_KEY = 'admin-theme';
      const btn = document.getElementById('themeToggle');

      // 根据当前主题更新按钮图标
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        btn.textContent = theme === 'light' ? '🌙' : '☀️';
        btn.title = theme === 'light' ? ${JSON.stringify(t('switch_to_dark', lang))} : ${JSON.stringify(t('switch_to_light', lang))};
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

function loginPage(errorMsg = "", lang = "zh") {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${t('admin_login', lang)} — ${t('admin_panel', lang)}</title>
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
    <h1>🔐 ${t('admin_login', lang)}</h1>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ""}
    <form method="POST" action="/admin/login">
      <label>${t('username', lang)}</label>
      <input type="text" name="username" required autofocus placeholder="${t('username', lang)}" />
      <label>${t('password', lang)}</label>
      <input type="password" name="password" required placeholder="${t('password', lang)}" />
      <button type="submit">${t('login_btn', lang)}</button>
    </form>
  </div>
</body>
</html>`;
}

// ─── 首次设置页（无任何账户时展示） ────────────────────────────────────────────

function setupPage(errorMsg = "", lang = "zh") {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${t('init_admin', lang)} — ${t('admin_panel', lang)}</title>
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
    <h1>🚀 ${t('init_admin', lang)}</h1>
    <div class="sub">${t('first_time_setup', lang)}</div>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ""}
    <form method="POST" action="/admin/setup">
      <label>${t('username_hint', lang)}</label>
      <input type="text" name="username" required autofocus minlength="3" pattern="[\\w-]+" placeholder="${t('username', lang)}" />
      <label>${t('password_hint', lang)}</label>
      <input type="password" name="password" required minlength="8" placeholder="${t('password', lang)}" />
      <label>${t('confirm_password', lang)}</label>
      <input type="password" name="confirm" required minlength="8" placeholder="${t('confirm_password', lang)}" />
      <button type="submit">${t('create_admin', lang)}</button>
    </form>
    <div class="hint">${t('setup_hint', lang)}</div>
  </div>
</body>
</html>`;
}

// ─── 用户管理页 ────────────────────────────────────────────────────────────────

function usersPage(users, currentUser, flash = "", lang = "zh") {
  const rows = users.map(u => {
    const isSelf = u.username === currentUser;
    const deleteBtn = isSelf
      ? `<button class="btn" disabled title="${t('cannot_delete_self', lang)}">🚫 ${t('delete', lang)}</button>`
      : `<form class="inline" method="POST" action="/admin/users/${encodeURIComponent(u.username)}/delete"
              onsubmit="return confirm('${t('confirm_delete', lang, { username: u.username })}')">
           <button class="btn btn-reject">${t('delete', lang)}</button>
         </form>`;

    return `<tr>
      <td>${u.username}${isSelf ? ` <span style="color:#888;font-size:11px">(${t('current', lang)})</span>` : ""}</td>
      <td>${u.createdAt ? new Date(u.createdAt).toLocaleString(lang === 'zh' ? "zh-CN" : "en-US") : "—"}</td>
      <td>
        <form class="inline" method="POST" action="/admin/users/${encodeURIComponent(u.username)}/reset-password"
              onsubmit="return promptReset(this, '${u.username}')">
          <input type="hidden" name="newPassword" id="rp-${u.username}" />
          <button type="submit" class="btn btn-primary">${t('reset_password', lang)}</button>
        </form>
        ${deleteBtn}
      </td>
    </tr>`;
  }).join("");

  const content = `
    ${flash ? `<div style="background:#e6f9f0;border-left:4px solid #10b981;padding:10px 14px;border-radius:4px;margin-bottom:16px;font-size:13px">${flash}</div>` : ""}
    <div class="toolbar">
      <a href="/admin/users/new" class="btn btn-primary">＋ ${t('new_user', lang)}</a>
    </div>
    <table>
      <thead><tr><th>${t('username', lang)}</th><th>${t('created_at', lang)}</th><th>${t('actions', lang)}</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" style="text-align:center;color:#aaa">${t('no_users', lang)}</td></tr>`}</tbody>
    </table>
    <script>
      function promptReset(form, username) {
        // 翻译模板在服务端注入，{username} 在客户端运行时替换，避免 XSS 且保持动态插值
        var tpl = ${JSON.stringify(t('prompt_new_password', lang))};
        var pwd = prompt(tpl.replace('{username}', username));
        if (!pwd || pwd.length < 8) { alert(${JSON.stringify(t('password_min_8', lang))}); return false; }
        form.querySelector('#rp-' + username).value = pwd;
        return true;
      }
    </script>`;

  return htmlLayout(t('manage_users', lang), content, '/admin/users', lang);
}

// ─── 新建用户页 ────────────────────────────────────────────────────────────────

function newUserPage(errorMsg = "", lang = "zh") {
  const content = `
    ${errorMsg ? `<div style="background:#fff0f0;border-left:4px solid #c0392b;padding:10px 14px;border-radius:4px;margin-bottom:16px;font-size:13px">${errorMsg}</div>` : ""}
    <form method="POST" action="/admin/users/new" style="max-width:400px;background:#fff;padding:32px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08)">
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:13px;color:#555;margin-bottom:6px">${t('username_hint', lang)}</label>
        <input type="text" name="username" required minlength="3" pattern="[\\w-]+"
               style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px" placeholder="${t('username', lang)}" />
      </div>
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:13px;color:#555;margin-bottom:6px">${t('password_hint', lang)}</label>
        <input type="password" name="password" required minlength="8"
               style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px" placeholder="${t('password', lang)}" />
      </div>
      <div style="margin-bottom:24px">
        <label style="display:block;font-size:13px;color:#555;margin-bottom:6px">${t('confirm_password', lang)}</label>
        <input type="password" name="confirm" required minlength="8"
               style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px" placeholder="${t('confirm_password', lang)}" />
      </div>
      <div style="display:flex;gap:12px">
        <button type="submit" class="btn btn-primary" style="padding:10px 24px">${t('create_user_btn', lang)}</button>
        <a href="/admin/users" class="btn btn-logout" style="padding:10px 24px">${t('cancel', lang)}</a>
      </div>
    </form>`;
  return htmlLayout(t('create_user_title', lang), content, '/admin/users', lang);
}

// ─── QR 码页（无需登录，供初始化时扫码用） ────────────────────────────────────

function qrPage(lang = "zh") {
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
         ${t('initializing', lang)}
       </div>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${t('scan_login', lang)} — ${t('admin_panel', lang)}</title>
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
    <span class="brand">⚙ ${t('admin_panel', lang)}</span>
    <span style="color:#fca5a5;font-size:12px"><span class="status-dot"></span>${t('disconnected', lang)}</span>
  </nav>
  <div class="container">
    <div class="card">
      <h2>📱 ${t('connect_whatsapp', lang)}</h2>

      <!-- Tab 切换按钮 -->
      <div class="tabs">
        <button class="tab-btn active" onclick="switchTab('qr', this)">${t('scan_qr', lang)}</button>
        <button class="tab-btn" onclick="switchTab('pairing', this)">${t('pairing_code', lang)}</button>
      </div>

      <!-- Tab A：QR 码 -->
      <div id="tab-qr" class="tab-panel active">
        <div style="margin:0 0 16px;display:flex;justify-content:center">
          ${qrContent}
        </div>
        <div class="hint">
          ${t('qr_hint', lang)}<br>
          <small>${t('qr_refresh', lang)}</small>
        </div>
      </div>

      <!-- Tab B：配对码 -->
      <div id="tab-pairing" class="tab-panel">
        <div class="phone-input-group">
          <input
            type="text" id="phone-input" class="phone-input"
            placeholder="${t('phone_placeholder', lang)}"
            maxlength="15" inputmode="numeric"
          />
          <button class="btn-pairing" id="get-code-btn" onclick="requestCode()">${t('get_code', lang)}</button>
        </div>

        <div class="code-display" id="code-display">
          <span class="code-placeholder" id="code-placeholder">${t('code_placeholder', lang)}</span>
          <span class="code-value" id="code-value" style="display:none"></span>
        </div>

        <div class="error-msg" id="error-msg"></div>

        <div class="steps">
          <p>📌 ${t('how_to_use', lang)}</p>
          <ol>
            <li>${t('step1', lang)}</li>
            <li>${t('step2', lang)}</li>
            <li>${t('step3', lang)}</li>
            <li>${t('step4', lang)}</li>
          </ol>
        </div>
      </div>
    </div>
  </div>
  <script>
    // ─── i18n 变量注入 ─────────────────────────────────
    var L = '${lang}';
    var T = {
      requesting: ${JSON.stringify(t('requesting', lang))},
      fetching: ${JSON.stringify(t('fetching', lang))},
      refetch: ${JSON.stringify(t('refetch', lang))},
      network_error: ${JSON.stringify(t('network_error', lang))},
      code_placeholder: ${JSON.stringify(t('code_placeholder', lang))},
    };

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
      codePlaceholder.textContent = T.requesting;

      btn.disabled = true;
      btn.textContent = T.fetching;

      try {
        const res = await fetch('/admin/request-pairing-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        });
        const data = await res.json();

        if (!res.ok) {
          errEl.textContent = data.error || ${JSON.stringify(t('network_error', lang))};
          errEl.style.display = 'block';
          codePlaceholder.textContent = T.code_placeholder;
        } else {
          // 展示配对码
          codeVal.textContent = data.code;
          codeVal.style.display = 'block';
          codePlaceholder.style.display = 'none';
        }
      } catch (e) {
        errEl.textContent = T.network_error;
        errEl.style.display = 'block';
        codePlaceholder.textContent = T.code_placeholder;
      } finally {
        btn.disabled = false;
        btn.textContent = T.refetch;
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
          // WhatsApp 认证成功；跳登录页，而非直接跳 /admin
          // 若后台 session 已存在，服务端会自动 redirect 到主页（零用户感知）
          // 若 session 不存在，用户看到登录表单而非神秘报错，UX 清晰
          window.location.href = '/admin/login';
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

// ─── i18n 翻译字典 ─────────────────────────────────────────────────────────────

const TRANSLATIONS = {
  zh: {
    // 通用
    admin_panel: "管理后台",
    connected: "已连接",
    disconnected: "未连接",
    receipt_review: "收据审核",
    download_excel: "下载 Excel",
    user_management: "用户管理",
    switch_to_light: "切换到浅色模式",
    switch_to_dark: "切换到深色模式",
    logout: "退出",
    switch_language: "切换语言",
    lang_zh: "中文",
    lang_en: "EN",
    page_previous: "上一页",
    page_next: "下一页",
    page_info: "第 {current} 页，共 {total} 页",

    // 登录页
    admin_login: "管理后台登录",
    username: "用户名",
    password: "密码",
    login_btn: "登 录",

    // 设置页
    init_admin: "初始化管理后台",
    first_time_setup: "首次使用，请创建管理员账号",
    username_hint: "用户名（至少 3 位，字母/数字/下划线）",
    password_hint: "密码（至少 8 位）",
    confirm_password: "确认密码",
    create_admin: "创建管理员账号",
    setup_hint: "此页面只在尚无账户时出现，创建后自动消失",

    // 用户管理
    manage_users: "用户管理",
    new_user: "新建用户",
    created_at: "创建时间",
    actions: "操作",
    no_users: "暂无用户",
    current: "当前",
    cannot_delete_self: "不能删除当前登录账户",
    delete: "删除",
    reset_password: "重置密码",
    confirm_delete: "确认删除用户 {username}？",
    prompt_new_password: "请输入 {username} 的新密码（至少 8 位）：",
    password_min_8: "密码至少 8 位",
    create_user_title: "新建用户",
    create_user_btn: "创建用户",
    cancel: "取消",
    user_created: "用户创建成功",
    password_reset_ok: "密码重置成功",
    user_deleted: "用户已删除",

    // 收据页
    receipt_audit: "收据审核",
    group_receipts: "张收据",
    collapse: "折叠",
    expand: "展开",
    no_receipts: "暂无收据记录",
    total: "总计",
    pending: "待审核",
    ai_extracted: "AI已提取",
    approved: "已通过",
    rejected: "已拒绝",
    search_placeholder: "搜索手机号/IC号...",
    all_statuses: "全部状态",
    result_count: "共 {count} 条",
    col_num: "#",
    col_submit_time: "提交时间",
    col_phone: "手机号",
    col_ic: "身份证号",
    col_receipt_img: "收据图片",
    col_status: "状态",
    col_ai_result: "AI 提取结果",
    col_actions: "操作 / 记录",
    receipt_large: "收据大图",

    // QR 页面
    scan_login: "扫码登录",
    connect_whatsapp: "连接 WhatsApp",
    scan_qr: "扫描二维码",
    pairing_code: "配对码登录",
    qr_hint: "用 WhatsApp 扫码后页面自动跳转",
    qr_refresh: "二维码约每 20 秒刷新一次",
    phone_placeholder: "601234567890（含区号，纯数字）",
    get_code: "获取配对码",
    code_placeholder: "点击上方按钮获取配对码",
    requesting: "正在请求配对码…",
    fetching: "请求中…",
    refetch: "重新获取",
    network_error: "网络错误，请检查连接后重试",
    how_to_use: "如何使用配对码",
    step1: "打开手机 WhatsApp",
    step2: "进入「设置」→「已连接的设备」",
    step3: "点击「用手机号码连接」",
    step4: "输入上方显示的 8 位配对码",
    initializing: "正在初始化，请稍候…",
    phone_error: "手机号格式错误，请输入含区号的纯数字（如 601234567890）",
    already_connected: "WhatsApp 已连接，无需配对",
    not_ready: "WhatsApp 客户端尚未就绪，请等待初始化完成后重试（通常需要 10-20 秒）",

    // 状态标签
    status_pending_review: "待 AI 提取",
    status_ai_extracted: "待发消息",
    status_confirmed: "已发送",
    status_rejected: "已拒绝",
    status_waiting_user_reply: "等待用户回复",

    // 操作按钮和提示
    ai_extract: "AI 提取",
    ai_amount: "金额",
    ai_summary: "摘要",
    extracting: "识别中…",
    ai_extract_failed: "AI 提取失败：",
    network_error_retry: "网络错误，请重试",
    message_placeholder: "输入要发给用户的消息…",
    send_to_user: "发送给用户",
    reject: "拒绝",
    reject_note: "拒绝原因（可选）",
    confirm_reject: "确认拒绝此收据？",
    sent_at: "发送于",
    rejected_at: "拒绝于",
    cant_send: "WhatsApp 尚未连接，请先扫码",
    message_required: "消息内容不能为空",
    send_not_allowed: "操作不允许：当前状态为 {status}，只有 ai_extracted 状态可发送",
    download_fail: "下载失败：",
    load_fail: "加载失败：",
    password_mismatch: "两次密码输入不一致",
    login_error: "用户名或密码错误，请重试",
    login_fail: "登录失败，请重试",
    receipt_not_found: "收据记录不存在",
    invalid_status: "当前状态 {status} 不可触发 AI 提取",
    attempt_limit: "尝试次数过多，请 15 分钟后重试",
    image_not_found: "图片不存在",
    ai_recognition_fail: "AI 识别失败：",
    toast_send_success: "消息已发送",
    toast_reject_success: "收据已拒绝",
    toast_ai_success: "AI 提取成功",
    toast_error: "操作失败",
    sending: "发送中…",
    send_fail: "发送失败：",
    reject_fail: "拒绝失败：",
  },
  en: {
    // Common
    admin_panel: "Admin Panel",
    connected: "Connected",
    disconnected: "Disconnected",
    receipt_review: "Receipt Review",
    download_excel: "Download Excel",
    user_management: "User Management",
    switch_to_light: "Switch to Light Mode",
    switch_to_dark: "Switch to Dark Mode",
    logout: "Logout",
    switch_language: "Switch Language",
    lang_zh: "中文",
    lang_en: "EN",
    page_previous: "Previous",
    page_next: "Next",
    page_info: "Page {current} of {total}",

    // Login
    admin_login: "Admin Login",
    username: "Username",
    password: "Password",
    login_btn: "LOG IN",

    // Setup
    init_admin: "Initialize Admin Panel",
    first_time_setup: "First time setup — create an admin account",
    username_hint: "Username (min 3 chars, letters/numbers/underscores)",
    password_hint: "Password (min 8 characters)",
    confirm_password: "Confirm Password",
    create_admin: "Create Admin Account",
    setup_hint: "This page only appears when no accounts exist. It disappears after setup.",

    // User Management
    manage_users: "User Management",
    new_user: "New User",
    created_at: "Created At",
    actions: "Actions",
    no_users: "No users yet",
    current: "current",
    cannot_delete_self: "Cannot delete currently logged-in account",
    delete: "Delete",
    reset_password: "Reset Password",
    confirm_delete: "Confirm delete user {username}?",
    prompt_new_password: "Enter new password for {username} (min 8 chars):",
    password_min_8: "Password must be at least 8 characters",
    create_user_title: "Create User",
    create_user_btn: "Create User",
    cancel: "Cancel",
    user_created: "User created successfully",
    password_reset_ok: "Password reset successfully",
    user_deleted: "User deleted",

    // Receipts
    receipt_audit: "Receipt Audit",
    group_receipts: "receipts",
    collapse: "Collapse",
    expand: "Expand",
    no_receipts: "No receipt records yet",
    total: "Total",
    pending: "Pending",
    ai_extracted: "AI Extracted",
    approved: "Approved",
    rejected: "Rejected",
    search_placeholder: "Search phone/IC number...",
    all_statuses: "All Statuses",
    result_count: "{count} results",
    col_num: "#",
    col_submit_time: "Submitted",
    col_phone: "Phone",
    col_ic: "IC Number",
    col_receipt_img: "Receipt",
    col_status: "Status",
    col_ai_result: "AI Result",
    col_actions: "Actions / Record",
    receipt_large: "Receipt image",

    // QR Page
    scan_login: "Scan to Login",
    connect_whatsapp: "Connect WhatsApp",
    scan_qr: "Scan QR Code",
    pairing_code: "Pairing Code",
    qr_hint: "Scan with WhatsApp — page will redirect automatically",
    qr_refresh: "QR code refreshes every ~20 seconds",
    phone_placeholder: "601234567890 (with country code, digits only)",
    get_code: "Get Code",
    code_placeholder: "Click above to get pairing code",
    requesting: "Requesting pairing code…",
    fetching: "Requesting…",
    refetch: "Refetch",
    network_error: "Network error, check connection and retry",
    how_to_use: "How to Use Pairing Code",
    step1: "Open WhatsApp on your phone",
    step2: "Go to Settings → Linked Devices",
    step3: "Tap \"Link with phone number\"",
    step4: "Enter the 8-digit code shown above",
    initializing: "Initializing, please wait…",
    phone_error: "Invalid phone number. Enter digits with country code (e.g. 601234567890)",
    already_connected: "WhatsApp already connected, no pairing needed",
    not_ready: "WhatsApp client not ready yet. Wait for initialization (usually 10-20s)",

    // Status labels
    status_pending_review: "Pending AI",
    status_ai_extracted: "Pending Send",
    status_confirmed: "Sent",
    status_rejected: "Rejected",
    status_waiting_user_reply: "Waiting Reply",

    // Actions & prompts
    ai_extract: "AI Extract",
    ai_amount: "Amount",
    ai_summary: "Summary",
    extracting: "Processing…",
    ai_extract_failed: "AI extraction failed: ",
    network_error_retry: "Network error, please retry",
    message_placeholder: "Type message to send to user…",
    send_to_user: "Send to User",
    reject: "Reject",
    reject_note: "Reject reason (optional)",
    confirm_reject: "Confirm reject this receipt?",
    sent_at: "Sent at",
    rejected_at: "Rejected at",
    cant_send: "WhatsApp not connected — scan QR first",
    message_required: "Message content cannot be empty",
    send_not_allowed: "Operation not allowed: current status is {status}, only ai_extracted can send",
    download_fail: "Download failed: ",
    load_fail: "Load failed: ",
    password_mismatch: "Passwords do not match",
    login_error: "Invalid username or password",
    login_fail: "Login failed, please retry",
    receipt_not_found: "Receipt record not found",
    invalid_status: "Current status {status} cannot trigger AI extraction",
    attempt_limit: "Too many attempts, please retry in 15 minutes",
    image_not_found: "Image not found",
    ai_recognition_fail: "AI recognition failed: ",
    toast_send_success: "Message sent successfully",
    toast_reject_success: "Receipt rejected",
    toast_ai_success: "AI extraction successful",
    toast_error: "Operation failed",
    sending: "Sending…",
    send_fail: "Send failed: ",
    reject_fail: "Reject failed: ",
  },
};

/**
 * 根据 key 和语言获取翻译文本
 * @param {string} key - 翻译键
 * @param {string} [lang='zh'] - 语言代码
 * @param {object} [params] - 模板参数 {username, count, status}
 * @returns {string} 翻译后的文本
 */
function t(key, lang = "zh", params = {}) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.zh;
  let text = dict[key] || TRANSLATIONS.zh[key] || key;
  // 替换模板参数 {xxx}
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(`{${k}}`, String(v));
  }
  return text;
}

/**
 * 渲染单条收据的 AI 结果摘要（ai_extracted / confirmed 时显示）
 * 只显示金额和图片摘要，不显示合格/不合格判定（由人工决定）
 */
function _renderAiResult(aiResult, lang = "zh") {
  if (!aiResult) return '<span style="color:#aaa;font-size:12px">—</span>';
  return `<div class="ai-result">
    <strong>${t('ai_amount', lang)}：</strong>RM ${escapeHtml(aiResult.amount ?? "—")}<br>
    <strong>${t('ai_summary', lang)}：</strong>${escapeHtml(aiResult.summary || "—")}
  </div>`;
}

/**
 * 渲染行内操作区（发送表单 + AI 提取按钮）— 直接在表格行内可见
 */
function renderInlineActions(r, lang = "zh") {
  if (r.status === "pending_review") {
    return `<button class="btn btn-ai" onclick="aiExtract('${r.id}', this)">🤖 ${t('ai_extract', lang)}</button>`;
  }
  return `<form class="send-form" id="send-form-${r.id}" onsubmit="return handleSend(event, '${r.id}')">
    <textarea name="message" id="send-msg-${r.id}" placeholder="${t('message_placeholder', lang)}" required rows="2"></textarea>
    <button type="submit" class="btn btn-send" id="send-btn-${r.id}">📤 ${t('send_to_user', lang)}</button>
  </form>`;
}

/**
 * 构建展开面板内容（仅 AI 结果 + 状态历史，不含发送表单）
 */
function buildExpandPanel(r, lang = "zh") {
  const locale = lang === 'zh' ? "zh-CN" : "en-US";
  let html = "";

  // AI 结果区
  if (r.aiResult) {
    html += `<div class="expand-section">
      <div class="expand-label">🤖 ${t('ai_summary', lang)}</div>
      <div class="ai-result">
        <strong>${t('ai_amount', lang)}</strong> RM ${escapeHtml(r.aiResult.amount ?? "—")}<br>
        ${escapeHtml(r.aiResult.summary || "—")}
      </div>
    </div>`;
  }

  // 状态相关操作区
  if (r.status === "ai_extracted") {
    html += `<div class="expand-section">
      <div class="expand-label">❌ ${t('reject', lang)}</div>
      <form class="reject-form" method="POST" action="/admin/receipts/${r.id}/reject"
            onsubmit="return handleReject(event, '${r.id}')">
        <input name="note" placeholder="${t('reject_note', lang)}"
               onkeydown="if(event.key==='Enter'){event.preventDefault();this.form.requestSubmit();}" />
        <button type="submit" class="btn btn-reject" id="reject-btn-${r.id}">❌ ${t('reject', lang)}</button>
      </form>
    </div>`;
  }

  if (r.status === "confirmed") {
    const sentTime = r.sentAt ? new Date(r.sentAt).toLocaleString(locale) : "—";
    const sentMsg  = r.sentMessage ? `<div class="sent-msg">${escapeHtml(r.sentMessage)}</div>` : "";
    html += `<div class="expand-section">
      <div class="expand-label">✓ ${t('sent_at', lang)}</div>
      <div class="sent-record">${sentMsg}<span class="sent-time">${sentTime}</span></div>
    </div>`;
  }

  if (r.status === "rejected") {
    const rejectTime = r.reviewedAt ? new Date(r.reviewedAt).toLocaleString(locale) : "—";
    const rejectNote = r.reviewNote ? `<div class="reject-note">${escapeHtml(r.reviewNote)}</div>` : "";
    html += `<div class="expand-section">
      <div class="expand-label">❌ ${t('rejected_at', lang)}</div>
      ${rejectNote}<span style="color:#aaa;font-size:12px">${rejectTime}</span>
    </div>`;
  }

  if (r.status === "waiting_user_reply") {
    const sentTime = r.sentAt ? new Date(r.sentAt).toLocaleString(locale) : "—";
    const sentMsg  = r.sentMessage ? `<div class="sent-msg">${escapeHtml(r.sentMessage)}</div>` : "";
    html += `<div class="expand-section">
      <div class="expand-label">⏳ ${t('sent_at', lang)}</div>
      <div class="sent-record">${sentMsg}<span class="sent-time">${sentTime}</span></div>
    </div>`;
  }

  return html;
}

/**
 * 渲染单行操作区（保留向后兼容，但不再在表格中使用）
 */
function _renderActions(r, lang = "zh") {
  const locale = lang === 'zh' ? "zh-CN" : "en-US";
  let actionsHtml = "";

  // pending_review：显示 AI 提取按钮
  if (r.status === "pending_review") {
    actionsHtml += `<button class="btn btn-ai" onclick="aiExtract('${r.id}', this)">🤖 ${t('ai_extract', lang)}</button>`;
  }

  // ai_extracted：显示拒绝按钮（发消息已通用化，在下方统一渲染）
  if (r.status === "ai_extracted") {
    actionsHtml += `<form class="reject-form" method="POST" action="/admin/receipts/${r.id}/reject"
          onsubmit="return confirm('${t('confirm_reject', lang)}')">
      <input name="note" placeholder="${t('reject_note', lang)}"
             onkeydown="if(event.key==='Enter'){event.preventDefault();this.form.requestSubmit();}" />
      <button type="submit" class="btn btn-reject">❌ ${t('reject', lang)}</button>
    </form>`;
  }

  // confirmed：显示已发送记录
  if (r.status === "confirmed") {
    const sentTime = r.sentAt ? new Date(r.sentAt).toLocaleString(locale) : "—";
    const sentMsg  = r.sentMessage
      ? `<div class="sent-msg">${escapeHtml(r.sentMessage)}</div>`
      : "";
    actionsHtml += `<div class="sent-record">
      ${sentMsg}
      <span class="sent-time">✓ ${t('sent_at', lang)} ${sentTime}</span>
    </div>`;
  }

  // rejected：显示拒绝记录
  if (r.status === "rejected") {
    const rejectTime = r.reviewedAt ? new Date(r.reviewedAt).toLocaleString(locale) : "—";
    const rejectNote = r.reviewNote
      ? `<div class="reject-note">${escapeHtml(r.reviewNote)}</div>`
      : "";
    actionsHtml += `<div>${rejectNote}<span style="color:#aaa;font-size:12px">${t('rejected_at', lang)} ${rejectTime}</span></div>`;
  }

  // waiting_user_reply：显示上次发送记录（等待用户回复中）
  if (r.status === "waiting_user_reply") {
    const sentTime = r.sentAt ? new Date(r.sentAt).toLocaleString(locale) : "—";
    const sentMsg  = r.sentMessage
      ? `<div class="sent-msg">${escapeHtml(r.sentMessage)}</div>`
      : "";
    actionsHtml += `<div class="sent-record">
      ${sentMsg}
      <span class="sent-time">⏳ ${t('sent_at', lang)} ${sentTime}</span>
    </div>`;
  }

  // 所有状态通用：发送消息给用户的表单
  actionsHtml += `<form class="send-form" method="POST" action="/admin/receipts/${r.id}/send-message">
    <textarea name="message" placeholder="${t('message_placeholder', lang)}" required></textarea>
    <button type="submit" class="btn btn-send">📤 ${t('send_to_user', lang)}</button>
  </form>`;

  return actionsHtml;
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

function buildPagination(currentPage, totalPages, q, status, lang) {
  if (totalPages <= 1) return '';

  const getUrl = (p) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    params.set('page', p);
    return '/admin?' + params.toString();
  };

  let html = '<div class="pagination-container" style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; padding:10px 0;">';
  
  html += '<div class="page-info" style="color:var(--text-muted); font-size:13px;">' + t('page_info', lang, { current: currentPage, total: totalPages }) + '</div>';
  
  html += '<div class="page-buttons" style="display:flex; gap:6px;">';
  
  if (currentPage > 1) {
    html += '<a href="' + getUrl(currentPage - 1) + '" class="btn btn-page">' + t('page_previous', lang) + '</a>';
  } else {
    html += '<button class="btn btn-page" disabled>' + t('page_previous', lang) + '</button>';
  }

  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, currentPage + 2);
  
  if (currentPage <= 3) {
    endPage = Math.min(totalPages, 5);
  }
  if (currentPage >= totalPages - 2) {
    startPage = Math.max(1, totalPages - 4);
  }

  if (startPage > 1) {
    html += '<a href="' + getUrl(1) + '" class="btn btn-page">1</a>';
    if (startPage > 2) {
      html += '<span style="color:var(--text-muted); padding:5px;">...</span>';
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    if (i === currentPage) {
      html += '<button class="btn btn-page active" style="background:var(--accent-primary); color:#fff; border-color:var(--accent-primary);">' + i + '</button>';
    } else {
      html += '<a href="' + getUrl(i) + '" class="btn btn-page">' + i + '</a>';
    }
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += '<span style="color:var(--text-muted); padding:5px;">...</span>';
    }
    html += '<a href="' + getUrl(totalPages) + '" class="btn btn-page">' + totalPages + '</a>';
  }

  if (currentPage < totalPages) {
    html += '<a href="' + getUrl(currentPage + 1) + '" class="btn btn-page">' + t('page_next', lang) + '</a>';
  } else {
    html += '<button class="btn btn-page" disabled>' + t('page_next', lang) + '</button>';
  }

  html += '</div></div>';
  return html;
}

function receiptsPage(receipts, lang = "zh", currentPage = 1, totalPages = 1, searchQuery = "", statusFilter = "", allReceipts = null) {
  if (receipts.length === 0) {
    return htmlLayout(t('receipt_audit', lang), `<div class="empty">${t('no_receipts', lang)}</div>`, '/admin', lang);
  }

  const VALID_RECEIPT_STATUSES = new Set(['pending_review', 'ai_extracted', 'confirmed', 'rejected', 'waiting_user_reply']);

  const statsSource = allReceipts || receipts;
  const stats = statsSource.reduce((acc, r) => {
    const s = r.status || 'pending_review';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  const statsCards = `
    <div class="stats-cards">
      <div class="stat-card">
        <div class="stat-label">${t('total', lang)}</div>
        <div class="stat-value">${statsSource.length}</div>
      </div>
      <div class="stat-card stat-pending">
        <div class="stat-label">${t('pending', lang)}</div>
        <div class="stat-value">${stats.pending_review || 0}</div>
      </div>
      <div class="stat-card stat-ai">
        <div class="stat-label">${t('ai_extracted', lang)}</div>
        <div class="stat-value">${stats.ai_extracted || 0}</div>
      </div>
      <div class="stat-card stat-confirmed">
        <div class="stat-label">${t('approved', lang)}</div>
        <div class="stat-value">${stats.confirmed || 0}</div>
      </div>
      <div class="stat-card stat-rejected">
        <div class="stat-label">${t('rejected', lang)}</div>
        <div class="stat-value">${stats.rejected || 0}</div>
      </div>
      <div class="stat-card stat-waiting">
        <div class="stat-label">${t('status_waiting_user_reply', lang)}</div>
        <div class="stat-value">${stats.waiting_user_reply || 0}</div>
      </div>
    </div>
  `;

  const locale = lang === 'zh' ? "zh-CN" : "en-US";

  // Group receipts by phone number
  const groups = {};
  const phoneIsLid = {};
  receipts.forEach((r, idx) => {
    const rawPhone = r.phone || "—";
    const isLid = rawPhone.includes("@lid");
    const phone = rawPhone.replace(/@[^@]+$/, "");
    if (!groups[phone]) {
      groups[phone] = [];
      phoneIsLid[phone] = isLid;
    }
    // Keep original index for display
    groups[phone].push({ r, idx });
  });

  const badgeMap = {
    pending_review: { emoji: '🟡', class: 'badge-pending_review' },
    ai_extracted: { emoji: '🔵', class: 'badge-ai_extracted' },
    confirmed: { emoji: '🟢', class: 'badge-confirmed' },
    rejected: { emoji: '🔴', class: 'badge-rejected' },
    waiting_user_reply: { emoji: '⏳', class: 'badge-waiting_user_reply' }
  };

  const groupEntries = Object.entries(groups);
  const paginatedGroups = {};
  let currentReceiptCount = 0;
  let pageCounter = 1;
  
  for (const [phone, groupReceipts] of groupEntries) {
    if (pageCounter === currentPage) {
      paginatedGroups[phone] = groupReceipts;
    }
    currentReceiptCount += groupReceipts.length;
    if (currentReceiptCount >= 20) {
      pageCounter++;
      currentReceiptCount = 0;
    }
  }

  let rows = "";
  for (const [phone, groupReceipts] of Object.entries(paginatedGroups)) {
    // Generate group summary badges
    const counts = {};
    groupReceipts.forEach(({ r }) => {
      const s = r.status || 'pending_review';
      counts[s] = (counts[s] || 0) + 1;
    });
    
    let badgesHtml = "";
    for (const [status, count] of Object.entries(counts)) {
      if (badgeMap[status]) {
        badgesHtml += `<span class="badge ${badgeMap[status].class}" style="margin-right:4px;">${badgeMap[status].emoji} ${count}</span>`;
      }
    }

    const lidBadge = phoneIsLid[phone]
      ? `<span class="badge" style="margin-left:8px;background:rgba(168,85,247,0.15);color:#c084fc;border:1px solid rgba(168,85,247,0.3);font-size:10px">LID</span>`
      : "";

    // Group header row
    rows += `<tr class="group-header" data-phone="${escapeHtml(phone)}" data-collapsed="false" onclick="toggleGroup('${escapeHtml(phone)}')" style="cursor:pointer; background:var(--bg-surface); border-top: 2px solid var(--border);">
      <td colspan="8">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong style="font-family:monospace; font-size:14px;">${escapeHtml(phone)}</strong>${lidBadge}
            <span style="margin-left:10px; color:var(--text-muted); font-size:13px;">${groupReceipts.length} ${t('group_receipts', lang)}</span>
          </div>
          <div>
            ${badgesHtml}
            <span class="toggle-icon" id="toggle-icon-${escapeHtml(phone)}" style="margin-left:10px; display:inline-block; width:16px; text-align:center;" title="${t('collapse', lang)} / ${t('expand', lang)}">▼</span>
          </div>
        </div>
      </td>
    </tr>`;

    // Individual rows
    rows += groupReceipts.map(({ r, idx }) => {
      const statusBadge = `<span class="badge badge-${r.status}">${t('status_' + r.status, lang) || r.status}</span>`;
      const thumbSrc = `/admin/images/${r.imageFilename}`;
      const thumb = `<img class="thumb" src="${thumbSrc}" alt="${t('receipt_large', lang)}" onclick="event.stopPropagation();openLightbox('${thumbSrc}')" />`;

      const safeStatus = VALID_RECEIPT_STATUSES.has(r.status) ? r.status : '';
      const phoneDisplay = phoneIsLid[phone]
        ? `${escapeHtml(phone)} <span style="color:#c084fc;font-size:10px">LID</span>`
        : escapeHtml(phone);

      // Expand panel content (AI result + actions)
      const panelContent = buildExpandPanel(r, lang);

      return `<tr class="group-row group-row-${escapeHtml(phone)} expandable" data-phone="${escapeHtml(phone)}" data-status="${safeStatus}" id="row-${r.id}" onclick="toggleRow('${r.id}')">
      <td><span class="expand-chevron">▶</span>${receipts.length - idx}</td>
      <td>${r.submittedAt ? new Date(r.submittedAt).toLocaleString(locale) : "—"}</td>
      <td style="font-size:12px">${phoneDisplay}</td>
      <td style="font-size:12px">${r.ic || "—"}</td>
      <td>${thumb}</td>
      <td>${statusBadge}</td>
      <td style="max-width:260px" onclick="event.stopPropagation()">${renderInlineActions(r, lang)}</td>
    </tr>
    <tr class="expand-row" id="expand-${r.id}">
      <td colspan="7">
        <div class="expand-panel">${panelContent}</div>
      </td>
    </tr>`;
    }).join("");
  }

  const content = `
    ${statsCards}
    <div class="toolbar">
      <input type="text" id="searchInput" placeholder="${t('search_placeholder', lang)}" value="${escapeHtml(searchQuery)}"
        style="padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);flex:1;min-width:200px;max-width:300px">
      <select id="statusFilter" style="padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary)">
        <option value="" ${statusFilter === '' ? 'selected' : ''}>${t('all_statuses', lang)}</option>
        <option value="pending_review" ${statusFilter === 'pending_review' ? 'selected' : ''}>${t('status_pending_review', lang)}</option>
        <option value="ai_extracted" ${statusFilter === 'ai_extracted' ? 'selected' : ''}>${t('status_ai_extracted', lang)}</option>
        <option value="confirmed" ${statusFilter === 'confirmed' ? 'selected' : ''}>${t('status_confirmed', lang)}</option>
        <option value="rejected" ${statusFilter === 'rejected' ? 'selected' : ''}>${t('status_rejected', lang)}</option>
        <option value="waiting_user_reply" ${statusFilter === 'waiting_user_reply' ? 'selected' : ''}>${t('status_waiting_user_reply', lang)}</option>
      </select>
      <span id="resultCount" style="color:var(--text-muted);font-size:13px">${t('result_count', lang, { count: receipts.length })}</span>
    </div>
    <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>${t('col_num', lang)}</th><th>${t('col_submit_time', lang)}</th><th>${t('col_phone', lang)}</th><th>${t('col_ic', lang)}</th><th>${t('col_receipt_img', lang)}</th>
          <th>${t('col_status', lang)}</th><th>${t('col_actions', lang)}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
    ${buildPagination(currentPage, totalPages, searchQuery, statusFilter, lang)}
    <script>
      (function() {
        var searchInput = document.getElementById('searchInput');
        var statusFilter = document.getElementById('statusFilter');
        var resultCount = document.getElementById('resultCount');

        function applyFilter() {
          var q = searchInput.value;
          var status = statusFilter.value;
          var url = new URL(window.location.href);
          if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
          if (status) url.searchParams.set('status', status); else url.searchParams.delete('status');
          url.searchParams.set('page', '1');
          window.location.href = url.toString();
        }

        if (searchInput) {
          searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') applyFilter();
          });
        }
        if (statusFilter) {
          statusFilter.addEventListener('change', applyFilter);
        }
      })();

      // ── 行展开/折叠 ────────────────────────────────────────────
      window.toggleRow = function(id) {
        var panel = document.getElementById('expand-' + id);
        var row = document.getElementById('row-' + id);
        if (!panel || !row) return;
        var isVisible = panel.classList.contains('visible');
        panel.classList.toggle('visible');
        var chevron = row.querySelector('.expand-chevron');
        if (chevron) chevron.classList.toggle('rotated');
      };

      // ── 组折叠 ─────────────────────────────────────────────────
      window.toggleGroup = function(phone) {
        var header = document.querySelector('tr.group-header[data-phone="' + CSS.escape(phone) + '"]');
        if (!header) return;
        var isCollapsed = header.dataset.collapsed === 'true';
        header.dataset.collapsed = isCollapsed ? 'false' : 'true';
        var icon = document.getElementById('toggle-icon-' + CSS.escape(phone));
        if (icon) icon.textContent = isCollapsed ? '▼' : '▶';
        
        document.querySelectorAll('.group-row-' + CSS.escape(phone)).forEach(function(row) {
          row.style.display = isCollapsed ? '' : 'none';
          // 同时隐藏对应的展开面板
          var expandId = 'expand-' + row.id.replace('row-', '');
          var expandRow = document.getElementById(expandId);
          if (expandRow && !isCollapsed) expandRow.classList.remove('visible');
        });
      };

      // ── AJAX 发送消息 ──────────────────────────────────────────
      window.handleSend = async function(e, id) {
        e.preventDefault();
        var form = document.getElementById('send-form-' + id);
        var msgInput = document.getElementById('send-msg-' + id);
        var btn = document.getElementById('send-btn-' + id);
        var message = msgInput.value.trim();
        if (!message) { showToast(${JSON.stringify(t('message_required', lang))}, 'error'); return false; }
        btn.disabled = true;
        btn.textContent = '⏳ ' + ${JSON.stringify(t('sending', lang))};
        try {
          const res = await fetch('/admin/receipts/' + id + '/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'message=' + encodeURIComponent(message),
          });
          if (!res.ok) {
            const text = await res.text();
            showToast(${JSON.stringify(t('send_fail', lang))} + text, 'error');
            btn.disabled = false;
            btn.textContent = '📤 ' + ${JSON.stringify(t('send_to_user', lang))};
            return false;
          }
          showToast(${JSON.stringify(t('toast_send_success', lang))}, 'success');
          setTimeout(function() { window.location.reload(); }, 800);
        } catch (err) {
          showToast(${JSON.stringify(t('network_error_retry', lang))}, 'error');
          btn.disabled = false;
          btn.textContent = '📤 ' + ${JSON.stringify(t('send_to_user', lang))};
        }
        return false;
      };

      // ── AJAX 拒绝收据 ──────────────────────────────────────────
      window.handleReject = async function(e, id) {
        e.preventDefault();
        var form = e.target;
        var btn = document.getElementById('reject-btn-' + id);
        btn.disabled = true;
        btn.textContent = '⏳';
        try {
          const formData = new FormData(form);
          const res = await fetch('/admin/receipts/' + id + '/reject', {
            method: 'POST',
            body: new URLSearchParams(formData),
          });
          if (!res.ok) {
            const text = await res.text();
            showToast(${JSON.stringify(t('reject_fail', lang))} + text, 'error');
            btn.disabled = false;
            btn.textContent = '❌ ' + ${JSON.stringify(t('reject', lang))};
            return false;
          }
          showToast(${JSON.stringify(t('toast_reject_success', lang))}, 'success');
          setTimeout(function() { window.location.reload(); }, 800);
        } catch (err) {
          showToast(${JSON.stringify(t('network_error_retry', lang))}, 'error');
          btn.disabled = false;
          btn.textContent = '❌ ' + ${JSON.stringify(t('reject', lang))};
        }
        return false;
      };

      // ── AI 提取（改用 toast 替代 alert） ───────────────────────
      window.aiExtract = async function(id, btn) {
        btn.disabled = true;
        btn.textContent = '⏳ ' + ${JSON.stringify(t('extracting', lang))};
        try {
          const res = await fetch('/admin/receipts/' + id + '/ai-extract', { method: 'POST' });
          // 先检查 HTTP 状态，再解析 body——5xx 响应体可能是 HTML，直接 res.json() 会抛 SyntaxError
          if (!res.ok) {
            let errMsg = res.statusText;
            try { const d = await res.json(); errMsg = d.error || errMsg; } catch (_) {}
            showToast(${JSON.stringify(t('ai_extract_failed', lang))} + errMsg, 'error');
            btn.disabled = false;
            btn.textContent = '🤖 ' + ${JSON.stringify(t('ai_extract', lang))};
            return;
          }
          const data = await res.json();
          showToast(${JSON.stringify(t('toast_ai_success', lang))}, 'success');
          setTimeout(function() { window.location.reload(); }, 800);
        } catch (e) {
          showToast(${JSON.stringify(t('network_error_retry', lang))}, 'error');
          btn.disabled = false;
          btn.textContent = '🤖 ' + ${JSON.stringify(t('ai_extract', lang))};
        }
      };

      // ── Ctrl+Enter 快捷提交 ────────────────────────────────────
      (function() {
        var textareas = document.querySelectorAll('.send-form textarea');
        textareas.forEach(function(ta) {
          ta.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              var form = ta.closest('form');
              if (form && form.checkValidity()) form.requestSubmit();
            }
          });
        });
      })();
    </script>`;

  return htmlLayout(t('receipt_audit', lang), content, '/admin', lang);
}

/**
 * 从请求中提取语言偏好，优先级：query > cookie > 默认中文
 */
function getLang(req) {
  const validLangs = new Set(['zh', 'en']);
  const fromQuery = req.query && req.query.lang;
  if (fromQuery && validLangs.has(fromQuery)) return fromQuery;
  return 'zh';
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
  // 使用 FileStore 持久化 session，容器重启后登录状态依然有效
  // rolling: true — 每次请求自动续期，真正实现"久不用才踢出"而非"固定 N 小时过期"
  if (!process.env.SESSION_SECRET) {
    logger.warn("未配置 SESSION_SECRET，将使用随机值——重启后 cookie 签名失效，用户须重新登录");
  }
  const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
  const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天，与 cookie.maxAge 对齐
  const SESSION_DIR = path.join(DATA_DIR, "admin_sessions");

  // FileStore 构造函数内部调用同步 fs.mkdirsSync，权限不足或挂载卷未就绪时同步抛出。
  // 捕获后给出明确错误上下文，避免进程崩溃日志只有裸 stacktrace。
  let fileStore;
  try {
    fileStore = new FileStore({
      path: SESSION_DIR,
      ttl: SESSION_TTL_SECONDS,
      retries: 1, // 读取失败最多重试 1 次，避免因磁盘 I/O 抖动误判
      // 桥接到 Winston：I/O 重试、JSON 解析失败等内部诊断信息不再被静默吞掉
      logFn: (msg) => logger.warn("[session-file-store]", { msg }),
    });
    // 提升到模块作用域，使 setDisconnected() 可以在 WA 断线时清空所有 sessions
    _sessionStore = fileStore;
  } catch (err) {
    logger.error("FileStore 初始化失败，请检查 SESSION_DIR 是否可写", {
      path: SESSION_DIR,
      error: err.message,
    });
    throw err; // 无法持久化 session 时拒绝启动，避免静默降级为 MemoryStore
  }

  app.use(
    session({
      store: fileStore,
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
        maxAge: SESSION_TTL_SECONDS * 1000, // 7 天无操作后过期
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
      const lang = getLang(req);
      const searchQuery = (req.query.q || "").toLowerCase();
      const statusFilter = req.query.status || "";
      const page = parseInt(req.query.page) || 1;
      
      const allReceipts = receiptStore.getAll();
      let receipts = allReceipts;
      
      if (searchQuery || statusFilter) {
        receipts = allReceipts.filter(r => {
          const text = ((r.phone || '') + ' ' + (r.ic || '')).toLowerCase();
          const matchQ = !searchQuery || text.includes(searchQuery);
          const matchStatus = !statusFilter || r.status === statusFilter;
          return matchQ && matchStatus;
        });
      }
      
      const totalPages = Math.max(1, Math.ceil(receipts.length / 20));
      
      res.send(receiptsPage(receipts, lang, page, totalPages, searchQuery, statusFilter, allReceipts));
    } catch (err) {
      const lang = getLang(req);
      logger.error("加载收据列表失败", { error: err.message });
      res.status(500).send(t('load_fail', lang) + err.message);
    }
  });

  // /admin/receipts 重定向到 /admin（向后兼容旧书签）
  app.get("/admin/receipts", (req, res) => {
    res.redirect("/admin");
  });

  // ── 首次设置（无账户时的引导页）────────────────────────────────────────────

  app.get("/admin/setup", (req, res) => {
    if (!adminUserService.isEmpty()) return res.redirect("/admin/login");
    const lang = getLang(req);
    res.send(setupPage("", lang));
  });

  app.post("/admin/setup", (req, res) => {
    if (!adminUserService.isEmpty()) return res.redirect("/admin/login");
    const { username, password, confirm } = req.body;
    const lang = getLang(req);

    if (password !== confirm) return res.send(setupPage(t('password_mismatch', lang), lang));
    const result = adminUserService.createUser(username, password);
    if (!result.ok) return res.send(setupPage(result.error, lang));

    logger.info("首次设置完成，管理员账号已创建", { username });
    res.redirect("/admin/login");
  });

  // QR 码扫码页（无需登录，Bot 未就绪时供非技术用户扫码）
  app.get("/admin/qr", (req, res) => {
    if (_waConnected) {
      if (req.session && req.session.authenticated) {
        return res.redirect("/admin");
      }
      return res.redirect("/admin/login");
    }
    const lang = getLang(req);
    res.send(qrPage(lang));
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
      return res.status(400).json({ error: "WhatsApp already connected, no pairing needed" });
    }

    // _pairingCodeReady 由 qr 事件触发后置为 true
    // 若尚未进入认证窗口期，拒绝调用，防止 client 抛 "Already authenticated"
    if (!_pairingCodeReady) {
      return res.status(503).json({
        error: "WhatsApp client not ready yet. Wait for initialization (usually 10-20s)",
      });
    }

    try {
      const { requestPairingCode } = require("./bot");
      const code = await requestPairingCode(phone);
      logger.info("配对码已生成", { phone: phone.slice(0, 5) + "****" }); // 手机号脱敏
      res.json({ code });
    } catch (err) {
      // 库内部有时 throw 字符串而非 Error 对象，用 String() 兜底确保完整记录
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error("请求配对码失败", { error: errMsg, stack: err?.stack });
      res.status(500).json({ error: errMsg });
    }
  });

  // WhatsApp 连接状态 API（供 QR 页轮询）
  app.get("/admin/wa-status", (req, res) => {
    res.json({ connected: _waConnected, hasQR: !!_qrBase64 });
  });

  // ── 登录/登出 ──────────────────────────────────────────────────────────────

  app.get("/admin/login", requireSetup, (req, res) => {
    if (req.session.authenticated) return res.redirect("/admin");
    const lang = getLang(req);
    res.send(loginPage("", lang));
  });

  app.post("/admin/login", requireSetup, authLimiter, (req, res) => {
    const { username, password } = req.body;
    const lang = getLang(req);
    if (adminUserService.authenticate(username, password)) {
      req.session.authenticated = true;
      req.session.username = username;
      req.session.save((err) => {
        if (err) {
          logger.error("session 写入失败", { error: String(err) });
          return res.send(loginPage(t('login_fail', lang), lang));
        }
        res.redirect("/admin");
      });
      return;
    }
    res.send(loginPage(t('login_error', lang), lang));
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
    const lang = getLang(req);
    const users = adminUserService.listUsers();
    const flash = req.query.flash || "";
    res.send(usersPage(users, req.session.username, flash, lang));
  });

  app.get("/admin/users/new", requireAuth, (req, res) => {
    const lang = getLang(req);
    res.send(newUserPage("", lang));
  });

  app.post("/admin/users/new", requireAuth, (req, res) => {
    const { username, password, confirm } = req.body;
    const lang = getLang(req);
    if (password !== confirm) return res.send(newUserPage(t('password_mismatch', lang), lang));
    const result = adminUserService.createUser(username, password);
    if (!result.ok) return res.send(newUserPage(result.error, lang));
    logger.info("新管理员账号已创建", { by: req.session.username, newUser: username });
    res.redirect("/admin/users?flash=" + encodeURIComponent(t('user_created', lang)));
  });

  // 重置指定用户密码（管理员操作，无需旧密码）
  app.post("/admin/users/:username/reset-password", requireAuth, (req, res) => {
    const { username } = req.params;
    const { newPassword } = req.body;
    const lang = getLang(req);
    const result = adminUserService.resetPassword(username, newPassword);
    if (!result.ok) return res.redirect(`/admin/users?flash=${encodeURIComponent(t('download_fail', lang) + result.error)}`);
    logger.info("密码已重置", { by: req.session.username, target: username });
    res.redirect("/admin/users?flash=" + encodeURIComponent(t('password_reset_ok', lang)));
  });

  // 删除用户
  app.post("/admin/users/:username/delete", requireAuth, (req, res) => {
    const { username } = req.params;
    const lang = getLang(req);
    const result = adminUserService.deleteUser(username, req.session.username);
    if (!result.ok) return res.redirect(`/admin/users?flash=${encodeURIComponent(t('download_fail', lang) + result.error)}`);
    logger.info("管理员账号已删除", { by: req.session.username, deleted: username });
    res.redirect("/admin/users?flash=" + encodeURIComponent(t('user_deleted', lang)));
  });

  // ── 收据相关路由 ──────────────────────────────────────────────────────────

  // 静态图片服务：将 data/images/ 中的图片暴露给前端缩略图和灯箱
  app.get("/admin/images/:filename", requireAuth, (req, res) => {
    const filename = path.basename(req.params.filename);
    const imagePath = receiptStore.getImagePath(filename);
    const lang = getLang(req);

    if (!fs.existsSync(imagePath)) {
      return res.status(404).send(t('image_not_found', lang));
    }
    res.sendFile(imagePath);
  });

  // AI 提取：读取图片 → 调用 Gemini → 保存结果（JSON API，前端 AJAX 调用）
  app.post("/admin/receipts/:id/ai-extract", requireAuth, apiLimiter, async (req, res) => {
    const { id } = req.params;
    const lang = getLang(req);

    const record = receiptStore.getById(id);
    if (!record) {
      return res.status(404).json({ error: t('receipt_not_found', lang) });
    }
    if (record.status !== "pending_review") {
      return res.status(400).json({ error: t('invalid_status', lang, { status: record.status }) });
    }

    try {
      const imagePath = receiptStore.getImagePath(record.imageFilename);
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString("base64");

      const imageMime = record.imageFilename.endsWith(".png")  ? "image/png"
                      : record.imageFilename.endsWith(".webp") ? "image/webp"
                      : "image/jpeg";
      const aiResult = await processReceipt(base64Image, imageMime);

      if (!aiResult.success) {
        return res.status(502).json({ error: t('ai_recognition_fail', lang) + aiResult.message });
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
    const lang = getLang(req);

    if (!message) {
      return res.status(400).send(t('message_required', lang));
    }

    if (!_client || typeof _client.sendMessage !== "function") {
      return res.status(503).send(t('cant_send', lang));
    }

    try {
      const record = receiptStore.getById(id);
      if (!record) return res.status(404).send(t('receipt_not_found', lang));

      // 不再限制状态，任意状态均可发送消息给用户
      const chatId = record.phone.includes("@") ? record.phone : `${record.phone}@c.us`;

      receiptStore.sendMessageToUser(id, message);
      logger.info("收据状态已更新为 waiting_user_reply，准备发送 WhatsApp", { id, chatId, previousStatus: record.status });

      await _client.sendMessage(chatId, message);
      logger.info("WhatsApp 消息已发送", { id, chatId, messageLength: message.length });

      res.redirect("/admin");
    } catch (err) {
      logger.error("发送消息失败", { id, error: err.message });
      res.status(500).send(t('download_fail', lang) + err.message);
    }
  });

  // ── 拒绝收据（不发 WhatsApp，仅更新内部状态）────────────────────────────────

  app.post("/admin/receipts/:id/reject", requireAuth, (req, res) => {
    const { id } = req.params;
    const note = (req.body.note || "").trim();
    const lang = getLang(req);
    try {
      receiptStore.rejectReceipt(id, note);
      logger.info("收据已拒绝", { id, note });
      res.redirect("/admin");
    } catch (err) {
      logger.error("拒绝收据失败", { id, error: err.message });
      res.status(500).send(t('download_fail', lang) + err.message);
    }
  });

  // ── 下载 Excel ────────────────────────────────────────────────────────────

  app.get("/admin/export", requireAuth, (req, res) => {
    const lang = getLang(req);
    const excelPath = getExcelPath();
    res.download(excelPath, "records.xlsx", (err) => {
      if (err) {
        logger.error("Excel 下载失败", { error: err.message });
        res.status(500).send(t('download_fail', lang) + err.message);
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

module.exports = {
  startAdminServer, setClient, setQR, setPairingCodeReady, setDisconnected,
  // 仅在测试环境暴露内部页面函数，用于语法验证测试
  ...(process.env.NODE_ENV === 'test' && { _receiptsPage: receiptsPage, _usersPage: usersPage, _setupPage: setupPage }),
};
