"use strict";

const state = require("../state");
const { t } = require("../i18n");

function htmlLayout(title, content, currentPath = '', lang = 'zh', cspNonce = '', csrfToken = '') {
  const _waConnected = state.isConnected();
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
  <link rel="stylesheet" href="/admin/static/admin.css" />
  <script src="/admin/static/theme-init.js"></script>
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
        <input type="hidden" name="_csrf" value="${csrfToken}" />
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
  <script nonce="${cspNonce}">
    window.ADMIN_UI = {
      lang: ${JSON.stringify(lang)},
      csrfToken: ${JSON.stringify(csrfToken)},
      switchToDark: ${JSON.stringify(t('switch_to_dark', lang))},
      switchToLight: ${JSON.stringify(t('switch_to_light', lang))}
    };
  </script>
  <script src="/admin/static/admin.js"></script>
</body>
</html>`;
}

module.exports = { htmlLayout };
