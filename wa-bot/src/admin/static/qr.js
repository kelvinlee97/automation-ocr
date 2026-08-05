"use strict";

(function() {
  const config = window.QR_PAGE || {};
  const T = config.T || {};

  window.switchTab = function(name, btn) {
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach((button) => button.classList.remove("active"));
    document.getElementById("tab-" + name).classList.add("active");
    btn.classList.add("active");
  };

  window.requestCode = async function() {
    const phone = document.getElementById("phone-input").value.trim();
    const btn = document.getElementById("get-code-btn");
    const errEl = document.getElementById("error-msg");
    const codeVal = document.getElementById("code-value");
    const codePlaceholder = document.getElementById("code-placeholder");

    errEl.style.display = "none";
    codeVal.style.display = "none";
    codePlaceholder.style.display = "block";
    codePlaceholder.textContent = T.requesting;

    btn.disabled = true;
    btn.textContent = T.fetching;

    try {
      const res = await fetch("/admin/request-pairing-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();

      if (!res.ok) {
        errEl.textContent = data.error || T.networkError;
        errEl.style.display = "block";
        codePlaceholder.textContent = T.codePlaceholder;
      } else {
        codeVal.textContent = data.code;
        codeVal.style.display = "block";
        codePlaceholder.style.display = "none";
      }
    } catch (_err) {
      errEl.textContent = T.networkError;
      errEl.style.display = "block";
      codePlaceholder.textContent = T.codePlaceholder;
    } finally {
      btn.disabled = false;
      btn.textContent = T.refetch;
    }
  };

  const CHECK_INTERVAL = 3000;
  const lastHasQR = !!config.lastHasQR;

  async function checkStatus() {
    try {
      const res = await fetch("/admin/wa-status");
      const { connected, hasQR } = await res.json();

      if (connected) {
        window.location.href = "/admin/login";
        return;
      }

      if (hasQR !== lastHasQR) {
        window.location.reload();
        return;
      }
    } catch (_err) {
      // Network exceptions are handled silently and polling will continue next time.
    }

    setTimeout(checkStatus, CHECK_INTERVAL);
  }

  setTimeout(checkStatus, CHECK_INTERVAL);
})();
