"use strict";

const { t } = require("../i18n");

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
