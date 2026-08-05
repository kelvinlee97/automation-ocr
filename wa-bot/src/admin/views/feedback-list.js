"use strict";

/**
 * feedback-list.js - Feedback list page view
 *
 * Renders the feedback list page with stats cards, table, filters, and pagination.
 */

const { t } = require("../i18n");
const { htmlLayout } = require("./layout");
const { escapeHtml } = require("./escapeHtml");

function feedbackListPage(items, stats, lang = "en", page = 1, totalPages = 1, searchQuery = "", statusFilter = "", typeFilter = "") {
  const title = t("feedback_title", lang) || "Feedback";

  let content = "";

  // Success message
  if (searchQuery === "" && statusFilter === "" && typeFilter === "" && page === 1) {
    // Check for success param
    content += `<script>if(window.location.search.includes('success=1')){setTimeout(()=>showToast('${t("feedback_submit_success", lang)}'),100)}</script>`;
  }

  // Stats cards
  content += `
  <div class="feedback-stats">
    <div class="feedback-stat-card stat-total">
      <div class="feedback-stat-label">${t("feedback_total", lang)}</div>
      <div class="feedback-stat-value">${stats.total}</div>
    </div>
    <div class="feedback-stat-card stat-open">
      <div class="feedback-stat-label">${t("feedback_open", lang)}</div>
      <div class="feedback-stat-value">${stats.open}</div>
    </div>
    <div class="feedback-stat-card stat-resolved">
      <div class="feedback-stat-label">${t("feedback_resolved", lang)}</div>
      <div class="feedback-stat-value">${stats.resolved}</div>
    </div>
  </div>`;

  // Filters
  content += `
  <form class="feedback-filters" method="GET" action="/admin/feedback">
    <input type="text" name="q" placeholder="${t("feedback_search_placeholder", lang)}" value="${escapeHtml(searchQuery)}" />
    <select name="status">
      <option value="">${t("feedback_all_status", lang)}</option>
      <option value="open" ${statusFilter === "open" ? "selected" : ""}>${t("feedback_status_open", lang)}</option>
      <option value="resolved" ${statusFilter === "resolved" ? "selected" : ""}>${t("feedback_status_resolved", lang)}</option>
    </select>
    <select name="type">
      <option value="">${t("feedback_all_type", lang)}</option>
      <option value="bug" ${typeFilter === "bug" ? "selected" : ""}>${t("feedback_type_bug", lang)}</option>
      <option value="improvement" ${typeFilter === "improvement" ? "selected" : ""}>${t("feedback_type_improvement", lang)}</option>
    </select>
    <button type="submit" class="btn-filter">${t("filter", lang)}</button>
    <a href="/admin/feedback/new" class="btn-new">+ ${t("feedback_new", lang)}</a>
  </form>`;

  // Table
    if (items.length === 0) {
    content += `<div class="feedback-empty"><div class="feedback-empty-icon">📭</div><div class="feedback-empty-text">${t("feedback_no_feedback", lang)}</div><a href="/admin/feedback/new" class="btn-primary">+ ${t("feedback_new", lang)}</a></div>`;
  } else {
    content += `
    <table class="data-table feedback-table">
      <thead>
        <tr>
          <th>${t("feedback_title_col", lang)}</th>
          <th>${t("feedback_type_col", lang)}</th>
          <th>${t("feedback_status_col", lang)}</th>
          <th>${t("feedback_submitted_by_col", lang)}</th>
          <th>${t("feedback_submitted_at_col", lang)}</th>
          <th>${t("actions", lang)}</th>
        </tr>
      </thead>
      <tbody>`;

    for (const item of items) {
      const typeIcon = item.type === "bug" ? "⬤" : "◯";
      const typeLabel = item.type === "bug" ? t("feedback_type_bug", lang) : t("feedback_type_improvement", lang);
      const statusLabel = item.status === "open" ? t("feedback_status_open", lang) : t("feedback_status_resolved", lang);
      const submittedAt = new Date(item.submittedAt).toLocaleString("en-US");

      content += `
        <tr>
          <td><a href="/admin/feedback/${item.id}">${escapeHtml(item.title)}</a></td>
          <td><span class="feedback-type-badge ${item.type}">${typeIcon} ${typeLabel}</span></td>
          <td><span class="feedback-status-dot status-${item.status}">${statusLabel}</span></td>
          <td>${escapeHtml(item.submittedBy)}</td>
          <td>${submittedAt}</td>
          <td>
            <a href="/admin/feedback/${item.id}" class="btn btn-sm">${t("view", lang)}</a>
          </td>
        </tr>`;
    }

    content += `
      </tbody>
    </table>`;

    // Pagination
    if (totalPages > 1) {
      content += buildPagination(page, totalPages, searchQuery, statusFilter, typeFilter, lang);
    }
  }

  return htmlLayout(title, content, "/admin/feedback", lang);
}

function buildPagination(currentPage, totalPages, q, status, type, lang) {
  if (totalPages <= 1) return '';

  const getUrl = (p) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    params.set('page', p);
    return '/admin/feedback?' + params.toString();
  };

  let html = '<div class="feedback-pagination">';

  html += '<div class="page-info">' + t('page_info', lang, { current: currentPage, total: totalPages }) + '</div>';

  html += '<div class="page-buttons">';

  if (currentPage > 1) {
    html += `<a href="${getUrl(currentPage - 1)}" class="page-btn">←</a>`;
  }

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);

  for (let i = startPage; i <= endPage; i++) {
    if (i === currentPage) {
      html += `<span class="page-btn active">${i}</span>`;
    } else {
      html += `<a href="${getUrl(i)}" class="page-btn">${i}</a>`;
    }
  }

  if (currentPage < totalPages) {
    html += `<a href="${getUrl(currentPage + 1)}" class="page-btn">→</a>`;
  }

  html += '</div></div>';

  return html;
}

module.exports = { feedbackListPage };
