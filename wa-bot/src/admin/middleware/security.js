"use strict";

function attachSecurityContext(req, res, next) {
  next();
}

module.exports = { attachSecurityContext };
