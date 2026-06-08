"use strict";

const { t } = require("../i18n");

function loginPage(errorMsg = "", lang = "zh", showSetupLink = false) {
  const bottomLinks = `
    <div class="card-footer">
      ${showSetupLink ? `<a href="/admin/setup" class="footer-link setup-link">🚀 ${t('first_time_setup_link', lang)}</a>` : ""}
      <div class="footer-hint">
        <span class="forgot-pw">${t('forgot_password', lang)}</span>
        <span class="contact-admin">${t('contact_admin', lang)}</span>
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${t('admin_login', lang)} — ${t('admin_panel', lang)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Outfit:wght@300;400;500;600&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Outfit', -apple-system, sans-serif;
      background: radial-gradient(ellipse at 20% 0%, #1a1a2e 0%, #0f0f1a 50%, #050510 100%);
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
      overflow: hidden;
    }

    /* 背景装饰：微弱网格 */
    body::before {
      content: '';
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background-image:
        linear-gradient(rgba(99,102,241,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(99,102,241,0.03) 1px, transparent 1px);
      background-size: 60px 60px;
      pointer-events: none;
    }

    /* 背景装饰：顶部光晕 */
    body::after {
      content: '';
      position: fixed; top: -30%; left: 50%; transform: translateX(-50%);
      width: 800px; height: 800px;
      background: radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%);
      pointer-events: none;
    }

    .card {
      position: relative;
      background: rgba(15, 15, 26, 0.7);
      backdrop-filter: blur(40px);
      -webkit-backdrop-filter: blur(40px);
      border: 1px solid rgba(99, 102, 241, 0.15);
      border-radius: 24px; padding: 48px 40px 36px; width: 380px;
      box-shadow:
        0 0 0 1px rgba(99,102,241,0.05),
        0 4px 6px -1px rgba(0,0,0,0.3),
        0 20px 50px -12px rgba(0,0,0,0.5),
        inset 0 1px 0 rgba(255,255,255,0.04);
      animation: cardIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    @keyframes cardIn {
      from { opacity: 0; transform: translateY(20px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* 卡片顶部微光边框 */
    .card::before {
      content: '';
      position: absolute; top: 0; left: 20%; right: 20%; height: 1px;
      background: linear-gradient(90deg, transparent, rgba(99,102,241,0.4), transparent);
    }

    .logo { text-align: center; margin-bottom: 8px; }
    .logo-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 48px; height: 48px; border-radius: 14px;
      background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.1));
      border: 1px solid rgba(99,102,241,0.25);
      font-size: 22px;
      margin-bottom: 16px;
    }

    h1 {
      font-family: 'Syne', sans-serif;
      font-size: 22px; font-weight: 800; letter-spacing: -0.02em;
      text-align: center; color: #E2E8F0; margin-bottom: 4px;
    }
    .subtitle { font-size: 13px; color: #64748B; text-align: center; margin-bottom: 32px; font-weight: 300; }

    label { display: block; font-size: 12px; color: #94A3B8; margin-bottom: 6px; font-weight: 500; letter-spacing: 0.02em; text-transform: uppercase; }

    input {
      width: 100%; padding: 12px 14px;
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid rgba(51, 65, 85, 0.6); border-radius: 10px;
      font-size: 14px; margin-bottom: 18px; outline: none;
      color: #E2E8F0; font-family: 'Outfit', sans-serif;
      transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
    }
    input:focus {
      border-color: rgba(99, 102, 241, 0.6);
      background: rgba(15, 23, 42, 0.8);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1), 0 0 20px rgba(99, 102, 241, 0.05);
    }
    input::placeholder { color: #475569; }

    button {
      width: 100%; padding: 13px;
      background: linear-gradient(135deg, #6366F1, #7C3AED);
      color: #fff; border: none; border-radius: 10px; font-size: 15px;
      font-family: 'Outfit', sans-serif; font-weight: 600; letter-spacing: 0.01em;
      cursor: pointer; transition: transform 0.15s, box-shadow 0.2s, opacity 0.2s;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.3);
    }
    button:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4); }
    button:active { transform: translateY(0) scale(0.98); box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3); }

    .error { color: #F43F5E; font-size: 13px; margin-bottom: 16px; text-align: center; padding: 8px; background: rgba(244,63,94,0.08); border-radius: 8px; }

    .card-footer { margin-top: 28px; padding-top: 20px; border-top: 1px solid rgba(51,65,85,0.3); }
    .footer-link {
      display: block; text-align: center; padding: 10px;
      border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 500;
      transition: background 0.15s;
    }
    .setup-link {
      color: #A78BFA; background: rgba(167,139,250,0.08);
      margin-bottom: 12px;
    }
    .setup-link:hover { background: rgba(167,139,250,0.15); }

    .footer-hint { text-align: center; }
    .forgot-pw { font-size: 12px; color: #64748B; }
    .contact-admin { font-size: 12px; color: #475569; margin-top: 2px; display: block; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo"><div class="logo-icon">🔐</div></div>
    <h1>${t('admin_login', lang)}</h1>
    <div class="subtitle">${t('admin_panel', lang)}</div>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ""}
    <form method="POST" action="/admin/login">
      <label>${t('username', lang)}</label>
      <input type="text" name="username" required autofocus placeholder="${t('username', lang)}" />
      <label>${t('password', lang)}</label>
      <input type="password" name="password" required placeholder="${t('password', lang)}" />
      <button type="submit">${t('login_btn', lang)}</button>
    </form>
    ${bottomLinks}
  </div>
</body>
</html>`;
}

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

module.exports = { loginPage, setupPage };
