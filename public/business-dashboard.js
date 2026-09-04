const content = document.getElementById("content");
const statusBox = document.getElementById("statusBox");
const logoutBtn = document.getElementById("logoutBtn");
const dashboardNav = document.getElementById("dashboardNav");
const dashboardAccount = document.getElementById("dashboardAccount");
const dashboardTitle = document.getElementById("dashboardTitle");
const dashboardSubtitle = document.getElementById("dashboardSubtitle");

function setStatus(message, type = "info") {
  if (!statusBox) return;
  statusBox.textContent = message;
  statusBox.className = `status-box ${type}`;
  statusBox.hidden = false;
}

function hideStatus() {
  if (!statusBox) return;
  statusBox.hidden = true;
}

function setDashboardNav(items = [], accountLabel = "") {
  if (dashboardNav) {
    dashboardNav.innerHTML = items
      .map(
        (item, index) => `
          <a
            class="business-dashboard-nav-link${index === 0 ? " active" : ""}"
            href="#${escapeHtml(item.id)}"
            data-dashboard-nav="${escapeHtml(item.id)}"
          >
            ${escapeHtml(item.label)}
          </a>
        `
      )
      .join("");
    dashboardNav.hidden = items.length === 0;

    dashboardNav.querySelectorAll("[data-dashboard-nav]").forEach((link) => {
      link.addEventListener("click", () => {
        dashboardNav
          .querySelectorAll("[data-dashboard-nav]")
          .forEach((item) => item.classList.remove("active"));
        link.classList.add("active");
      });
    });
  }

  if (dashboardAccount) {
    dashboardAccount.textContent = accountLabel;
    dashboardAccount.hidden = !accountLabel;
  }
}

function getSessionToken() {
  return localStorage.getItem("nextappt_business_session") || "";
}

function setSessionToken(token) {
  localStorage.setItem("nextappt_business_session", token);
}

function clearSessionToken() {
  localStorage.removeItem("nextappt_business_session");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatValue(value) {
  if (value === 0) return "0";
  if (!value) return "Not available";

  const parsed = new Date(value);

  if (!Number.isNaN(parsed.getTime()) && String(value).includes("T")) {
    return parsed.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    });
  }

  return value;
}

