"use strict";

/**
 * feedback-form.js - New feedback form page view
 *
 * Renders the feedback submission form.
 */

const { t } = require("../i18n");
const { htmlLayout } = require("./layout");

function feedbackFormPage(lang = "en") {
  const title = t("feedback_new_title", lang) || "New Feedback";

  const content = `
  <div class="feedback-form-card">
    <form method="POST" action="/admin/feedback" class="feedback-form" onsubmit="return validateForm()">
      <div class="form-group">
        <label for="title">${t("feedback_title_label", lang)} *</label>
        <input type="text" id="title" name="title" maxlength="200" required
               placeholder="${t("feedback_title_placeholder", lang)}" oninput="updateTitleCount()" />
        <span id="title-count" class="feedback-char-count">0/200</span>
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
                  placeholder="${t("feedback_description_placeholder", lang)}"
                  oninput="updateDescCount()"></textarea>
        <span id="description-count" class="feedback-char-count">0/5000</span>
        <small class="form-hint">${t("feedback_description_hint", lang)}</small>
      </div>

      <div class="form-group">
        <label for="dropzone">${t("feedback_screenshot_label", lang)}</label>
        <div class="screenshot-dropzone" id="dropzone">
          <input type="file" id="screenshot" name="screenshot" accept="image/jpeg,image/png,image/gif"
                 onchange="handleFileSelect(event)" />
          <div class="dropzone-icon">📎</div>
          <div class="dropzone-text">Click or drag screenshot here</div>
          <div class="dropzone-hint">${t("feedback_screenshot_hint", lang)}</div>
        </div>
        <div id="screenshot-preview"></div>
        <div id="screenshot-progress" class="screenshot-progress" style="display:none;">
          <span class="spinner"></span><span id="upload-status"></span>
        </div>
        <input type="hidden" id="screenshotFilename" name="screenshotFilename" value="" />
      </div>

      <div class="feedback-form-actions">
        <button type="submit" class="btn-primary" id="submit-btn">${t("feedback_submit", lang)}</button>
        <a href="/admin/feedback" class="btn-secondary">${t("cancel", lang)}</a>
      </div>
    </form>
  </div>

  <script>
    let screenshotFilename = '';

    // Character counters
    function updateTitleCount() {
      const el = document.getElementById('title');
      const counter = document.getElementById('title-count');
      const len = el.value.length;
      counter.textContent = len + '/200';
      counter.className = 'feedback-char-count';
      if (len > 200) counter.classList.add('danger');
      else if (len > 160) counter.classList.add('warn');
    }
    function updateDescCount() {
      const el = document.getElementById('description');
      const counter = document.getElementById('description-count');
      const len = el.value.length;
      counter.textContent = len + '/5000';
      counter.className = 'feedback-char-count';
      if (len > 5000) counter.classList.add('danger');
      else if (len > 4000) counter.classList.add('warn');
    }

    // Drag-and-drop
    const dropzone = document.getElementById('dropzone');
    dropzone.addEventListener('dragover', function(e) {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', function() {
      dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', function(e) {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleScreenshot(file);
    });

    function handleFileSelect(e) {
      const file = e.target.files[0];
      if (file) handleScreenshot(file);
    }

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

      if (description.length > 5000) {
        showToast('${t("feedback_description_too_long", lang)}');
        return false;
      }

      // Show loading state
      const btn = document.getElementById('submit-btn');
      btn.disabled = true;
      btn.textContent = 'Submitting…';
      return true;
    }

    async function handleScreenshot(file) {
      // Validate file size (5MB)
      if (file.size > 5 * 1024 * 1024) {
        showToast('${t("feedback_file_too_large", lang)}');
        return;
      }

      // Show preview
      const reader = new FileReader();
      reader.onload = function(e) {
        document.getElementById('screenshot-preview').innerHTML =
          '<div class="screenshot-preview">' +
          '<img src="' + e.target.result + '" />' +
          '<button type="button" class="remove-btn" onclick="removeScreenshot()">✕</button>' +
          '</div>';
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
          document.getElementById('upload-status').textContent = '${t("feedback_upload_fail", lang)}: ' + result.error;
          showToast('${t("feedback_upload_fail", lang)}: ' + result.error);
        }
      } catch (error) {
        document.getElementById('upload-status').textContent = '${t("feedback_upload_fail", lang)}: ' + error.message;
        showToast('${t("feedback_upload_fail", lang)}: ' + error.message);
      }
    }

    function removeScreenshot() {
      screenshotFilename = '';
      document.getElementById('screenshotFilename').value = '';
      document.getElementById('screenshot').value = '';
      document.getElementById('screenshot-preview').innerHTML = '';
      document.getElementById('screenshot-progress').style.display = 'none';
    }
  </script>`;

  return htmlLayout(title, content, "/admin/feedback", lang);
}

module.exports = { feedbackFormPage };
