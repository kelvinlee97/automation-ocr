"use strict";

const zh = require("./zh");
const en = require("./en");

const TRANSLATIONS = { zh, en };

function t(key, lang = "zh", params = {}) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.zh;
  let text = dict[key] || TRANSLATIONS.zh[key] || key;
  // 替换模板参数 {xxx}
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(`{${k}}`, String(v));
  }
  return text;
}

function getLang(req) {
  const validLangs = new Set(['zh', 'en']);
  const fromQuery = req.query && req.query.lang;
  if (fromQuery && validLangs.has(fromQuery)) return fromQuery;
  return 'zh';
}

module.exports = { TRANSLATIONS, t, getLang };