async function parseJsonResponse(response) {
  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Server returned non-JSON response. Status ${response.status}. Response starts with: ${text.slice(0, 180)}`
    );
  }

  if (!response.ok) {
    throw new Error(data.error || response.statusText);
  }

  return data;
}

async function fetchJson(url, options = {}) {
  const token = getSessionToken();

  const headers = {
    ...(options.headers || {})
  };

  if (token) {
    headers["x-business-session"] = token;
  }

  const method = String(options.method || "GET").toUpperCase();
  const response = await fetch(url, {
    ...options,
    headers,
    cache: options.cache || (method === "GET" ? "no-store" : "default")
  });

  return parseJsonResponse(response);
}

async function fetchFormJson(url, formData) {
  const token = getSessionToken();

  const headers = {};

  if (token) {
    headers["x-business-session"] = token;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: formData
  });

  return parseJsonResponse(response);
}

function renderLoginRequest() {
  logoutBtn.style.display = "none";
  setDashboardNav([]);

  if (dashboardTitle) dashboardTitle.textContent = "Business Dashboard";
  if (dashboardSubtitle) {
    dashboardSubtitle.textContent = "Manage how your business appears on NextAppt.";
  }

  content.innerHTML = `
    <div class="admin-business-card">
      <h3>Business Login</h3>

      <p>
        Enter the email associated with your verified business account.
      </p>

      <div class="business-edit-grid">
        <div class="admin-field">
          <span>Email</span>

          <input
            id="loginEmail"
            type="email"
            placeholder="owner@business.com"
            autocomplete="email"
          />
        </div>
      </div>

      <div class="settings-actions">
        <button id="requestCodeBtn" class="primary-btn">
          Send Login Code
        </button>
      </div>
    </div>
  `;

  document
    .getElementById("requestCodeBtn")
    ?.addEventListener("click", requestLoginCode);
}

function renderCodeVerification(email) {
  content.innerHTML = `
    <div class="admin-business-card">
      <h3>Verify Login Code</h3>

      <p>
        Enter the login code sent to:
        <strong>${escapeHtml(email)}</strong>
      </p>

      <div class="business-edit-grid">
        <div class="admin-field">
          <span>Login Code</span>

          <input
            id="loginCode"
            type="text"
            placeholder="123456"
            autocomplete="one-time-code"
          />
        </div>
      </div>

      ${window.NextApptLegal ? window.NextApptLegal.getBusinessMarkup() : ""}

      <div class="settings-actions">
        <button id="verifyCodeBtn" class="primary-btn">
          Verify Code
        </button>
      </div>
    </div>
  `;

  document
    .getElementById("verifyCodeBtn")
    ?.addEventListener("click", () => verifyLoginCode(email));
}

function renderField(label, value) {
  return `
    <div class="admin-field">
      <span>${escapeHtml(label)}</span>

      <input
        value="${escapeHtml(formatValue(value))}"
        disabled
      />
    </div>
  `;
}

function getBusinessProfileChecklist(dashboard) {
  const profile = dashboard.profile || {};
  const publicProfile = profile.publicProfile || {};

  return [
    { label: "Logo", complete: Boolean(profile.logoUrl) },
    { label: "Phone", complete: Boolean(profile.phone) },
    { label: "Website", complete: Boolean(profile.website) },
    {
      label: "Short description",
      complete: Boolean(publicProfile.shortDescription)
    },
    { label: "Business bio", complete: Boolean(publicProfile.bio) }
  ];
}

function renderDashboardOverview(dashboard) {
  const profile = dashboard.profile || {};
  const checklist = getBusinessProfileChecklist(dashboard);
  const completedCount = checklist.filter((item) => item.complete).length;
  const completionPercent = Math.round(
    (completedCount / Math.max(checklist.length, 1)) * 100
  );
  const missingItems = checklist
    .filter((item) => !item.complete)
    .map((item) => item.label);
  const businessId = dashboard.businessId || "";
  const publicBusinessUrl = businessId
    ? `/business/${encodeURIComponent(businessId)}`
    : "";

  return `
    <div class="dashboard-overview-card">
      <div class="dashboard-overview-heading">
        <div>
          <span class="dashboard-eyebrow">Business overview</span>
          <h3>${escapeHtml(profile.businessName || dashboard.businessName)}</h3>
          <p>Keep your listing complete, connected, and ready for customers.</p>
        </div>

        <div class="dashboard-overview-actions">
          <a class="secondary-btn dashboard-link-btn" href="#business-profile">
            Edit business profile
          </a>
          ${
            publicBusinessUrl
              ? `
                <a
                  class="primary-btn dashboard-link-btn"
                  href="${escapeHtml(publicBusinessUrl)}"
                  target="_blank"
                  rel="noopener"
                >
                  View public listing
                </a>
              `
              : ""
          }
        </div>
      </div>

      <div class="dashboard-summary-grid">
        <div class="dashboard-summary-item">
          <span>Listing status</span>
          <strong>${escapeHtml(profile.verificationStatus || "Verified")}</strong>
        </div>
        <div class="dashboard-summary-item">
          <span>Availability connection</span>
          <strong>${escapeHtml(profile.integrationStatus || "Needs setup")}</strong>
          <small>${escapeHtml(profile.connectedProvider || "Not connected")}</small>
        </div>
        <div class="dashboard-summary-item">
          <span>Last availability update</span>
          <strong>${escapeHtml(formatValue(profile.lastSyncTimestamp))}</strong>
        </div>
      </div>

      <div class="profile-strength" aria-label="Business profile completeness">
        <div class="profile-strength-copy">
          <div>
            <strong>Profile completeness</strong>
            <span>${completedCount} of ${checklist.length} essentials complete</span>
          </div>
          <strong>${completionPercent}%</strong>
        </div>
        <div
          class="profile-strength-track"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="${completionPercent}"
        >
          <span style="width:${completionPercent}%"></span>
        </div>
        ${
          missingItems.length
            ? `<p>Add ${escapeHtml(missingItems.join(", "))} to finish your public profile.</p>`
            : `<p>Your public profile essentials are complete.</p>`
        }
      </div>
    </div>
  `;
}

function renderBusinessProfilePanel(dashboard) {
  const profile = dashboard.profile || {};
  const publicProfile = profile.publicProfile || {};
  const businessName = profile.businessName || dashboard.businessName || "Business";
  const logoAltPlaceholder = `${businessName} logo`;
  const logoFallback = businessName.trim().charAt(0).toUpperCase() || "N";
  const hostedLogoUrl = /^https?:\/\//i.test(profile.logoUrl || "")
    ? profile.logoUrl
    : "";

  return `
    <div class="admin-business-card business-profile-card">
      <div class="business-card-header">
        <div>
          <span class="dashboard-eyebrow">Public listing</span>
          <h3>Business Profile</h3>
          <p>Update the information customers see on NextAppt.</p>
        </div>
        <span class="platform-pill">
          ${escapeHtml(profile.verificationStatus || "verified")}
        </span>
      </div>

      <form
        id="businessProfileForm"
        data-current-logo-url="${escapeHtml(profile.logoUrl || "")}"
        novalidate
      >
        <div class="profile-editor-grid">
          <section class="profile-logo-editor" aria-labelledby="businessLogoHeading">
            <div>
              <h4 id="businessLogoHeading">Business logo</h4>
              <p class="field-help">Shown on your search card and public business page.</p>
            </div>

            <div class="profile-logo-preview-row">
              <div class="profile-logo-preview">
                <img
                  id="currentLogoPreview"
                  ${profile.logoUrl ? `src="${escapeHtml(profile.logoUrl)}"` : ""}
                  alt="${escapeHtml(profile.logoAlt || logoAltPlaceholder)}"
                  ${profile.logoUrl ? "" : "hidden"}
                />
                <span id="currentLogoFallback" ${profile.logoUrl ? "hidden" : ""}>
                  ${escapeHtml(logoFallback)}
                </span>
              </div>
              <div>
                <strong id="logoPreviewLabel">
                  ${profile.logoUrl ? "Current logo" : "No logo uploaded"}
                </strong>
                <span id="selectedLogoFileName">
                  Choose a new image to replace it.
                </span>
              </div>
            </div>

            <label class="admin-field">
              <span>Choose logo image</span>
              <input
                id="profileLogoFile"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
              />
              <small class="field-help">PNG, JPG, WEBP, or GIF. Maximum 3MB.</small>
            </label>

            <label class="admin-field">
              <span>Logo alt text</span>
              <input
                id="profileLogoAlt"
                value="${escapeHtml(profile.logoAlt || "")}"
                placeholder="${escapeHtml(logoAltPlaceholder)}"
              />
              <small class="field-help">A short description for screen readers.</small>
            </label>

            <details class="profile-advanced-logo">
              <summary>Use a hosted logo URL instead</summary>
              <label class="admin-field">
                <span>Logo URL</span>
                <input
                  id="profileLogoUrl"
                  type="url"
                  value="${escapeHtml(hostedLogoUrl)}"
                  placeholder="https://example.com/logo.png"
                />
              </label>
            </details>
          </section>

          <section class="profile-details-editor" aria-labelledby="businessDetailsHeading">
            <div>
              <h4 id="businessDetailsHeading">Contact and description</h4>
              <p class="field-help">Give customers enough information to choose your business.</p>
            </div>

            <div class="business-edit-grid profile-contact-grid">
              <label class="admin-field">
                <span>Phone</span>
                <input
                  id="profilePhone"
                  type="tel"
                  value="${escapeHtml(profile.phone || "")}"
                  placeholder="Business phone"
                  autocomplete="tel"
                />
              </label>

              <label class="admin-field">
                <span>Website</span>
                <input
                  id="profileWebsite"
                  type="url"
                  value="${escapeHtml(profile.website || "")}"
                  placeholder="https://example.com"
                  autocomplete="url"
                />
              </label>

              <label class="admin-field admin-field-full">
                <span>Search card description</span>
                <textarea
                  id="profileShortDescription"
                  rows="3"
                  maxlength="220"
                  placeholder="A short sentence shown on your verified search card."
                >${escapeHtml(publicProfile.shortDescription || "")}</textarea>
                <small class="field-help">
                  <span id="profileShortDescriptionCount">0</span>/220 characters
                </small>
              </label>

              <label class="admin-field admin-field-full">
                <span>Business bio</span>
                <textarea
                  id="profileBio"
                  rows="6"
                  maxlength="2500"
                  placeholder="Tell customers what makes your business different."
                >${escapeHtml(publicProfile.bio || "")}</textarea>
                <small class="field-help">
                  <span id="profileBioCount">0</span>/2500 characters
                </small>
              </label>
            </div>
          </section>
        </div>

        <div class="profile-save-bar">
          <button id="saveBusinessProfileBtn" class="primary-btn" type="submit">
            Save Business Profile
          </button>
          <span id="businessProfileDirty" class="unsaved-indicator" hidden>
            Unsaved changes
          </span>
        </div>

        <div
          id="businessProfileStatus"
          class="status-box profile-status"
          role="status"
          aria-live="polite"
        ></div>
      </form>
    </div>
  `;
}

function renderCredentialConnectionPanel(dashboard) {
  const profile = dashboard.profile || {};
  const businessName = profile.businessName || dashboard.businessName || "";
  const ownerEmail = dashboard.email || profile.email || "";

  return `
    <div class="admin-business-card">
      <div class="business-card-header">
        <div>
          <h3>Connect CRM/API</h3>
          <p>
            Submit secure API credentials so NextAppt can display live
            availability for your verified business.
          </p>
        </div>
      </div>

      <div class="business-edit-grid">
        <div class="admin-field">
          <span>Business</span>

          <input
            id="credentialBusinessName"
            value="${escapeHtml(businessName)}"
            disabled
          />
        </div>

        <div class="admin-field">
          <span>Your Email</span>

          <input
            id="credentialOwnerEmail"
            type="email"
            value="${escapeHtml(ownerEmail)}"
            placeholder="you@business.com"
          />
        </div>

        <div class="admin-field">
          <span>CRM Provider</span>

          <select id="apiProvider">
            <option value="mindbody">Mindbody</option>
            <option value="vagaro">Vagaro</option>
            <option value="meevo">Meevo</option>
            <option value="booker">Booker</option>
            <option value="zenoti">Zenoti</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div class="admin-field">
          <span>API Key / Token</span>

          <input
            id="apiKey"
            type="password"
            placeholder="Paste API key/token"
          />
        </div>

        <div class="admin-field mindbody-credential-field">
          <span>Mindbody Site ID</span>

          <input
            id="siteId"
            placeholder="Example: 527423"
          />
        </div>

        <div class="admin-field mindbody-credential-field">
          <span>Location ID</span>

          <input
            id="locationId"
            placeholder="Example: 1"
          />
        </div>
      </div>

      <div class="settings-actions">
        <button id="saveCredentialBtn" class="primary-btn">
          Save Encrypted Credential
        </button>
      </div>

      <div id="credentialStatus" class="status-box"></div>
    </div>
  `;
}

function renderAnalyticsPanel(dashboard) {
  const analytics = dashboard.analytics || {};
  const topServices = analytics.topServices || [];
  const topWeekdays = analytics.topWeekdays || [];
  const topTimeBuckets = analytics.topTimeBuckets || [];
  const heatmap = analytics.heatmap || [];

  const topService = topServices[0]?.label || "Not enough data";
  const topDay = topWeekdays[0]?.label || "Not enough data";
  const topTime = topTimeBuckets[0]?.label || "Not enough data";

  const weekdays = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday"
  ];

  const timeBuckets = [
    ...new Set(
      heatmap
        .map((item) => item.time)
        .filter(Boolean)
    )
  ];

  const maxCount = Math.max(
    1,
    ...heatmap.map((item) => Number(item.count || 0))
  );

  const getCellCount = (weekday, time) => {
    const match = heatmap.find((item) => {
      return item.weekday === weekday && item.time === time;
    });

    return match ? Number(match.count || 0) : 0;
  };

  const getHeatStyle = (count) => {
    if (!count) {
      return "background:#f4f4f5;color:#999;";
    }

    const intensity = count / maxCount;

    if (intensity >= 0.75) {
      return "background:#14532d;color:white;font-weight:800;";
    }

    if (intensity >= 0.5) {
      return "background:#22c55e;color:white;font-weight:800;";
    }

    if (intensity >= 0.25) {
      return "background:#86efac;color:#14532d;font-weight:800;";
    }

    return "background:#dcfce7;color:#14532d;font-weight:800;";
  };

  const renderList = (items) => {
    if (!items.length) {
      return `<p>Not enough click data yet.</p>`;
    }

    return `
      <ul>
        ${items
          .map((item) => {
            return `
              <li>
                <strong>${escapeHtml(item.label)}</strong>
                — ${escapeHtml(item.count)} click${item.count === 1 ? "" : "s"}
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  };

  const renderHeatmap = () => {
    if (!heatmap.length || !timeBuckets.length) {
      return `<p>Not enough day/time click data yet.</p>`;
    }

    return `
      <div style="overflow-x:auto;margin-top:12px;">
        <table style="width:100%;border-collapse:separate;border-spacing:4px;min-width:720px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:10px;">Day</th>

              ${timeBuckets
                .map((time) => {
                  return `
                    <th style="text-align:center;padding:10px;font-size:12px;">
                      ${escapeHtml(time)}
                    </th>
                  `;
                })
                .join("")}
            </tr>
          </thead>

          <tbody>
            ${weekdays
              .map((weekday) => {
                return `
                  <tr>
                    <td style="padding:10px;font-weight:800;white-space:nowrap;">
                      ${escapeHtml(weekday)}
                    </td>

                    ${timeBuckets
                      .map((time) => {
                        const count = getCellCount(weekday, time);

                        return `
                          <td
                            style="
                              text-align:center;
                              padding:12px;
                              border-radius:10px;
                              ${getHeatStyle(count)}
                            "
                          >
                            ${count > 0 ? escapeHtml(count) : "—"}
                          </td>
                        `;
                      })
                      .join("")}
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  };

  return `
    <div class="admin-business-card">
      <div class="business-card-header">
        <div>
          <h3>Appointment Analytics</h3>
          <p>See which appointment days and times are getting the most visitor interest.</p>
        </div>

        <div class="business-header-actions">
          <span class="platform-pill">
            ${escapeHtml(analytics.totalClicks || 0)} clicks
          </span>
        </div>
      </div>

      <div class="business-edit-grid">
        ${renderField("Total Appointment Clicks", analytics.totalClicks || 0)}
        ${renderField("Most Popular Service", topService)}
        ${renderField("Most Popular Day", topDay)}
        ${renderField("Most Popular Time", topTime)}
      </div>

      <div style="margin-top:18px;">
        <h4>Visitor Interest Heatmap</h4>
        ${renderHeatmap()}

        <h4>Top Services</h4>
        ${renderList(topServices)}

        <h4>Top Days</h4>
        ${renderList(topWeekdays)}

        <h4>Top Times</h4>
        ${renderList(topTimeBuckets)}
      </div>
    </div>
  `;
}

function attachBusinessProfileHandlers() {
  const form = document.getElementById("businessProfileForm");
  const saveBusinessProfileBtn = document.getElementById("saveBusinessProfileBtn");
  const logoFileInput = document.getElementById("profileLogoFile");
  const logoUrlInput = document.getElementById("profileLogoUrl");
  const businessProfileStatus = document.getElementById("businessProfileStatus");
  const businessProfileDirty = document.getElementById("businessProfileDirty");
  const currentLogoPreview = document.getElementById("currentLogoPreview");
  const currentLogoFallback = document.getElementById("currentLogoFallback");
  const logoPreviewLabel = document.getElementById("logoPreviewLabel");
  const selectedLogoFileName = document.getElementById("selectedLogoFileName");
  const shortDescription = document.getElementById("profileShortDescription");
  const bio = document.getElementById("profileBio");
  let saveInFlight = false;
  let selectedObjectUrl = "";

  if (!form || !saveBusinessProfileBtn) return;

  const setProfileStatus = (message, type = "info") => {
    if (!businessProfileStatus) return;
    businessProfileStatus.textContent = message;
    businessProfileStatus.className = `status-box profile-status ${type}`;
  };

  const updateCharacterCount = (input, outputId) => {
    const output = document.getElementById(outputId);
    if (output) output.textContent = String(input?.value.length || 0);
  };

  const markDirty = () => {
    if (businessProfileDirty) businessProfileDirty.hidden = false;
  };

  const setBusy = (busy) => {
    saveInFlight = busy;
    saveBusinessProfileBtn.disabled = busy;
    saveBusinessProfileBtn.setAttribute("aria-busy", busy ? "true" : "false");
    saveBusinessProfileBtn.textContent = busy
      ? "Saving Business Profile..."
      : "Save Business Profile";
  };

  updateCharacterCount(shortDescription, "profileShortDescriptionCount");
  updateCharacterCount(bio, "profileBioCount");

  shortDescription?.addEventListener("input", () => {
    updateCharacterCount(shortDescription, "profileShortDescriptionCount");
  });

  bio?.addEventListener("input", () => {
    updateCharacterCount(bio, "profileBioCount");
  });

  form.querySelectorAll("input, textarea").forEach((control) => {
    control.addEventListener("input", markDirty);
    control.addEventListener("change", markDirty);
  });

  if (currentLogoPreview) {
    currentLogoPreview.addEventListener("error", () => {
      currentLogoPreview.hidden = true;
      if (currentLogoFallback) currentLogoFallback.hidden = false;
      if (logoPreviewLabel) logoPreviewLabel.textContent = "Logo could not be loaded";
    });
  }

  if (logoFileInput) {
    logoFileInput.addEventListener("change", () => {
      const file = logoFileInput.files && logoFileInput.files[0];

      if (!file) {
        if (selectedObjectUrl) URL.revokeObjectURL(selectedObjectUrl);
        selectedObjectUrl = "";

        if (currentLogoPreview && form.dataset.currentLogoUrl) {
          currentLogoPreview.src = form.dataset.currentLogoUrl;
          currentLogoPreview.hidden = false;
          if (currentLogoFallback) currentLogoFallback.hidden = true;
        } else if (currentLogoPreview) {
          currentLogoPreview.removeAttribute("src");
          currentLogoPreview.hidden = true;
          if (currentLogoFallback) currentLogoFallback.hidden = false;
        }

        if (logoPreviewLabel) logoPreviewLabel.textContent = "Current logo";
        if (selectedLogoFileName) {
          selectedLogoFileName.textContent = "Choose a new image to replace it.";
        }
        return;
      }

      if (file.size > 3 * 1024 * 1024) {
        logoFileInput.value = "";
        setProfileStatus("Logo file is too large. Maximum size is 3MB.", "error");
        return;
      }

      const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];

      if (file.type && !allowedTypes.includes(file.type)) {
        logoFileInput.value = "";
        setProfileStatus("Choose a PNG, JPG, WEBP, or GIF logo image.", "error");
        return;
      }

      if (selectedObjectUrl) URL.revokeObjectURL(selectedObjectUrl);
      selectedObjectUrl = URL.createObjectURL(file);

      if (currentLogoPreview) {
        currentLogoPreview.src = selectedObjectUrl;
        currentLogoPreview.hidden = false;
      }

      if (currentLogoFallback) currentLogoFallback.hidden = true;

      if (logoPreviewLabel) logoPreviewLabel.textContent = "New logo preview";
      if (selectedLogoFileName) selectedLogoFileName.textContent = file.name;
      setProfileStatus(
        "Your new logo is selected. Save the business profile to publish it.",
        "info"
      );
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (saveInFlight) return;

    try {
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      setBusy(true);
      setProfileStatus("Saving your business profile...", "info");

      const expectedLogoUrl = form.dataset.currentLogoUrl || "";
      let logoUrl = logoUrlInput?.value.trim() || "";
      const file = logoFileInput?.files?.[0];

      if (file) {
        setProfileStatus("Uploading your logo and saving your profile...", "info");

        const formData = new FormData();
        formData.append("logoFile", file);

        const uploadData = await fetchFormJson(
          "/api/business-dashboard/profile/logo-upload",
          formData
        );

        logoUrl = uploadData.profile?.logoUrl || logoUrl;

        if (logoUrlInput) logoUrlInput.value = logoUrl;
      }

      const payload = {
        logoUrl,
        expectedLogoUrl,
        logoAlt: document.getElementById("profileLogoAlt")?.value.trim() || "",
        phone: document.getElementById("profilePhone")?.value.trim() || "",
        website: document.getElementById("profileWebsite")?.value.trim() || "",
        shortDescription:
          document.getElementById("profileShortDescription")?.value.trim() || "",
        bio: document.getElementById("profileBio")?.value.trim() || ""
      };

      const data = await fetchJson("/api/business-dashboard/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (selectedObjectUrl) URL.revokeObjectURL(selectedObjectUrl);
      selectedObjectUrl = "";

      await loadDashboard({
        notice: data.message || "Business profile saved.",
        noticeType: data.logoConflict ? "info" : "success",
        profileNotice: data.message || "Business profile saved.",
        profileNoticeType: data.logoConflict ? "info" : "success"
      });
    } catch (error) {
      console.error("BUSINESS PROFILE SAVE ERROR:", error);

      setProfileStatus(error.message, "error");
      setStatus(`Profile save error: ${error.message}`, "error");
    } finally {
      if (document.body.contains(saveBusinessProfileBtn)) {
        setBusy(false);
      }
    }
  });
}

function attachCredentialConnectionHandlers(dashboard) {
  const saveCredentialBtn = document.getElementById("saveCredentialBtn");
  const apiProvider = document.getElementById("apiProvider");
  const credentialStatus = document.getElementById("credentialStatus");

  if (apiProvider) {
    apiProvider.addEventListener("change", () => {
      const showMindbody = apiProvider.value === "mindbody";

      document
        .querySelectorAll(".mindbody-credential-field")
        .forEach((field) => {
          field.style.display = showMindbody ? "" : "none";
        });
    });
  }

  if (!saveCredentialBtn) {
    return;
  }

  saveCredentialBtn.addEventListener("click", async () => {
    try {
      if (credentialStatus) {
        credentialStatus.textContent = "Encrypting and saving credential...";
      }

      const profile = dashboard.profile || {};

      const payload = {
        businessName: profile.businessName || dashboard.businessName || "",
        ownerEmail:
          document.getElementById("credentialOwnerEmail")?.value.trim() || "",
        apiProvider: document.getElementById("apiProvider")?.value || "",
        apiKey: document.getElementById("apiKey")?.value.trim() || "",
        siteId: document.getElementById("siteId")?.value.trim() || "",
        locationId: document.getElementById("locationId")?.value.trim() || ""
      };

      const data = await fetchJson("/api/business/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (credentialStatus) {
        credentialStatus.textContent = [
          "Credential saved encrypted.",
          `Credential ID: ${data.credential.credentialId}`,
          `Connection test: ${
            data.testResult.tested ? data.testResult.success : "not tested"
          }`,
          `Message: ${data.testResult.message}`
        ].join("\n");
      }

      const apiKey = document.getElementById("apiKey");

      if (apiKey) {
        apiKey.value = "";
      }
    } catch (error) {
      if (credentialStatus) {
        credentialStatus.textContent = error.message;
      }
    }
  });
}

function renderLockedPremiumPanel(title, description) {
  return `
    <div class="admin-business-card premium-locked-card">
      <div class="business-card-header">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(description)}</p>
        </div>

        <div class="business-header-actions">
          <span class="platform-pill">Premium</span>
        </div>
      </div>

      <p style="margin-top:12px;color:#64748b;">
        Upgrade to Premium to unlock this feature.
      </p>
    </div>
  `;
}

function renderBookingWidgetPanel(dashboard) {
  const profile = dashboard.profile || {};
  const bookingIntegration = profile.bookingIntegration || {};
  const widgetType = bookingIntegration.widgetType || bookingIntegration.type || "url";
  const enabled = bookingIntegration.enabled === true;

  return `
    <div class="admin-business-card">
      <div class="business-card-header">
        <div>
          <h3>Booking Widget</h3>
          <p>Universal booking widget support for HTML embed snippets, iframe URLs, or booking links.</p>
        </div>

        <div class="business-header-actions">
          <span class="platform-pill">Premium</span>
        </div>
      </div>

      <div class="business-edit-grid">
        <div class="admin-field">
          <span>Widget Enabled</span>
          <select id="bookingWidgetEnabled">
            <option value="true" ${enabled ? "selected" : ""}>Enabled</option>
            <option value="false" ${!enabled ? "selected" : ""}>Disabled</option>
          </select>
        </div>

        <div class="admin-field">
          <span>Provider</span>
          <input
            id="bookingWidgetProvider"
            value="${escapeHtml(bookingIntegration.provider || "other")}"
            placeholder="mindbody, vagaro, zenoti, booker, other"
          />
        </div>

        <div class="admin-field">
          <span>Widget Type</span>
          <select id="bookingWidgetType">
            <option value="html" ${widgetType === "html" ? "selected" : ""}>HTML Embed Code</option>
            <option value="iframe" ${widgetType === "iframe" ? "selected" : ""}>Iframe URL</option>
            <option value="url" ${widgetType === "url" ? "selected" : ""}>Booking URL / Link</option>
          </select>
        </div>

        <div class="admin-field admin-field-full booking-widget-field booking-widget-html-field">
          <span>HTML Embed Code</span>
          <textarea
            id="bookingWidgetEmbedCode"
            rows="7"
            placeholder="Paste the full booking widget snippet here. Example: Mindbody div + script embed code."
          >${escapeHtml(bookingIntegration.embedCode || bookingIntegration.code || "")}</textarea>
        </div>

        <div class="admin-field admin-field-full booking-widget-field booking-widget-iframe-field">
          <span>Iframe URL</span>
          <input
            id="bookingWidgetIframeUrl"
            type="url"
            value="${escapeHtml(bookingIntegration.iframeUrl || bookingIntegration.widgetUrl || profile.bookingWidgetUrl || "")}"
            placeholder="https://..."
          />
        </div>

        <div class="admin-field admin-field-full booking-widget-field booking-widget-url-field">
          <span>Booking URL</span>
          <input
            id="bookingWidgetBookingUrl"
            type="url"
            value="${escapeHtml(bookingIntegration.bookingUrl || "")}"
            placeholder="https://..."
          />
        </div>
      </div>

      <p style="margin-top:10px;color:#64748b;font-size:13px;">
        Use HTML Embed Code for CRM snippets like Mindbody, iframe URL for iframe-based widgets, or Booking URL for simple booking links.
      </p>

      <div class="settings-actions">
        <button id="saveBookingWidgetBtn" class="primary-btn">
          Save Booking Widget
        </button>
      </div>

      <div id="bookingWidgetStatus" class="status-box"></div>
    </div>
  `;
}

function updateBookingWidgetFieldVisibility() {
  const widgetType = document.getElementById("bookingWidgetType")?.value || "url";

  document.querySelectorAll(".booking-widget-field").forEach((field) => {
    field.style.display = "none";
  });

  document.querySelectorAll(`.booking-widget-${widgetType}-field`).forEach((field) => {
    field.style.display = "";
  });
}

function attachBookingWidgetHandlers() {
  const saveBtn = document.getElementById("saveBookingWidgetBtn");
  const status = document.getElementById("bookingWidgetStatus");
  const typeSelect = document.getElementById("bookingWidgetType");

  updateBookingWidgetFieldVisibility();

  if (typeSelect) {
    typeSelect.addEventListener("change", updateBookingWidgetFieldVisibility);
  }

  if (!saveBtn) return;

  saveBtn.addEventListener("click", async () => {
    try {
      if (status) {
        status.textContent = "Saving booking widget...";
        status.className = "status-box info";
      }

      await fetchJson("/api/business-dashboard/booking-widget", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          enabled:
            document.getElementById("bookingWidgetEnabled")?.value === "true",
          provider:
            document.getElementById("bookingWidgetProvider")?.value.trim() || "other",
          widgetType:
            document.getElementById("bookingWidgetType")?.value || "url",
          embedCode:
            document.getElementById("bookingWidgetEmbedCode")?.value.trim() || "",
          iframeUrl:
            document.getElementById("bookingWidgetIframeUrl")?.value.trim() || "",
          bookingUrl:
            document.getElementById("bookingWidgetBookingUrl")?.value.trim() || ""
        })
      });

      if (status) {
        status.textContent = "Booking widget saved.";
        status.className = "status-box success";
      }

      setStatus("Booking widget saved.", "success");

      await loadDashboard();
    } catch (error) {
      if (status) {
        status.textContent = error.message;
        status.className = "status-box error";
      }

      setStatus(`Booking widget error: ${error.message}`, "error");
    }
  });
}

function renderDealPanel(dashboard) {
  const profile = dashboard.profile || {};
  const activeDeal = profile.activeDeal || {};
  const enabled = activeDeal.enabled === true;

  return `
    <div class="admin-business-card">
      <div class="business-card-header">
        <div>
          <h3>Search Card Deal</h3>
          <p>Post a small promotion on your verified business card in search results.</p>
        </div>

        <div class="business-header-actions">
          <span class="platform-pill">Premium</span>
        </div>
      </div>

      <div class="business-edit-grid">
        <div class="admin-field">
          <span>Deal Enabled</span>
          <select id="dealEnabled">
            <option value="true" ${enabled ? "selected" : ""}>Enabled</option>
            <option value="false" ${!enabled ? "selected" : ""}>Disabled</option>
          </select>
        </div>

        <div class="admin-field">
          <span>Deal Title</span>
          <input
            id="dealTitle"
            maxlength="80"
            value="${escapeHtml(activeDeal.title || "")}"
            placeholder="Example: Summer Massage Special"
          />
        </div>

        <div class="admin-field">
          <span>Promo Code</span>
          <input
            id="dealPromoCode"
            value="${escapeHtml(activeDeal.promoCode || "")}"
            placeholder="Optional code"
          />
        </div>

        <div class="admin-field">
          <span>Expiration</span>
          <input
            id="dealExpiresAt"
            type="date"
            value="${escapeHtml(activeDeal.expiresAt || "")}"
          />
        </div>

        <div class="admin-field admin-field-full">
          <span>Deal Text</span>
          <textarea
            id="dealBody"
            rows="3"
            maxlength="260"
            placeholder="Short promo text shown on search cards."
          >${escapeHtml(activeDeal.body || "")}</textarea>
        </div>
      </div>

      <div class="settings-actions">
        <button id="saveDealBtn" class="primary-btn">
          Save Deal
        </button>
      </div>

      <div id="dealStatus" class="status-box"></div>
    </div>
  `;
}

function attachDealHandlers() {
  const saveBtn = document.getElementById("saveDealBtn");
  const status = document.getElementById("dealStatus");

  if (!saveBtn) return;

  saveBtn.addEventListener("click", async () => {
    try {
      if (status) {
        status.textContent = "Saving deal...";
        status.className = "status-box info";
      }

      await fetchJson("/api/business-dashboard/deal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          enabled: document.getElementById("dealEnabled")?.value === "true",
          title: document.getElementById("dealTitle")?.value.trim() || "",
          body: document.getElementById("dealBody")?.value.trim() || "",
          promoCode: document.getElementById("dealPromoCode")?.value.trim() || "",
          expiresAt: document.getElementById("dealExpiresAt")?.value || ""
        })
      });

      if (status) {
        status.textContent = "Deal saved.";
        status.className = "status-box success";
      }

      setStatus("Deal saved.", "success");

      await loadDashboard();
    } catch (error) {
      if (status) {
        status.textContent = error.message;
        status.className = "status-box error";
      }

      setStatus(`Deal error: ${error.message}`, "error");
    }
  });
}

function renderDashboard(dashboard) {
  logoutBtn.style.display = "inline-flex";

  const entitlements = dashboard.entitlements || {};
  const businessName =
    dashboard.profile?.businessName || dashboard.businessName || "Your business";

  if (dashboardTitle) dashboardTitle.textContent = businessName;
  if (dashboardSubtitle) {
    dashboardSubtitle.textContent = "Manage your NextAppt listing and connections.";
  }

  setDashboardNav(
    [
      { id: "dashboard-overview", label: "Overview" },
      { id: "business-profile", label: "Business Profile" },
      { id: "business-connections", label: "Connections" },
      { id: "business-booking", label: "Booking" },
      { id: "business-deal", label: "Deals" },
      { id: "business-analytics", label: "Analytics" }
    ],
    dashboard.email || ""
  );

  content.innerHTML = `
    <div class="business-list business-dashboard-sections">
      <section id="dashboard-overview" class="dashboard-section">
        ${renderDashboardOverview(dashboard)}
      </section>

      <section id="business-profile" class="dashboard-section">
        ${renderBusinessProfilePanel(dashboard)}
      </section>

      <section id="business-connections" class="dashboard-section">
        ${
          entitlements.canUseApiIntegration
            ? renderCredentialConnectionPanel(dashboard)
            : renderLockedPremiumPanel(
                "Connect CRM/API",
                "Premium businesses can connect API credentials so NextAppt can display richer live availability."
              )
        }
      </section>

      <section id="business-booking" class="dashboard-section">
        ${
          entitlements.canUseBookingWidget
            ? renderBookingWidgetPanel(dashboard)
            : renderLockedPremiumPanel(
                "Booking Widget",
                "Premium businesses can add a booking widget or booking iframe directly to their public business page."
              )
        }
      </section>

      <section id="business-deal" class="dashboard-section">
        ${
          entitlements.canUseBookingWidget
            ? renderDealPanel(dashboard)
            : renderLockedPremiumPanel(
                "Search Card Deal",
                "Premium businesses can post a small deal or promotion on their verified search card."
              )
        }
      </section>

      <section id="business-analytics" class="dashboard-section">
        ${
          entitlements.canViewAnalytics
            ? renderAnalyticsPanel(dashboard)
            : renderLockedPremiumPanel(
                "Appointment Analytics",
                "Premium businesses can see appointment clicks, popular days, popular times, and customer demand signals."
              )
        }
      </section>
    </div>
  `;

  attachBusinessProfileHandlers();
  attachCredentialConnectionHandlers(dashboard);
  attachBookingWidgetHandlers();
  attachDealHandlers();
}

async function requestLoginCode() {
  const email = document.getElementById("loginEmail")?.value?.trim();

  if (!email) {
    return setStatus("Email required.", "error");
  }

  try {
    setStatus("Generating login code...", "info");

    const data = await fetchJson("/api/business-dashboard/auth/request-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email })
    });

    setStatus(
  "If this email belongs to a verified business account, a login code has been sent.",
  "success"
);

    renderCodeVerification(email);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function verifyLoginCode(email) {
  const code = document.getElementById("loginCode")?.value?.trim();

  if (!code) {
    return setStatus("Code required.", "error");
  }

  try {
    setStatus("Verifying code...", "info");

    const data = await fetchJson("/api/business-dashboard/auth/verify-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
      email,
      code,
      acceptance: window.NextApptLegal.businessPayload()
    })
    });

    const token = data?.session?.token;

    if (!token) {
      throw new Error("Login succeeded, but no session token was returned.");
    }

    setSessionToken(token);

    setStatus("Login successful.", "success");

    await loadDashboard();
  } catch (error) {
    console.error("BUSINESS LOGIN ERROR:", error);
    setStatus(error.message, "error");
  }
}

async function loadDashboard(options = {}) {
  const token = getSessionToken();

  if (!token) {
    renderLoginRequest();
    setStatus("Please log in.", "info");
    return;
  }

  try {
    const data = await fetchJson("/api/business-dashboard/dashboard", {
      cache: "no-store"
    });

    console.log("BUSINESS DASHBOARD DATA:", data);

    renderDashboard(data.dashboard);

    if (options.notice) {
      setStatus(options.notice, options.noticeType || "success");
    } else {
      hideStatus();
    }

    if (options.profileNotice) {
      const profileStatus = document.getElementById("businessProfileStatus");

      if (profileStatus) {
        profileStatus.textContent = options.profileNotice;
        profileStatus.className =
          `status-box profile-status ${options.profileNoticeType || "success"}`;
      }
    }
  } catch (error) {
    console.error("BUSINESS DASHBOARD LOAD ERROR:", error);

    clearSessionToken();
    renderLoginRequest();

    setStatus(`Dashboard error: ${error.message}`, "error");
  }
}

logoutBtn.addEventListener("click", async () => {
  try {
    await fetchJson("/api/business-dashboard/auth/logout", {
    method: "POST"
    });
  } catch {
    // ignore logout errors
  }

  clearSessionToken();

  renderLoginRequest();

  setStatus("Logged out.", "success");
});

window.addEventListener("DOMContentLoaded", () => {
  loadDashboard();
});