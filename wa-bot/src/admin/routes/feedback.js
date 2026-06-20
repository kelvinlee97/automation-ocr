"use strict";

/**
 * feedback.js - Feedback management routes
 *
 * Responsibility: Handle feedback CRUD and GitHub sync.
 */

const fs = require("fs");
const path = require("path");
const multer = require("multer");
const feedbackStore = require("../../services/feedbackStore");
const githubService = require("../../services/githubService");
const logger = require("../../utils/logger");
const { requireAuth } = require("../middleware/auth");
const { apiLimiter } = require("../middleware/rateLimit");
const { getLang, t } = require("../i18n");
const { feedbackListPage } = require("../views/feedback-list");
const { feedbackFormPage } = require("../views/feedback-form");
const { feedbackDetailPage } = require("../views/feedback-detail");

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(process.env.DATA_DIR || path.resolve(__dirname, "../../../../data"), "uploads", "feedback");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only JPG/PNG/GIF images are allowed"));
    }
  },
}).single("screenshot");

function registerFeedbackRoutes(app) {
  // Feedback list page
  app.get("/admin/feedback", requireAuth, (req, res) => {
    try {
      const lang = getLang(req);
      const statusFilter = req.query.status || "";
      const typeFilter = req.query.type || "";
      const searchQuery = (req.query.q || "").toLowerCase();
      const page = parseInt(req.query.page) || 1;
      const limit = 20;

      const result = feedbackStore.getAll(
        { status: statusFilter, type: typeFilter, q: searchQuery },
        { page, limit }
      );

      const totalPages = Math.max(1, Math.ceil(result.total / limit));

      // Get stats using efficient COUNT queries
      const stats = feedbackStore.getStats();

      res.send(feedbackListPage(result.items, stats, lang, page, totalPages, searchQuery, statusFilter, typeFilter));
    } catch (err) {
      const lang = getLang(req);
      logger.error("Failed to load feedback list", { error: err.message });
      res.status(500).send(t("load_fail", lang) + err.message);
    }
  });

  // New feedback form page
  app.get("/admin/feedback/new", requireAuth, (req, res) => {
    try {
      const lang = getLang(req);
      res.send(feedbackFormPage(lang));
    } catch (err) {
      const lang = getLang(req);
      logger.error("Failed to load feedback form", { error: err.message });
      res.status(500).send(t("load_fail", lang) + err.message);
    }
  });

  // Upload screenshot temporarily (before feedback creation)
  app.post("/admin/feedback/upload-screenshot-temp", requireAuth, apiLimiter, (req, res) => {
    upload(req, res, (err) => {
      const lang = getLang(req);

      if (err instanceof multer.MulterError) {
        return res.status(400).json({ ok: false, error: t("feedback_upload_fail", lang) + err.message });
      } else if (err) {
        return res.status(400).json({ ok: false, error: t("feedback_upload_fail", lang) + err.message });
      }

      if (!req.file) {
        return res.status(400).json({ ok: false, error: t("feedback_no_file", lang) });
      }

      // Return filename so client can store it
      res.json({ ok: true, filename: req.file.filename });
    });
  });

  // Submit feedback (form submission)
  app.post("/admin/feedback", requireAuth, apiLimiter, async (req, res) => {
    const lang = getLang(req);

    try {
      const { title, type, description, screenshotFilename } = req.body;

      // Validate required fields
      if (!title || !type || !description) {
        return res.status(400).send(t("feedback_required_fields", lang));
      }

      if (title.length > 200) {
        return res.status(400).send(t("feedback_title_too_long", lang));
      }

      if (description.length > 5000) {
        return res.status(400).send(t("feedback_description_too_long", lang) || "Description is too long (max 5000 characters)");
      }

      if (!["bug", "improvement"].includes(type)) {
        return res.status(400).send(t("feedback_invalid_type", lang));
      }

      // Get current user
      const username = req.session.username || "unknown";
      const submittedBy = username;

      // Build screenshotUrl if screenshot was uploaded
      let screenshotUrl = null;
      if (screenshotFilename) {
        screenshotUrl = `/uploads/feedback/${screenshotFilename}`;
      }

      // Create feedback record
      const { id } = feedbackStore.create({
        title,
        type,
        description,
        screenshotUrl,
        submittedBy,
      });

      logger.info("Feedback created", { id, title, type, submittedBy, hasScreenshot: !!screenshotUrl });

      // Try to create GitHub Issue
      try {
        const feedback = feedbackStore.getById(id);
        const githubResult = await githubService.createIssue({
          id: feedback.id,
          title: feedback.title,
          type: feedback.type,
          description: feedback.description,
          screenshotUrl: feedback.screenshotUrl,
          submittedBy: feedback.submittedBy,
          submittedAt: feedback.submittedAt,
        });

        // Update GitHub Issue info
        feedbackStore.updateGitHubInfo(id, githubResult.issueId, githubResult.issueUrl);
        logger.info("GitHub Issue created", { id, issueId: githubResult.issueId });
      } catch (githubError) {
        logger.error("GitHub Issue creation failed, but feedback saved", { id, error: githubError.message });
        // Don't block user, feedback is saved
      }

      res.redirect("/admin/feedback?success=1");
    } catch (err) {
      logger.error("Failed to submit feedback", { error: err.message });
      res.status(500).send(t("feedback_submit_fail", lang) + err.message);
    }
  });

  // Feedback detail page
  app.get("/admin/feedback/:id", requireAuth, (req, res) => {
    try {
      const lang = getLang(req);
      const { id } = req.params;

      const feedback = feedbackStore.getById(id);
      if (!feedback) {
        return res.status(404).send(t("feedback_not_found", lang));
      }

      res.send(feedbackDetailPage(feedback, lang));
    } catch (err) {
      const lang = getLang(req);
      logger.error("Failed to load feedback detail", { error: err.message });
      res.status(500).send(t("load_fail", lang) + err.message);
    }
  });

  // Manual sync feedback status (API)
  app.post("/admin/feedback/:id/sync", requireAuth, apiLimiter, async (req, res) => {
    const lang = getLang(req);
    const { id } = req.params;

    try {
      const feedback = feedbackStore.getById(id);
      if (!feedback) {
        return res.status(404).json({ error: t("feedback_not_found", lang) });
      }

      if (!feedback.githubIssueId) {
        return res.status(400).json({ error: t("feedback_no_github_issue", lang) });
      }

      const syncResult = await githubService.syncIssueStatus(feedback);

      // Update local status
      feedbackStore.updateStatus(id, syncResult.status, syncResult.githubIssueState);

      res.json({
        ok: true,
        status: syncResult.status,
        githubIssueState: syncResult.githubIssueState,
      });
    } catch (err) {
      logger.error("Failed to sync feedback status", { id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Upload screenshot (API)
  app.post("/admin/feedback/:id/screenshot", requireAuth, apiLimiter, (req, res) => {
    upload(req, res, async (err) => {
      const lang = getLang(req);
      const { id } = req.params;

      if (err instanceof multer.MulterError) {
        // Multer error
        return res.status(400).json({ error: t("feedback_upload_fail", lang) + err.message });
      } else if (err) {
        // Other error
        return res.status(400).json({ error: t("feedback_upload_fail", lang) + err.message });
      }

      // File uploaded successfully
      try {
        const feedback = feedbackStore.getById(id);
        if (!feedback) {
          return res.status(404).json({ error: t("feedback_not_found", lang) });
        }

        if (!req.file) {
          return res.status(400).json({ error: t("feedback_no_file", lang) });
        }

        // Build screenshot URL
        const filename = req.file.filename;
        const screenshotUrl = `/uploads/feedback/${filename}`;

        // Update feedback record
        feedbackStore.updateScreenshotUrl(id, screenshotUrl);

        logger.info("Screenshot uploaded", { id, filename, screenshotUrl });

        res.json({ ok: true, filename, screenshotUrl });
      } catch (err) {
        logger.error("Failed to save screenshot", { id, error: err.message });
        res.status(500).json({ error: err.message });
      }
    });
  });

  // Serve screenshot file (requires auth)
  app.get("/admin/uploads/feedback/:filename", requireAuth, (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = feedbackStore.getScreenshotPath(filename);
    const lang = getLang(req);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send(t("feedback_screenshot_not_found", lang));
    }

    res.sendFile(filePath);
  });
}

module.exports = { registerFeedbackRoutes };
