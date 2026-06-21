"use strict";

/**
 * feedback-detail.js - Feedback detail page view
 *
 * Renders the feedback detail page with all information and sync button.
 */

const { t } = require("../i18n");
const { htmlLayout } = require("./layout");
const { escapeHtml } = require("./escapeHtml");

function feedbackDetailPage(feedback, lang = "zh") {
  const title = t("feedback_detail_title", lang) || "Feedback Detail";

  const typeLabel = feedback.type === "bug"
    ? `🐛 ${t("feedback_type_bug", lang)}`
    : `💡 ${t("feedback_type_improvement", lang)}`;

  const statusLabel = feedback.status === "open"
    ? t("feedback_status_open", lang)
    : t("feedback_status_resolved", lang);

  const statusClass = feedback.status === "open" ? "status-open" : "status-resolved";

  const submittedAt = new Date(feedback.submittedAt).toLocaleString(
    lang === "zh" ? "zh-CN" : "en-US"
  );

  const content = `
  <div class="feedback-detail-card">
    <div class="feedback-detail-header">
      <h2>${escapeHtml(feedback.title)}</h2>
      <span class="feedback-status-badge ${statusClass}">${statusLabel}</span>
    </div>

    <div class="feedback-meta-grid">
      <div class="feedback-meta-item">
        <strong>${t("feedback_type_label", lang)}</strong>
        ${typeLabel}
      </div>
      <div class="feedback-meta-item">
        <strong>${t("feedback_submitted_by_label", lang)}</strong>
        ${escapeHtml(feedback.submittedBy)}
      </div>
      <div class="feedback-meta-item">
        <strong>${t("feedback_submitted_at_label", lang)}</strong>
        ${submittedAt}
      </div>
      ${
        feedback.githubIssueUrl
          ? `<div class="feedback-meta-item">
              <strong>${t("feedback_github_issue_label", lang)}</strong>
              <a href="${feedback.githubIssueUrl}" target="_blank">${t("feedback_view_on_github", lang)} ↗</a>
            </div>`
          : ""
      }
    </div>

    ${
      feedback.githubIssueUrl
        ? `<div class="feedback-github-card">
            <div class="github-icon">🐙</div>
            <div class="github-info">
              <a href="${feedback.githubIssueUrl}" target="_blank">${t("feedback_view_on_github", lang)} ↗</a>
              ${
                feedback.githubIssueState
                  ? `<span class="issue-state ${feedback.githubIssueState}">${feedback.githubIssueState === 'open' ? 'Open' : 'Closed'}</span>`
                  : ""
              }
            </div>
          </div>`
        : ""
    }

    <div class="feedback-description-section">
      <h3>${t("feedback_description_label", lang)}</h3>
      <div class="feedback-description-content">${escapeHtml(feedback.description).replace(/\n/g, "<br>")}</div>
    </div>

    ${
      feedback.screenshotUrl
        ? `<div class="feedback-screenshot-section">
            <h3>${t("feedback_screenshot_label", lang)}</h3>
            <img src="${feedback.screenshotUrl}" alt="${t("feedback_screenshot_alt", lang)}"
                 onclick="openLightbox('${feedback.screenshotUrl}')" />
          </div>`
        : ""
    }

    <div class="feedback-detail-actions">
      ${
        feedback.githubIssueId
          ? `<button class="btn-sync" id="sync-btn" onclick="syncStatus('${feedback.id}')">
              🔄 ${t("feedback_sync_status", lang)}
            </button>`
          : ""
      }
      <a href="/admin/feedback" class="btn-back">${t("feedback_back_to_list", lang)}</a>
    </div>
  </div>

  <script>
    function syncStatus(feedbackId) {
      if (!confirm('${t("feedback_sync_confirm", lang)}')) return;

      const btn = document.getElementById('sync-btn');
      if (btn) {
        btn.classList.add('syncing');
        btn.disabled = true;
        btn.textContent = '';
      }

      fetch('/admin/feedback/' + feedbackId + '/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          showToast('${t("feedback_sync_success", lang)}');
          setTimeout(() => location.reload(), 1000);
        } else {
          showToast(data.error || '${t("feedback_sync_fail", lang)}');
          if (btn) {
            btn.classList.remove('syncing');
            btn.disabled = false;
            btn.textContent = '🔄 ${t("feedback_sync_status", lang)}';
          }
        }
      })
      .catch(err => {
        showToast('${t("feedback_sync_error", lang)}');
        if (btn) {
          btn.classList.remove('syncing');
          btn.disabled = false;
          btn.textContent = '🔄 ${t("feedback_sync_status", lang)}';
        }
      });
    }
  </script>`;

  return htmlLayout(title, content, "/admin/feedback", lang);
}

module.exports = { feedbackDetailPage };
