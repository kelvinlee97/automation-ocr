"use strict";

const { t } = require("../i18n");
const { htmlLayout } = require("./layout");
const { escapeHtml } = require("./escapeHtml");

function _renderAiResult(aiResult, lang = "zh") {
  if (!aiResult) return '<span style="color:#aaa;font-size:12px">—</span>';
  return `<div class="ai-result">
    <strong>${t('ai_amount', lang)}：</strong>RM ${escapeHtml(aiResult.amount ?? "—")}<br>
    <strong>${t('ai_summary', lang)}：</strong>${escapeHtml(aiResult.summary || "—")}
  </div>`;
}

function renderInlineActions(r, lang = "zh", csrfToken = "") {
  if (r.status === "pending_review") {
    return `<button class="btn btn-ai" onclick="aiExtract('${r.id}', this)">🤖 ${t('ai_extract', lang)}</button>`;
  }
  return `<form class="send-form" id="send-form-${r.id}" onsubmit="return handleSend(event, '${r.id}')">
    <input type="hidden" name="_csrf" value="${csrfToken}" />
    <textarea name="message" id="send-msg-${r.id}" placeholder="${t('message_placeholder', lang)}" required rows="2"></textarea>
    <button type="submit" class="btn btn-send" id="send-btn-${r.id}">📤 ${t('send_to_user', lang)}</button>
  </form>`;
}

function buildExpandPanel(r, lang = "zh", csrfToken = "") {
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
        <input type="hidden" name="_csrf" value="${csrfToken}" />
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

function receiptsPage(receipts, lang = "zh", currentPage = 1, totalPages = 1, searchQuery = "", statusFilter = "", allReceipts = null, cspNonce = "", csrfToken = "") {
  if (receipts.length === 0) {
    return htmlLayout(t('receipt_audit', lang), `<div class="empty">${t('no_receipts', lang)}</div>`, '/admin', lang, cspNonce, csrfToken);
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
      const panelContent = buildExpandPanel(r, lang, csrfToken);

      return `<tr class="group-row group-row-${escapeHtml(phone)} expandable" data-phone="${escapeHtml(phone)}" data-status="${safeStatus}" id="row-${r.id}" onclick="toggleRow('${r.id}')">
      <td><span class="expand-chevron">▶</span>${receipts.length - idx}</td>
      <td>${r.submittedAt ? new Date(r.submittedAt).toLocaleString(locale) : "—"}</td>
      <td style="font-size:12px">${phoneDisplay}</td>
      <td style="font-size:12px">${r.ic || "—"}</td>
      <td>${thumb}</td>
      <td>${statusBadge}</td>
      <td style="max-width:260px" onclick="event.stopPropagation()">${renderInlineActions(r, lang, csrfToken)}</td>
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
    <script nonce="${cspNonce}">
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
          // FormData 自动包含 form 中的 _csrf 隐藏字段
          const res = await fetch('/admin/receipts/' + id + '/send-message', {
            method: 'POST',
            body: new URLSearchParams(new FormData(form)),
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
          const res = await fetch('/admin/receipts/' + id + '/ai-extract', {
            method: 'POST',
            headers: { 'x-csrf-token': (window.ADMIN_UI && window.ADMIN_UI.csrfToken) || '' },
          });
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

  return htmlLayout(t('receipt_audit', lang), content, '/admin', lang, cspNonce, csrfToken);
}

module.exports = { receiptsPage, _renderAiResult, renderInlineActions, buildExpandPanel, buildPagination };
