"use strict";

(function() {
  const theme = localStorage.getItem("admin-theme") || "dark";
  document.documentElement.setAttribute("data-theme", theme);
})();
