"use strict";

const { t } = require("../i18n");
const { htmlLayout } = require("./layout");

function usersPage(users, currentUser, flash = "", lang = "zh") {
  const rows = users.map(u => {
    const isSelf = u.username === currentUser;
    const deleteBtn = isSelf
      ? `<button class="btn" disabled title="${t('cannot_delete_self', lang)}">🚫 ${t('delete', lang)}</button>`
      : `<form class="inline" method="POST" action="/admin/users/${encodeURIComponent(u.username)}/delete"
              onsubmit="return confirm(${JSON.stringify(t('confirm_delete', lang, { username: u.username }))})">
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

module.exports = { usersPage, newUserPage };
