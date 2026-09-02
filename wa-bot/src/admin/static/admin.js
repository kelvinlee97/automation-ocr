"use strict";

(function() {
  const config = window.ADMIN_UI || {};
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
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function() {
      toast.classList.add("toast-out");
      setTimeout(function() { toast.remove(); }, 250);
    }, 3000);
  };

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
