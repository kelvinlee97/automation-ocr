"use strict";

const express = require("express");
const path = require("path");
const logger = require("../utils/logger");
const state = require("./state");
const { createSessionMiddleware } = require("./middleware/session");
const { attachSecurityContext, buildHelmet } = require("./middleware/security");
const { registerRoutes } = require("./routes");
const { receiptsPage } = require("./views/receipts");
const { usersPage } = require("./views/users");
const { qrPage } = require("./views/qr");

const ADMIN_PORT = 3000;

function createApp(sessionStore) {
  const app = express();

  app.set("trust proxy", 1);
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/admin/static", express.static(path.join(__dirname, "static")));
  app.use(createSessionMiddleware(sessionStore));
  app.use(attachSecurityContext);
  app.use(buildHelmet());

  registerRoutes(app);

  return app;
}

function startAdminServer() {
  const app = createApp();
  app.listen(ADMIN_PORT, () => {
    logger.info(`管理后台已启动，监听端口 ${ADMIN_PORT}`);
  });
}

module.exports = {
  startAdminServer,
  setClient: state.setClient,
  setQR: state.setQR,
  setPairingCodeReady: state.setPairingCodeReady,
  setDisconnected: state.setDisconnected,
  ...(process.env.NODE_ENV === 'test' && {
    _receiptsPage: receiptsPage,
    _usersPage: usersPage,
    _qrPage: qrPage,
    _createApp: createApp,
  }),
};
