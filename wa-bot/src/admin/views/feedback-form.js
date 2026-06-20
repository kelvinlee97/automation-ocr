"use strict";

/**
 * feedback-form.js - New feedback form page view
 *
 * Renders the feedback submission form.
 */

const { t } = require("../i18n");
const { htmlLayout } = require("./layout");
const { escapeHtml } = require("./escapeHtml");

function feedbackFormPage(lang = "zh") {
  const title = t("feedback_new_title", lang) || "New Feedback";

  let content = `
  <div class="form-container" style="max-width:600px; margin:0 auto;">
    <form method="POST" action="/admin/feedback" class="feedback-form" onsubmit="return validateForm()">
      <div class="form-group">
        <label for="title">${t("feedback_title_label", lang)} *</label>
        <input type="text" id="title" name="title" maxlength="200" required
               placeholder="${t("feedback_title_placeholder", lang)}" />
        <small class="form-hint">${t("feedback_title_hint", lang)}</small>
      </div>

      <div class="form-group">
        <label for="type">${t("feedback_type_label", lang)} *</label>
        <select id="type" name="type" required>
          <option value="">${t("feedback_type_placeholder", lang)}</option>
          <option value="bug">🐛 ${t("feedback_type_bug", lang)}</option>
          <option value="improvement">💡 ${t("feedback_type_improvement", lang)}</option>
        </select>
      </div>

      <div class="form-group">
        <label for="description">${t("feedback_description_label", lang)} *</label>
        <textarea id="description" name="description" rows="6" required
                  placeholder="${t("feedback_description_placeholder", lang)}"></textarea>
        <small class="form-hint">${t("feedback_description_hint", lang)}</small>
      </div>

      <div class="form-group">
        <label for="screenshot">${t("feedback_screenshot_label", lang)}</label>
        <input type="file" id="screenshot" name="screenshot" accept="image/jpeg,image/png,image/gif"
               onchange="uploadScreenshot()" />
        <small class="form-hint">${t("feedback_screenshot_hint", lang)}</small>
        <div id="screenshot-preview" style="margin-top:10px;"></div>
        <div id="screenshot-progress" style="display:none; margin-top:10px;">
          <span id="upload-status"></span>
        </div>
        <!-- Hidden field to store uploaded screenshot filename -->
        <input type="hidden" id="screenshotFilename" name="screenshotFilename" value="" />
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${t("feedback_submit", lang)}</button>
        <a href="/admin/feedback" class="btn btn-secondary">${t("cancel", lang)}</a>
      </div>
    </form>
  </div>

  <script>
  let screenshotFilename = '';

  function validateForm() {
    const title = document.getElementById('title').value.trim();
    const type = document.getElementById('type').value;
    const description = document.getElementById('description').value.trim();

    if (!title || !type || !description) {
      showToast('${t("feedback_required_fields", lang)}');
      return false;
    }

    if (title.length > 200) {
      showToast('${t("feedback_title_too_long", lang)}');
      return false;
    }

    return true;
  }

  async function uploadScreenshot() {
    const fileInput = document.getElementById('screenshot');
    const file = fileInput.files[0];
    if (!file) return;

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      showToast('${t("feedback_file_too_large", lang)}');
      fileInput.value = '';
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('screenshot-preview').innerHTML =
        '<img src="' + e.target.result + '" style="max-width:200px; max-height:150px; border-radius:4px;" />';
    };
    reader.readAsDataURL(file);

    // Show uploading status
    document.getElementById('screenshot-progress').style.display = 'block';
    document.getElementById('upload-status').textContent = '${t("feedback_uploading", lang) || "Uploading..."}';

    // Upload screenshot via AJAX
    const formData = new FormData();
    formData.append('screenshot', file);

    try {
      const response = await fetch('/admin/feedback/upload-screenshot-temp', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.ok) {
        screenshotFilename = result.filename;
        document.getElementById('screenshotFilename').value = result.filename;
        document.getElementById('upload-status').textContent = '${t("feedback_upload_success", lang) || "Uploaded successfully"}';
        showToast('${t("feedback_upload_success", lang) || "Screenshot uploaded successfully"}');
      } else {
        document.getElementById('upload-status').textContent = '${t("feedback_upload_fail", lang) || "Upload failed"}: ' + result.error;
        showToast('${t("feedback_upload_fail", lang) || "Upload failed"}: ' + result.error);
      }
    } catch (error) {
      document.getElementById('upload-status').textContent = '${t("feedback_upload_fail", lang) || "Upload failed"}: ' + error.message;
      showToast('${t("feedback_upload_fail", lang) || "Upload failed"}: ' + error.message);
    }
  }
  </script>`;

  return htmlLayout(title, content, "/admin/feedback", lang);
}

module.exports = { feedbackFormPage };
