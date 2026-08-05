"use strict";

const en = require("./en");

const TRANSLATIONS = { en };

function t(key, lang = "en", params = {}) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  let text = dict[key] || TRANSLATIONS.en[key] || key;
  // Replace template parameters {xxx}
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(`{${k}}`, String(v));
  }
  return text;
}

function getLang(_req) {
  return 'en';
}

module.exports = { TRANSLATIONS, t, getLang };
