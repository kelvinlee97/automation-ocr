"use strict";

const adminUserService = require("../../services/adminUserService");

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect("/admin/login");
}

function requireSuperAdmin(req, res, next) {
  if (req.session?.authenticated && adminUserService.isSuperAdmin(req.session.username)) {
    return next();
  }
  res.status(403).send("Forbidden");
}

function requireSetup(req, res, next) {
  if (adminUserService.isEmpty()) {
    return res.redirect("/admin/setup");
  }
  next();
}

module.exports = { requireAuth, requireSuperAdmin, requireSetup };
