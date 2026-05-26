"use strict";

const crypto = require("crypto");
const helmet = require("helmet");

// 测试环境使用固定 nonce，避免快照/响应抖动
const FIXED_TEST_NONCE = "test-nonce-fixed";

function generateNonce() {
  if (process.env.NODE_ENV === "test") return FIXED_TEST_NONCE;
  return crypto.randomBytes(16).toString("base64");
}

// 每个请求注入 cspNonce 到 res.locals，供视图模板内联 <script> 使用
function attachSecurityContext(req, res, next) {
  res.locals.cspNonce = generateNonce();
  next();
}

// CSP 当前阶段使用 Report-Only 模式：浏览器只发 violation 报告，不真正拦截
// 后续 onclick/onsubmit 改为 addEventListener 后，再切换为 enforce 模式
function buildCsp() {
  return helmet.contentSecurityPolicy({
    reportOnly: true,
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      // 内联 <script> 必须带 nonce；外部 /admin/static/*.js 走 'self'
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
      // 当前模板大量使用内联 <style> + style="" 属性，先放宽，留待后续重构
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
    },
  });
}

// helmet 主体：默认 headers + 自定义 CSP
function buildHelmet() {
  return [
    helmet({
      contentSecurityPolicy: false, // 用下面的自定义 CSP
      crossOriginEmbedderPolicy: false, // 与现有图片/字体加载兼容
      // 其余默认：X-Frame-Options=SAMEORIGIN, X-Content-Type-Options=nosniff,
      // Referrer-Policy=no-referrer, Strict-Transport-Security 等
    }),
    buildCsp(),
  ];
}

module.exports = { attachSecurityContext, buildHelmet };
