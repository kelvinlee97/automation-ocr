"use strict";

const fs = require("fs");
const path = require("path");
const receiptStore = require("../../services/receiptStore");
const { processReceipt } = require("../../services/aiService");
const logger = require("../../utils/logger");
const state = require("../state");
const { requireAuth, requireSetup } = require("../middleware/auth");
const { apiLimiter } = require("../middleware/rateLimit");
const { getLang, t } = require("../i18n");
const { receiptsPage } = require("../views/receipts");

function registerReceiptRoutes(app) {
  app.get("/admin", requireSetup, (req, res) => {
    if (!req.session.authenticated) {
      return res.redirect("/admin/login");
    }
    try {
      const lang = getLang(req);
      const searchQuery = (req.query.q || "").toLowerCase();
      const statusFilter = req.query.status || "";
      const page = parseInt(req.query.page) || 1;

      const allReceipts = receiptStore.getAll();
      let receipts = allReceipts;

      if (searchQuery || statusFilter) {
        receipts = allReceipts.filter(r => {
          const text = ((r.phone || '') + ' ' + (r.ic || '')).toLowerCase();
          const matchQ = !searchQuery || text.includes(searchQuery);
          const matchStatus = !statusFilter || r.status === statusFilter;
          return matchQ && matchStatus;
        });
      }

      const totalPages = Math.max(1, Math.ceil(receipts.length / 20));
      res.send(receiptsPage(receipts, lang, page, totalPages, searchQuery, statusFilter, allReceipts));
    } catch (err) {
      const lang = getLang(req);
      logger.error("Failed to load receipt list", { error: err.message });
      res.status(500).send(t('load_fail', lang) + err.message);
    }
  });

  app.get("/admin/receipts", (req, res) => {
    res.redirect("/admin");
  });

  app.get("/admin/images/:filename", requireAuth, (req, res) => {
    const filename = path.basename(req.params.filename);
    const imagePath = receiptStore.getImagePath(filename);
    const lang = getLang(req);

    if (!fs.existsSync(imagePath)) {
      return res.status(404).send(t('image_not_found', lang));
    }
    res.sendFile(imagePath);
  });

  app.post("/admin/receipts/:id/ai-extract", requireAuth, apiLimiter, async (req, res) => {
    const { id } = req.params;
    const lang = getLang(req);

    const record = receiptStore.getById(id);
    if (!record) {
      return res.status(404).json({ error: t('receipt_not_found', lang) });
    }
    if (record.status !== "pending_review") {
      return res.status(400).json({ error: t('invalid_status', lang, { status: record.status }) });
    }

    try {
      const imagePath = receiptStore.getImagePath(record.imageFilename);
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString("base64");

      const imageMime = record.imageFilename.endsWith(".png")  ? "image/png"
                      : record.imageFilename.endsWith(".webp") ? "image/webp"
                      : "image/jpeg";
      const aiResult = await processReceipt(base64Image, imageMime);

      if (!aiResult.success) {
        return res.status(502).json({ error: t('ai_recognition_fail', lang) + aiResult.message });
      }

      receiptStore.saveAiResult(id, aiResult);
      logger.info("AI extraction completed", { id, amount: aiResult.amount });

      res.json({ ok: true, aiResult });
    } catch (err) {
      logger.error("AI extraction failed", { id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/admin/receipts/:id/send-message", requireAuth, async (req, res) => {
    const { id } = req.params;
    const message = (req.body.message || "").trim();
    const lang = getLang(req);
    const client = state.getClient();

    if (!message) {
      return res.status(400).send(t('message_required', lang));
    }

    if (!client || typeof client.sendMessage !== "function") {
      return res.status(503).send(t('cant_send', lang));
    }

    try {
      const record = receiptStore.getById(id);
      if (!record) return res.status(404).send(t('receipt_not_found', lang));

      const chatId = record.phone.includes("@") ? record.phone : `${record.phone}@c.us`;

      receiptStore.sendMessageToUser(id, message);
      logger.info("Receipt status updated to waiting_user_reply, ready to send WhatsApp", { id, chatId, previousStatus: record.status });

      await client.sendMessage(chatId, message);
      logger.info("WhatsApp message sent", { id, chatId, messageLength: message.length });

      res.redirect("/admin");
    } catch (err) {
      logger.error("Failed to send message", { id, error: err.message });
      res.status(500).send(t('download_fail', lang) + err.message);
    }
  });

  app.post("/admin/receipts/:id/reject", requireAuth, (req, res) => {
    const { id } = req.params;
    const note = (req.body.note || "").trim();
    const lang = getLang(req);
    try {
      receiptStore.rejectReceipt(id, note);
      logger.info("Receipt declined", { id, note });
      res.redirect("/admin");
    } catch (err) {
      logger.error("Rejection of receipt failed", { id, error: err.message });
      res.status(500).send(t('download_fail', lang) + err.message);
    }
  });
}

module.exports = { registerReceiptRoutes };
