"use strict";

const adminUserService = require("../../services/adminUserService");
const state = require("../state");
const { registerReceiptRoutes } = require("./receipts");
const { registerAuthRoutes } = require("./auth");
const { registerWhatsappRoutes } = require("./whatsapp");
const { registerUserRoutes } = require("./users");
const { registerExportRoutes } = require("./export");

function registerRoutes(app) {
  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      whatsapp: state.isConnected() ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
    });
  });

  registerReceiptRoutes(app);
  registerAuthRoutes(app);
  registerWhatsappRoutes(app);
  registerUserRoutes(app);
  registerExportRoutes(app);

  app.get("/", (req, res) => {
    if (adminUserService.isEmpty()) return res.redirect("/admin/setup");
    if (req.session && req.session.authenticated) return res.redirect("/admin");
    res.redirect("/admin/login");
  });

  app.use((req, res) => {
    res.redirect("/");
  });
}

module.exports = { registerRoutes };
