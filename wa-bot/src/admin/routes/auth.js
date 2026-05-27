"use strict";

const adminUserService = require("../../services/adminUserService");
const logger = require("../../utils/logger");
const { requireSetup } = require("../middleware/auth");
const { authLimiter } = require("../middleware/rateLimit");
const { getLang, t } = require("../i18n");
const { loginPage, setupPage } = require("../views/login");

function registerAuthRoutes(app) {
  app.get("/admin/setup", (req, res) => {
    if (!adminUserService.isEmpty()) return res.redirect("/admin/login");
    const lang = getLang(req);
    res.send(setupPage("", lang));
  });

  app.post("/admin/setup", (req, res) => {
    if (!adminUserService.isEmpty()) return res.redirect("/admin/login");
    const { username, password, confirm } = req.body;
    const lang = getLang(req);

    if (password !== confirm) return res.send(setupPage(t('password_mismatch', lang), lang));
    const result = adminUserService.createUser(username, password);
    if (!result.ok) return res.send(setupPage(result.error, lang));

    logger.info("首次设置完成，管理员账号已创建", { username });
    res.redirect("/admin/login");
  });

  app.get("/admin/login", requireSetup, (req, res) => {
    if (req.session.authenticated) return res.redirect("/admin");
    const lang = getLang(req);
    res.send(loginPage("", lang));
  });

  app.post("/admin/login", requireSetup, authLimiter, (req, res) => {
    const { username, password } = req.body;
    const lang = getLang(req);
    if (adminUserService.authenticate(username, password)) {
      req.session.authenticated = true;
      req.session.username = username;
      req.session.save((err) => {
        if (err) {
          logger.error("session 写入失败", { error: String(err) });
          return res.send(loginPage(t('login_fail', lang), lang));
        }
        res.redirect("/admin");
      });
      return;
    }
    res.send(loginPage(t('login_error', lang), lang));
  });

  app.post("/admin/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        logger.error("session 销毁失败（登出）", { error: String(err) });
      }
      res.redirect("/admin/login");
    });
  });
}

module.exports = { registerAuthRoutes };
