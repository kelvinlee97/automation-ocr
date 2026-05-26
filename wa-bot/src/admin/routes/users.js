"use strict";

const adminUserService = require("../../services/adminUserService");
const logger = require("../../utils/logger");
const { requireAuth } = require("../middleware/auth");
const { getLang, t } = require("../i18n");
const { usersPage, newUserPage } = require("../views/users");

function registerUserRoutes(app) {
  app.get("/admin/users", requireAuth, (req, res) => {
    const lang = getLang(req);
    const users = adminUserService.listUsers();
    const flash = req.query.flash || "";
    res.send(usersPage(users, req.session.username, flash, lang, res.locals.cspNonce, res.locals.csrfToken));
  });

  app.get("/admin/users/new", requireAuth, (req, res) => {
    const lang = getLang(req);
    res.send(newUserPage("", lang, res.locals.cspNonce, res.locals.csrfToken));
  });

  app.post("/admin/users/new", requireAuth, (req, res) => {
    const { username, password, confirm } = req.body;
    const lang = getLang(req);
    if (password !== confirm) return res.send(newUserPage(t('password_mismatch', lang), lang, res.locals.cspNonce, res.locals.csrfToken));
    const result = adminUserService.createUser(username, password);
    if (!result.ok) return res.send(newUserPage(result.error, lang, res.locals.cspNonce, res.locals.csrfToken));
    logger.info("新管理员账号已创建", { by: req.session.username, newUser: username });
    res.redirect("/admin/users?flash=" + encodeURIComponent(t('user_created', lang)));
  });

  app.post("/admin/users/:username/reset-password", requireAuth, (req, res) => {
    const { username } = req.params;
    const { newPassword } = req.body;
    const lang = getLang(req);
    const result = adminUserService.resetPassword(username, newPassword);
    if (!result.ok) return res.redirect(`/admin/users?flash=${encodeURIComponent(t('download_fail', lang) + result.error)}`);
    logger.info("密码已重置", { by: req.session.username, target: username });
    res.redirect("/admin/users?flash=" + encodeURIComponent(t('password_reset_ok', lang)));
  });

  app.post("/admin/users/:username/delete", requireAuth, (req, res) => {
    const { username } = req.params;
    const lang = getLang(req);
    const result = adminUserService.deleteUser(username, req.session.username);
    if (!result.ok) return res.redirect(`/admin/users?flash=${encodeURIComponent(t('download_fail', lang) + result.error)}`);
    logger.info("管理员账号已删除", { by: req.session.username, deleted: username });
    res.redirect("/admin/users?flash=" + encodeURIComponent(t('user_deleted', lang)));
  });
}

module.exports = { registerUserRoutes };
