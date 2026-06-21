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
  <div class="detail-container" style="max-width:800px; margin:0 auto;">
    <div class="detail-header">
      <h2>${escapeHtml(feedback.title)}</h2>
      <span class="status-badge ${statusClass}">${statusLabel}</span>
    </div>

    <div class="detail-meta">
      <div class="meta-item">
        <strong>${t("feedback_type_label", lang)}：</strong>${typeLabel}
      </div>
      <div class="meta-item">
        <strong>${t("feedback_submitted_by_label", lang)}：</strong>${escapeHtml(feedback.submittedBy)}
      </div>
      <div class="meta-item">
        <strong>${t("feedback_submitted_at_label", lang)}：</strong>${submittedAt}
      </div>
      ${
        feedback.githubIssueUrl
          ? `<div class="meta-item">
              <strong>${t("feedback_github_issue_label", lang)}：</strong>
              <a href="${feedback.githubIssueUrl}" target="_blank">${t("feedback_view_on_github", lang)} ↗</a>
            </div>`
          : ""
      }
    </div>

    <div class="detail-description">
      <h3>${t("feedback_description_label", lang)}</h3>
      <div class="description-content">${escapeHtml(feedback.description).replace(/\n/g, "<br>")}</div>
    </div>

    ${
      feedback.screenshotUrl
        ? `<div class="detail-screenshot">
            <h3>${t("feedback_screenshot_label", lang)}</h3>
            <img src="${feedback.screenshotUrl}" alt="${t("feedback_screenshot_alt", lang)}"
                 style="max-width:100%; border-radius:8px; cursor:pointer;"
                 onclick="openLightbox('${feedback.screenshotUrl}')" />
          </div>`
        : ""
    }

    <div class="detail-actions">
      ${
        feedback.githubIssueId
          ? `<button class="btn btn-primary" onclick="syncStatus('${feedback.id}')">
              🔄 ${t("feedback_sync_status", lang)}
            </button>`
          : ""
      }
      <a href="/admin/feedback" class="btn btn-secondary">${t("feedback_back_to_list", lang)}</a>
    </div>
  </div>

  <script>
    function syncStatus(feedbackId) {
      if (!confirm('${t("feedback_sync_confirm", lang)}')) return;

      const btn = event.target;
      btn.disabled = true;
      btn.textContent = '⏳ ${t("feedback_syncing", lang)}';

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
          btn.disabled = false;
          btn.textContent = '🔄 ${t("feedback_sync_status", lang)}';
        }
      })
      .catch(err => {
        showToast('${t("feedback_sync_error", lang)}');
        btn.disabled = false;
        btn.textContent = '🔄 ${t("feedback_sync_status", lang)}';
      });
    }

    function openLightbox(src) {
      const lightbox = document.getElementById('lightbox');
      const img = document.getElementById('lightbox-img');
      img.src = src;
      lightbox.classList.add('active');
    }

    function closeLightbox() {
      const lightbox = document.getElementById('lightbox');
      lightbox.classList.remove('active');
    }
  </script>`;

  return htmlLayout(title, content, "/admin/feedback", lang);
}

module.exports = { feedbackDetailPage };
