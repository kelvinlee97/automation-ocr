"use strict";

const crypto = require("crypto");

// 测试环境用固定 token，便于测试用例显式构造请求；生产每个 session 一份
const FIXED_TEST_TOKEN = "test-csrf-token-fixed";

function generateToken() {
  if (process.env.NODE_ENV === "test") return FIXED_TEST_TOKEN;
  return crypto.randomBytes(32).toString("base64url");
}

// 不需要 CSRF 校验的方法
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// 注入 token 到 session（如缺失则生成）+ 注入到 res.locals.csrfToken 供模板使用
function csrfProtection(req, res, next) {
  if (!req.session) return next();

  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method)) return next();

  // 从 form body 或 header 读取
  const submitted =
    (req.body && req.body._csrf) ||
    req.get("x-csrf-token") ||
    req.get("x-xsrf-token");

  if (!submitted || submitted !== req.session.csrfToken) {
    return res.status(403).send("CSRF token missing or invalid");
  }
  return next();
}

module.exports = { csrfProtection };
