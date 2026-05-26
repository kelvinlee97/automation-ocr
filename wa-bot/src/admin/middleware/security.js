"use strict";

function attachSecurityContext(req, res, next) {
  res.locals.cspNonce = "";
  next();
}

module.exports = { attachSecurityContext };
