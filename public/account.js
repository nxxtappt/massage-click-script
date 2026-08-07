(() => {
  const authCard = document.getElementById("authCard");
  const profileCard = document.getElementById("profileCard");
  const requestCodeForm = document.getElementById("requestCodeForm");
  const verifyCodeForm = document.getElementById("verifyCodeForm");
  const emailInput = document.getElementById("accountEmail");
  const codeInput = document.getElementById("accountCode");
  const authStatus = document.getElementById("authStatus");
  const accountStatus = document.getElementById("accountStatus");
  let pendingEmail = "";

  async function jsonFetch(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
  }

  function showSignedOut() {
    authCard.hidden = false;
    profileCard.hidden = true;
  }

  function renderAlerts(alerts = []) {
    const target = document.getElementById("alertsList");
    if (!alerts.length) {
      target.innerHTML = `<p class="muted">No appointment alerts yet.</p>`;
      return;
    }

    target.innerHTML = alerts.map((alert) => `
      <div class="alert-row">
        <strong>${escapeHtml(alert.label || alert.serviceType || "Appointment alert")}</strong>
        <div>${escapeHtml([alert.metro, alert.categorySlug, alert.durationMinutes ? `${alert.durationMinutes} min` : ""].filter(Boolean).join(" · "))}</div>
        <small>${escapeHtml(alert.status || "active")}</small>
      </div>
    `).join("");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderAccount(data) {
    authCard.hidden = true;
    profileCard.hidden = false;
    document.getElementById("signedInEmail").textContent = data.user?.email || "";
    document.getElementById("firstName").value = data.user?.firstName || "";
    document.getElementById("appointmentAlertsEnabled").checked = Boolean(data.preferences?.appointmentAlertsEnabled);
    document.getElementById("productUpdatesEnabled").checked = Boolean(data.preferences?.productUpdatesEnabled);
    document.getElementById("marketingEnabled").checked = Boolean(data.preferences?.marketingEnabled);
    renderAlerts(data.alerts || []);
  }

  async function loadMe() {
    try {
      const data = await jsonFetch("/api/user/me");
      renderAccount(data);
    } catch {
      showSignedOut();
    }
  }

  async function requestCode() {
    pendingEmail = String(emailInput.value || "").trim().toLowerCase();
    authStatus.textContent = "Sending code...";

    const data = await jsonFetch("/api/user/auth/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: pendingEmail, source: "account" })
    });

    authStatus.textContent = data.message || "Login code sent.";
    verifyCodeForm.hidden = false;
    codeInput.focus();
  }

  requestCodeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await requestCode();
    } catch (error) {
      authStatus.textContent = error.message;
    }
  });

  document.getElementById("requestAnotherCode").addEventListener("click", async () => {
    try {
      await requestCode();
    } catch (error) {
      authStatus.textContent = error.message;
    }
  });

  verifyCodeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    authStatus.textContent = "Verifying...";

    try {
      const data = await jsonFetch("/api/user/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail || emailInput.value, code: codeInput.value })
      });
      authStatus.textContent = "";
      renderAccount({ ...data, alerts: [] });
      await loadMe();
    } catch (error) {
      authStatus.textContent = error.message;
    }
  });

  document.getElementById("profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    accountStatus.textContent = "Saving profile...";
    try {
      await jsonFetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: document.getElementById("firstName").value })
      });
      accountStatus.textContent = "Profile saved.";
    } catch (error) {
      accountStatus.textContent = error.message;
    }
  });

  document.getElementById("preferencesForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    accountStatus.textContent = "Saving preferences...";
    try {
      await jsonFetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentAlertsEnabled: document.getElementById("appointmentAlertsEnabled").checked,
          productUpdatesEnabled: document.getElementById("productUpdatesEnabled").checked,
          marketingEnabled: document.getElementById("marketingEnabled").checked
        })
      });
      accountStatus.textContent = "Email preferences saved.";
    } catch (error) {
      accountStatus.textContent = error.message;
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    try {
      await jsonFetch("/api/user/auth/logout", { method: "POST" });
    } catch {
      // Clear the UI even if the server session already expired.
    }
    verifyCodeForm.hidden = true;
    codeInput.value = "";
    showSignedOut();
  });

  loadMe();
})();