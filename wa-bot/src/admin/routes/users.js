"use strict";

const adminUserService = require("../../services/adminUserService");
const logger = require("../../utils/logger");
const { requireAuth, requireSuperAdmin } = require("../middleware/auth");
const { getLang, t } = require("../i18n");
const { usersPage, newUserPage } = require("../views/users");

function registerUserRoutes(app) {
  app.get("/admin/users", requireAuth, requireSuperAdmin, (req, res) => {
    const lang = getLang(req);
    const users = adminUserService.listUsers();
    const flash = req.query.flash || "";
    res.send(usersPage(users, req.session.username, flash, lang));
  });

  app.get("/admin/users/new", requireAuth, requireSuperAdmin, (req, res) => {
    const lang = getLang(req);
    res.send(newUserPage("", lang));
  });

  app.post("/admin/users/new", requireAuth, requireSuperAdmin, (req, res) => {
    const { username, password, confirm } = req.body;
    const lang = getLang(req);
    if (password !== confirm) return res.send(newUserPage(t('password_mismatch', lang), lang));
    const result = adminUserService.createUser(username, password);
    if (!result.ok) return res.send(newUserPage(result.error, lang));
    logger.info("New administrator account has been created", { by: req.session.username, newUser: username });
    res.redirect("/admin/users?flash=" + encodeURIComponent(t('user_created', lang)));
  });

  app.post("/admin/users/:username/reset-password", requireAuth, requireSuperAdmin, (req, res) => {
    const { username } = req.params;
    const { newPassword } = req.body;
    const lang = getLang(req);
    const result = adminUserService.resetPassword(username, newPassword);
    if (!result.ok) return res.redirect(`/admin/users?flash=${encodeURIComponent(t('download_fail', lang) + result.error)}`);
    logger.info("Password reset", { by: req.session.username, target: username });
    res.redirect("/admin/users?flash=" + encodeURIComponent(t('password_reset_ok', lang)));
  });

  app.post("/admin/users/:username/delete", requireAuth, requireSuperAdmin, (req, res) => {
    const { username } = req.params;
    const lang = getLang(req);
    const result = adminUserService.deleteUser(username, req.session.username);
    if (!result.ok) return res.redirect(`/admin/users?flash=${encodeURIComponent(t('download_fail', lang) + result.error)}`);
    logger.info("Administrator account has been deleted", { by: req.session.username, deleted: username });
    res.redirect("/admin/users?flash=" + encodeURIComponent(t('user_deleted', lang)));
  });
}

module.exports = { registerUserRoutes };
