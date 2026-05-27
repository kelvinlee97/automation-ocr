"use strict";

const logger = require("../../utils/logger");
const state = require("../state");
const { apiLimiter } = require("../middleware/rateLimit");
const { getLang } = require("../i18n");
const { qrPage } = require("../views/qr");

function registerWhatsappRoutes(app) {
  app.get("/admin/qr", (req, res) => {
    if (state.isConnected()) {
      if (req.session && req.session.authenticated) {
        return res.redirect("/admin");
      }
      return res.redirect("/admin/login");
    }
    const lang = getLang(req);
    res.send(qrPage(lang));
  });

  app.post("/admin/request-pairing-code", apiLimiter, async (req, res) => {
    const { phone } = req.body;

    if (!phone || !/^\d{10,15}$/.test(phone)) {
      return res.status(400).json({
        error: "手机号格式错误，请输入含区号的纯数字（如 601234567890）",
      });
    }

    if (state.isConnected()) {
      return res.status(400).json({ error: "WhatsApp already connected, no pairing needed" });
    }

    if (!state.isPairingCodeReady()) {
      return res.status(503).json({
        error: "WhatsApp client not ready yet. Wait for initialization (usually 10-20s)",
      });
    }

    try {
      const { requestPairingCode } = require("../../bot");
      const code = await requestPairingCode(phone);
      logger.info("配对码已生成", { phone: phone.slice(0, 5) + "****" });
      res.json({ code });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error("请求配对码失败", { error: errMsg, stack: err?.stack });
      res.status(500).json({ error: errMsg });
    }
  });

  app.get("/admin/wa-status", (req, res) => {
    res.json({ connected: state.isConnected(), hasQR: !!state.getQR() });
  });
}

module.exports = { registerWhatsappRoutes };
