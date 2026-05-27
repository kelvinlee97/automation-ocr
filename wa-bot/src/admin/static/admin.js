"use strict";

(function() {
  const config = window.ADMIN_UI || {};
  const initialLang = config.lang || "zh";

  window.openLightbox = function(src) {
    document.getElementById("lightbox-img").src = src;
    document.getElementById("lightbox").classList.add("active");
  };

  window.closeLightbox = function() {
    document.getElementById("lightbox").classList.remove("active");
  };

  const lightbox = document.getElementById("lightbox");
  if (lightbox) {
    lightbox.addEventListener("click", function(e) {
      if (e.target === this) window.closeLightbox();
    });
  }

  window.showToast = function(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast toast-" + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function() {
      toast.classList.add("toast-out");
      setTimeout(function() { toast.remove(); }, 250);
    }, 3000);
  };

  (function() {
    const LANG_KEY = "admin-lang";
    const langBtn = document.getElementById("langToggle");
    if (!langBtn) return;

    function applyLang(lang) {
      document.documentElement.lang = lang;
      langBtn.textContent = lang === "zh" ? "EN" : "中文";
      localStorage.setItem(LANG_KEY, lang);
    }

    const saved = localStorage.getItem(LANG_KEY) || initialLang;
    applyLang(saved);

    langBtn.addEventListener("click", function() {
      const current = localStorage.getItem(LANG_KEY) || initialLang;
      const next = current === "zh" ? "en" : "zh";
      applyLang(next);
      const url = window.location.pathname;
      const sep = url.indexOf("?") === -1 ? "?" : "&";
      window.location.href = url + sep + "lang=" + next;
    });
  })();

  (function() {
    const STORAGE_KEY = "admin-theme";
    const btn = document.getElementById("themeToggle");
    if (!btn) return;

    function applyTheme(theme) {
      document.documentElement.setAttribute("data-theme", theme);
      btn.textContent = theme === "light" ? "🌙" : "☀️";
      btn.title = theme === "light" ? config.switchToDark : config.switchToLight;
      localStorage.setItem(STORAGE_KEY, theme);
    }

    const saved = localStorage.getItem(STORAGE_KEY) || "dark";
    applyTheme(saved);

    btn.addEventListener("click", function() {
      const current = document.documentElement.getAttribute("data-theme");
      applyTheme(current === "light" ? "dark" : "light");
    });
  })();
})();
