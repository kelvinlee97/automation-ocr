"use strict";

const state = require("../state");
const { t } = require("../i18n");

function htmlLayout(title, content, currentPath = '', lang = 'en') {
  const _waConnected = state.isConnected();
  // Dynamically render the navigation bar logo based on current connection status
  const statusBadge = _waConnected
    ? `<span style="color:#86efac;font-size:12px">🟢 ${t('connected', lang)}</span>`
    : `<a href="/admin/qr" style="color:#fca5a5;font-size:12px;text-decoration:none">🔴 ${t('disconnected', lang)}</a>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — ${t('admin_panel', lang)}</title>
  <link rel="stylesheet" href="/admin/static/admin.css" />
  <script src="/admin/static/theme-init.js"></script>
</head>
<body>
  <nav>
    <a href="/admin" class="brand">⚙ ${t('admin_panel', lang)}</a>
    <div class="nav-right">
      ${statusBadge}
      <a href="/admin" class="${currentPath === '/admin' ? 'nav-active' : ''}">📋 ${t('receipt_review', lang)}</a>
      <a href="/admin/feedback" class="${currentPath === '/admin/feedback' ? 'nav-active' : ''}">💬 ${t('feedback', lang)}</a>
      <a href="/admin/export">⬇ ${t('download_excel', lang)}</a>
      <a href="/admin/users" class="${currentPath === '/admin/users' ? 'nav-active' : ''}">👥 ${t('user_management', lang)}</a>
      <button class="theme-toggle" id="themeToggle" title="${t('switch_to_dark', lang)}" aria-label="${t('switch_to_dark', lang)}">🌙</button>
      <form class="inline" method="POST" action="/admin/logout">
        <button class="btn btn-logout" style="margin-left:4px">${t('logout', lang)}</button>
      </form>
    </div>
  </nav>
  <main>
    <h1>${title}</h1>
    ${content}
  </main>
  <!-- Toast notification container -->
  <div id="toast-container"></div>
  <!-- Image lightbox -->
  <div id="lightbox">
    <span id="lightbox-close" onclick="closeLightbox()">✕</span>
    <img id="lightbox-img" src="" alt="${t('receipt_large', lang)}" />
  </div>
  <script>
    window.ADMIN_UI = {
      lang: ${JSON.stringify(lang)},
      switchToDark: ${JSON.stringify(t('switch_to_dark', lang))},
      switchToLight: ${JSON.stringify(t('switch_to_light', lang))}
    };
  </script>
  <script src="/admin/static/admin.js"></script>
</body>
</html>`;
}

module.exports = { htmlLayout };
