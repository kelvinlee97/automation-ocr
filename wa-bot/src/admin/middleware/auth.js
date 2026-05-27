"use strict";

const adminUserService = require("../../services/adminUserService");

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect("/admin/login");
}

function requireSetup(req, res, next) {
  if (adminUserService.isEmpty()) {
    return res.redirect("/admin/setup");
  }
  next();
}

module.exports = { requireAuth, requireSetup };
