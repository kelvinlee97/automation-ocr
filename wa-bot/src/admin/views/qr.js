"use strict";

const state = require("../state");
const { t } = require("../i18n");

function qrPage(lang = "zh") {
  const _waConnected = state.isConnected();
  const _qrBase64 = state.getQR();
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
    window.QR_PAGE = {
      lang: ${JSON.stringify(lang)},
      lastHasQR: ${!!_qrBase64},
      T: {
        requesting: ${JSON.stringify(t('requesting', lang))},
        fetching: ${JSON.stringify(t('fetching', lang))},
        refetch: ${JSON.stringify(t('refetch', lang))},
        networkError: ${JSON.stringify(t('network_error', lang))},
        codePlaceholder: ${JSON.stringify(t('code_placeholder', lang))}
      }
    };
  </script>
  <script src="/admin/static/qr.js"></script>
</body>
</html>`;
}

module.exports = { qrPage };
