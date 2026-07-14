const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");
const content = document.getElementById("content");
const statusBox = document.getElementById("statusBox");
const refreshBtn = document.getElementById("refreshBtn");
let navButtons = document.querySelectorAll(".nav-btn");

let currentView = "businesses";
let businessesCache = [];
let settingsBusinessesCache = [];
let businessSearchState = {
  name: "",
  industry: "",
  metro: "",
  platform: "",
  enabled: "",
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 1
};
let businessSearchFacets = { industries: [], metros: [], platforms: [] };
let businessEditorMode = false;
let subscriptionSearchState = {
  name: "",
  industry: "",
  metro: "",
  plan: "",
  status: "",
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 1
};
let inventorySearchState = {
  business: "",
  service: "",
  serviceType: "",
  platform: "",
  date: "",
  sourceType: "",
  status: "",
  showPast: false,
  includeInactive: false,
  page: 1,
  limit: 25,
  total: 0,
  totalPages: 1
};
let claimSearchState = {
  business: "",
  owner: "",
  email: "",
  status: "",
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 1
};

const views = {
  businesses: {
    title: "Businesses",
    subtitle: "Search businesses and edit one business at a time."
  },

  claims: {
    title: "Business Claims",
    subtitle: "Review, approve, or reject business ownership claims."
  },

  results: {
    title: "Appointment Inventory",
    subtitle: "Search PostgreSQL appointment inventory without loading every record."
  },

  inventory: {
    title: "Appointment Inventory",
    subtitle: "Search PostgreSQL appointment inventory without loading every record."
  },

  errors: {
    title: "Error Logs",
    subtitle: "Review scraper/API errors and failed availability checks."
  },

  subscriptions: {
    title: "Business Subscriptions",
    subtitle: "Manually manage verified basic and premium business access."
  },

  settings: {
    title: "Admin Controls",
    subtitle: "Control scraping, cache rules, platforms, service rules, targeted testing, and scheduler behavior."
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message, type = "info") {
  statusBox.textContent = message;
  statusBox.className = `status-box ${type}`;
}

function setLoading(message = "Loading...") {
  content.innerHTML = `<p>${escapeHtml(message)}</p>`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;

    try {
      const data = await response.json();
      if (data.error) message = data.error;
    } catch {
      // ignore
    }

    throw new Error(message);
  }

  return response.json();
}

async function loadBusinessSubscriptions() {
  const response = await fetch("/api/admin/business-subscriptions");
  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Failed to load business subscriptions.");
  }

  return data.subscriptions || {};
}

async function saveBusinessSubscription(payload) {
  const response = await fetch("/api/admin/business-subscriptions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Failed to save subscription.");
  }

  return data;
}

function normalizeBusinessDefaults(business) {
  const normalized = {
    enabled: business.enabled !== false,
    adminNotes: business.adminNotes || "",
    ...business
  };

  if (!Array.isArray(normalized.services)) {
    normalized.services = [];
  }

  return normalized;
}

function createBlankService() {
  return {
    serviceType: "",
    durationMinutes: null,
    serviceName: "",
    platformServiceId: "",
    serviceButtonId: "",
    serviceId: "",
    enabled: true,
    priority: "normal",
    discoveryStatus: "manual",
    scrapeDirectly: true,
    inferenceEnabled: false,
    inferenceRole: "",
    anchorServiceId: "",
    inferShorterDurations: false,
    inferServiceTypes: [],
    inferStartIntervalMinutes: 15,
    inferenceConfidence: 0.85,
    bookingIntervalMinutes: 15
  };
}

function createBlankBusiness() {
  return normalizeBusinessDefaults({
    businessId: "",
    businessName: "",
    displayName: "",
    businessCategory: "wellness",
    platform: "",
    bookingUrl: "",
    website: "",
    phone: "",
    email: "",
    ownerEmail: "",
    address: "",
    city: "",
    state: "TX",
    postalCode: "",
    latitude: null,
    longitude: null,
    timezone: "America/Chicago",
    integrationType: "scraper",
    apiProvider: "",
    credentialId: "",
    integrationStatus: "active",
    enabled: true,
    priority: "normal",
    discoveryStatus: "manual",
    services: [createBlankService()],
    isNew: true
  });
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function getAllServicesForBusiness(business) {
  if (Array.isArray(business.services) && business.services.length) {
    return business.services;
  }

  if (business.serviceName) {
    return [
      {
        serviceName: business.serviceName,
        serviceType: business.serviceType || "",
        durationMinutes: business.durationMinutes || "",
        priority: business.priority || "",
        discoveryStatus: business.discoveryStatus || ""
      }
    ];
  }

  return [];
}

function getPlatformsFromBusinesses() {
  return uniqueSorted(settingsBusinessesCache.map((business) => business.platform));
}

function getBusinessesForPlatform(platform) {
  return settingsBusinessesCache.filter((business) => {
    if (!platform) return true;
    return business.platform === platform;
  });
}

function getServicesForBusinessName(businessName) {
  const business = settingsBusinessesCache.find((item) => item.businessName === businessName);
  if (!business) return [];
  return getAllServicesForBusiness(business);
}

function renderSelect(label, id, options = [], placeholder = "Any") {
  return `
    <label class="admin-field">
      <span>${escapeHtml(label)}</span>
      <select id="${escapeHtml(id)}">
        <option value="">${escapeHtml(placeholder)}</option>
        ${options.map((option) => `
          <option value="${escapeHtml(option)}">${escapeHtml(option)}</option>
        `).join("")}
      </select>
    </label>
  `;
}

function renderInput(label, field, value, index, type = "text") {
  return `
    <label class="admin-field">
      <span>${escapeHtml(label)}</span>
      <input type="${type}" data-index="${index}" data-field="${escapeHtml(field)}" value="${escapeHtml(value ?? "")}" />
    </label>
  `;
}

function renderTextarea(label, field, value, index) {
  return `
    <label class="admin-field admin-field-full">
      <span>${escapeHtml(label)}</span>
      <textarea data-index="${index}" data-field="${escapeHtml(field)}" rows="2">${escapeHtml(value ?? "")}</textarea>
    </label>
  `;
}

function renderCheckbox(label, field, checked, index) {
  return `
    <label class="admin-checkbox">
      <input type="checkbox" data-index="${index}" data-field="${escapeHtml(field)}" ${checked ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function renderServiceInput(label, field, value, businessIndex, serviceIndex, type = "text") {
  return `
    <label class="admin-field">
      <span>${escapeHtml(label)}</span>
      <input type="${type}" data-business-index="${businessIndex}" data-service-index="${serviceIndex}" data-service-field="${escapeHtml(field)}" value="${escapeHtml(value ?? "")}" />
    </label>
  `;
}

function renderServiceCheckbox(label, field, checked, businessIndex, serviceIndex) {
  return `
    <label class="admin-checkbox service-checkbox">
      <input type="checkbox" data-business-index="${businessIndex}" data-service-index="${serviceIndex}" data-service-field="${escapeHtml(field)}" ${checked ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function renderServiceSelect(label, field, value, businessIndex, serviceIndex, options = []) {
  return `
    <label class="admin-field">
      <span>${escapeHtml(label)}</span>
      <select data-business-index="${businessIndex}" data-service-index="${serviceIndex}" data-service-field="${escapeHtml(field)}">
        ${options.map((option) => {
          const optionValue = typeof option === "object" ? option.value : option;
          const optionLabel = typeof option === "object" ? option.label : option;
          return `<option value="${escapeHtml(optionValue ?? "")}" ${String(optionValue ?? "") === String(value ?? "") ? "selected" : ""}>${escapeHtml(optionLabel ?? "")}</option>`;
        }).join("")}
      </select>
    </label>
  `;
}

function getAdminServiceKey(service = {}) {
  return [
    String(service.serviceName || "").trim().toLowerCase(),
    String(service.serviceType || "").trim().toLowerCase().replace(/\s+/g, "_"),
    Number(service.durationMinutes || 0) || ""
  ].join("|");
}

function renderServiceCard(service, businessIndex, serviceIndex) {
  const businessServices = businessesCache[businessIndex]?.services || [];
  const anchorOptions = [
    { value: "", label: "No anchor selected" },
    ...businessServices
      .filter((candidate, candidateIndex) => candidateIndex !== serviceIndex)
      .filter((candidate) => candidate.inferenceRole === "anchor")
      .map((candidate) => ({
        value:
          candidate.id ||
          candidate.businessServiceId ||
          `key:${getAdminServiceKey(candidate)}`,
        label: `${candidate.serviceName || "Unnamed"} · ${candidate.durationMinutes || "?"} min`
      }))
  ];

  return `
    <div class="service-card">
      <div class="service-card-header">
        <div>
          <h4>${escapeHtml(service.serviceName || "Unnamed Service")}</h4>
          <p>${escapeHtml(service.serviceType || "unknown")} · ${escapeHtml(service.durationMinutes || "unknown")} min · ${escapeHtml(service.priority || "no priority")} · ${escapeHtml(service.discoveryStatus || "no status")}</p>
        </div>

        <div class="service-card-actions">
          <span class="enabled-pill ${service.enabled === false ? "disabled" : "enabled"}">
            ${service.enabled === false ? "Disabled" : "Enabled"}
          </span>
          <button class="danger-btn delete-service-btn" data-delete-business-index="${businessIndex}" data-delete-service-index="${serviceIndex}">
            Delete
          </button>
        </div>
      </div>

      <div class="service-edit-grid">
        ${renderServiceInput("Service Name", "serviceName", service.serviceName, businessIndex, serviceIndex)}
        ${renderServiceInput("Service Type", "serviceType", service.serviceType, businessIndex, serviceIndex)}
        ${renderServiceInput("Duration", "durationMinutes", service.durationMinutes, businessIndex, serviceIndex, "number")}
        ${renderServiceInput("Platform Service ID", "platformServiceId", service.platformServiceId, businessIndex, serviceIndex)}
        ${renderServiceInput("Service Button ID", "serviceButtonId", service.serviceButtonId, businessIndex, serviceIndex)}
        ${renderServiceInput("Service ID", "serviceId", service.serviceId, businessIndex, serviceIndex)}
        ${renderServiceInput("Priority", "priority", service.priority, businessIndex, serviceIndex)}
        ${renderServiceInput("Discovery Status", "discoveryStatus", service.discoveryStatus, businessIndex, serviceIndex)}
        ${renderServiceInput("Booking Interval Minutes", "bookingIntervalMinutes", service.bookingIntervalMinutes, businessIndex, serviceIndex, "number")}

        <div class="admin-field checkbox-wrap">
          <span>Service Status</span>
          ${renderServiceCheckbox("Enabled", "enabled", service.enabled !== false, businessIndex, serviceIndex)}
        </div>

        <div class="admin-field checkbox-wrap">
          <span>Scrape Behavior</span>
          ${renderServiceCheckbox("Scrape this service directly", "scrapeDirectly", service.scrapeDirectly !== false, businessIndex, serviceIndex)}
        </div>

        <div class="admin-field checkbox-wrap">
          <span>Inference</span>
          ${renderServiceCheckbox("Enable inference", "inferenceEnabled", service.inferenceEnabled === true, businessIndex, serviceIndex)}
        </div>

        ${renderServiceSelect(
          "Inference Role",
          "inferenceRole",
          service.inferenceRole || "",
          businessIndex,
          serviceIndex,
          [
            { value: "", label: "No inference role" },
            { value: "anchor", label: "Anchor — scrape confirmed availability" },
            { value: "inferred", label: "Inferred — generated from an anchor" }
          ]
        )}

        ${renderServiceSelect(
          "Anchor Service",
          "anchorServiceId",
          service.anchorServiceId || "",
          businessIndex,
          serviceIndex,
          anchorOptions
        )}

        <div class="admin-field checkbox-wrap">
          <span>Anchor Rules</span>
          ${renderServiceCheckbox("Infer shorter durations", "inferShorterDurations", service.inferShorterDurations === true, businessIndex, serviceIndex)}
        </div>

        ${renderServiceInput(
          "Infer Service Types",
          "inferServiceTypes",
          Array.isArray(service.inferServiceTypes) ? service.inferServiceTypes.join(", ") : service.inferServiceTypes || "",
          businessIndex,
          serviceIndex
        )}
        ${renderServiceInput("Inference Slot Interval", "inferStartIntervalMinutes", service.inferStartIntervalMinutes || 15, businessIndex, serviceIndex, "number")}
        ${renderServiceInput("Inference Confidence", "inferenceConfidence", service.inferenceConfidence ?? 0.85, businessIndex, serviceIndex, "number")}
      </div>
    </div>
  `;
}

function renderServicesSection(business, businessIndex) {
  const services = Array.isArray(business.services) ? business.services : [];

  return `
    <details class="services-section">
      <summary class="services-summary">
        <span>Services</span>
        <small>${services.length} configured</small>
      </summary>

      <div class="services-inner">
        <div class="services-actions">
          <button class="secondary-btn add-service-btn" data-add-service-index="${businessIndex}">
            + Add Service
          </button>
        </div>

        ${
          services.length
            ? services.map((service, serviceIndex) => renderServiceCard(service, businessIndex, serviceIndex)).join("")
            : `<p class="empty-note">No services configured yet.</p>`
        }
      </div>
    </details>
  `;
}

function renderBusinessCard(business, index) {
  return `
    <div class="admin-business-card ${business.enabled === false ? "business-disabled" : ""}">
      <div class="business-card-header">
        <div>
          <h3>${escapeHtml(business.businessName || business.name || "Unnamed Business")}</h3>
          <p>${escapeHtml(business.address || "No address saved")}</p>
        </div>

        <div class="business-header-actions">
          <span class="platform-pill">${escapeHtml(business.platform || "unknown")}</span>
          <span class="enabled-pill ${business.enabled === false ? "disabled" : "enabled"}">
            ${business.enabled === false ? "Disabled" : "Enabled"}
          </span>
          <button class="primary-btn save-one-business-btn" data-save-business-index="${index}">
            Save Business
          </button>
        </div>
      </div>

      <details class="business-details">
        <summary>Business Details</summary>

        <div class="business-edit-grid">
          ${renderInput("Business ID / Slug", "businessId", business.businessId, index)}
          ${renderInput("Business Name", "businessName", business.businessName, index)}
          ${renderInput("Display Name", "displayName", business.displayName, index)}
          ${renderInput("Platform", "platform", business.platform, index)}
          ${renderInput("Booking URL", "bookingUrl", business.bookingUrl, index)}
          ${renderInput("Website", "website", business.website, index)}
          ${renderInput("Address", "address", business.address, index)}
          ${renderInput("City", "city", business.city, index)}
          ${renderInput("State", "state", business.state, index)}
          ${renderInput("Postal Code", "postalCode", business.postalCode, index)}
          ${renderInput("Latitude", "latitude", business.latitude, index, "number")}
          ${renderInput("Longitude", "longitude", business.longitude, index, "number")}
          ${renderInput("Timezone", "timezone", business.timezone || "America/Chicago", index)}
          ${renderInput("Integration Type", "integrationType", business.integrationType || "scraper", index)}
          ${renderInput("API Provider", "apiProvider", business.apiProvider, index)}
          ${renderInput("Credential ID", "credentialId", business.credentialId, index)}
          <div class="admin-field checkbox-wrap">
            <span>Status</span>
            ${renderCheckbox("Business enabled", "enabled", business.enabled !== false, index)}
          </div>
          ${renderTextarea("Admin Notes", "adminNotes", business.adminNotes, index)}
        </div>
      </details>

      ${renderServicesSection(business, index)}

      <details class="raw-json-box">
        <summary>Raw JSON</summary>
        <pre>${escapeHtml(JSON.stringify(business, null, 2))}</pre>
      </details>
    </div>
  `;
}

function attachBusinessInputListeners() {
  content.querySelectorAll("input[data-index][data-field], textarea[data-index][data-field]").forEach((fieldElement) => {
    const update = () => {
      const index = Number(fieldElement.dataset.index);
      const field = fieldElement.dataset.field;

      if (!businessesCache[index]) return;

      let value = fieldElement.type === "checkbox" ? fieldElement.checked : fieldElement.value;

      if (field === "latitude" || field === "longitude") {
        value = value === "" ? null : Number(value);
      }

      businessesCache[index][field] = value;
      setStatus("Unsaved changes.", "info");
    };

    fieldElement.addEventListener("input", update);
    fieldElement.addEventListener("change", update);
  });
}

function attachServiceInputListeners() {
  content.querySelectorAll("[data-business-index][data-service-index][data-service-field]").forEach((fieldElement) => {
    const update = () => {
      const businessIndex = Number(fieldElement.dataset.businessIndex);
      const serviceIndex = Number(fieldElement.dataset.serviceIndex);
      const field = fieldElement.dataset.serviceField;
      const business = businessesCache[businessIndex];

      if (!business?.services?.[serviceIndex]) return;

      let value = fieldElement.type === "checkbox" ? fieldElement.checked : fieldElement.value;

      if (
        [
          "durationMinutes",
          "bookingIntervalMinutes",
          "inferStartIntervalMinutes",
          "inferenceConfidence"
        ].includes(field)
      ) {
        value = value === "" ? null : Number(value);
      }

      if (field === "inferServiceTypes") {
        value = String(value || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }

      business.services[serviceIndex][field] = value;

      if (field === "inferenceRole") {
        business.services[serviceIndex].inferenceEnabled = Boolean(value);
        if (value === "inferred") {
          business.services[serviceIndex].scrapeDirectly = false;
        }
        if (value === "anchor") {
          business.services[serviceIndex].scrapeDirectly = true;
          business.services[serviceIndex].anchorServiceId = "";
        }
      }
      setStatus("Unsaved service changes.", "info");
    };

    fieldElement.addEventListener("input", update);
    fieldElement.addEventListener("change", update);
  });
}

function attachAddServiceListeners() {
  content.querySelectorAll("[data-add-service-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const businessIndex = Number(button.dataset.addServiceIndex);

      if (!businessesCache[businessIndex]) return;

      if (!Array.isArray(businessesCache[businessIndex].services)) {
        businessesCache[businessIndex].services = [];
      }

      businessesCache[businessIndex].services.push(createBlankService());
      setStatus("New blank service added. Fill it in, then click Save Business.", "info");
      renderBusinessesFromCache();
    });
  });
}

function attachDeleteServiceListeners() {
  content.querySelectorAll("[data-delete-business-index][data-delete-service-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const businessIndex = Number(button.dataset.deleteBusinessIndex);
      const serviceIndex = Number(button.dataset.deleteServiceIndex);
      const business = businessesCache[businessIndex];

      if (!business?.services?.[serviceIndex]) return;

      const serviceName = business.services[serviceIndex].serviceName || "Unnamed Service";
      const businessName = business.businessName || business.name || "Unnamed Business";

      const confirmed = window.confirm(
        `Delete this service?\n\nBusiness: ${businessName}\nService: ${serviceName}\n\nThis will not be permanent until you click Save Businesses.`
      );

      if (!confirmed) return;

      business.services.splice(serviceIndex, 1);
      setStatus("Service deleted from screen. Click Save Business to make it permanent.", "info");
      renderBusinessesFromCache();
    });
  });
}

function renderBusinessSearchOption(value, selectedValue) {
  const selected = String(value) === String(selectedValue) ? "selected" : "";
  return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(value)}</option>`;
}

function renderBusinessSearchResults() {
  pageTitle.textContent = views.businesses.title;
  pageSubtitle.textContent = views.businesses.subtitle;

  const startNumber = businessSearchState.total
    ? (businessSearchState.page - 1) * businessSearchState.limit + 1
    : 0;
  const endNumber = Math.min(
    businessSearchState.page * businessSearchState.limit,
    businessSearchState.total
  );

  content.innerHTML = `
    <div class="business-search-toolbar">
      <div class="business-search-heading">
        <div>
          <h3>Business Manager</h3>
          <p>Search first, then open one business to edit its details and services.</p>
        </div>
        <button id="addBusinessBtn" class="primary-btn">+ Add New Business</button>
      </div>

      <form id="businessSearchForm" class="business-search-grid">
        <label class="admin-field business-name-search">
          <span>Business Name</span>
          <input id="businessSearchName" value="${escapeHtml(businessSearchState.name)}" placeholder="Search by name or slug" />
        </label>
        <label class="admin-field">
          <span>Industry</span>
          <select id="businessSearchIndustry">
            <option value="">All industries</option>
            ${businessSearchFacets.industries.map((value) => renderBusinessSearchOption(value, businessSearchState.industry)).join("")}
          </select>
        </label>
        <label class="admin-field">
          <span>Metro</span>
          <select id="businessSearchMetro">
            <option value="">All metros</option>
            ${businessSearchFacets.metros.map((value) => renderBusinessSearchOption(value, businessSearchState.metro)).join("")}
          </select>
        </label>
        <label class="admin-field">
          <span>Platform</span>
          <select id="businessSearchPlatform">
            <option value="">All platforms</option>
            ${businessSearchFacets.platforms.map((value) => renderBusinessSearchOption(value, businessSearchState.platform)).join("")}
          </select>
        </label>
        <label class="admin-field">
          <span>Status</span>
          <select id="businessSearchEnabled">
            <option value="" ${businessSearchState.enabled === "" ? "selected" : ""}>Enabled + disabled</option>
            <option value="true" ${businessSearchState.enabled === "true" ? "selected" : ""}>Enabled only</option>
            <option value="false" ${businessSearchState.enabled === "false" ? "selected" : ""}>Disabled only</option>
          </select>
        </label>
        <div class="business-search-actions">
          <button class="primary-btn" type="submit">Search</button>
          <button id="clearBusinessSearchBtn" class="secondary-btn" type="button">Clear</button>
        </div>
      </form>
    </div>

    <div class="business-search-summary">
      <strong>${businessSearchState.total} businesses</strong>
      <span>Showing ${startNumber}-${endNumber}</span>
    </div>

    <div class="business-summary-list">
      ${businessesCache.length ? businessesCache.map((business) => `
        <article class="business-summary-card">
          <div>
            <h3>${escapeHtml(business.businessName || business.name || "Unnamed Business")}</h3>
            <p>${escapeHtml(business.address || business.city || "No address saved")}</p>
            <div class="business-summary-meta">
              <span class="platform-pill">${escapeHtml(business.platform || "unknown")}</span>
              <span>${escapeHtml(business.businessCategory || "wellness")}</span>
              <span>${escapeHtml(business.metro || business.city || "No metro")}</span>
              <span>${Number(business.serviceCount || 0)} services</span>
              <span class="enabled-pill ${business.enabled === false ? "disabled" : "enabled"}">${business.enabled === false ? "Disabled" : "Enabled"}</span>
            </div>
          </div>
          <button class="primary-btn edit-business-btn" data-business-id="${escapeHtml(business.businessId || business.id || "")}">Edit Business</button>
        </article>
      `).join("") : `<div class="empty-note">No businesses matched these filters.</div>`}
    </div>

    <div class="business-pagination">
      <button id="previousBusinessPageBtn" class="secondary-btn" ${businessSearchState.page <= 1 ? "disabled" : ""}>Previous</button>
      <span>Page ${businessSearchState.page} of ${businessSearchState.totalPages}</span>
      <button id="nextBusinessPageBtn" class="secondary-btn" ${businessSearchState.page >= businessSearchState.totalPages ? "disabled" : ""}>Next</button>
    </div>
  `;

  document.getElementById("businessSearchForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    businessSearchState.name = document.getElementById("businessSearchName")?.value.trim() || "";
    businessSearchState.industry = document.getElementById("businessSearchIndustry")?.value || "";
    businessSearchState.metro = document.getElementById("businessSearchMetro")?.value || "";
    businessSearchState.platform = document.getElementById("businessSearchPlatform")?.value || "";
    businessSearchState.enabled = document.getElementById("businessSearchEnabled")?.value || "";
    businessSearchState.page = 1;
    await loadBusinesses();
  });

  document.getElementById("clearBusinessSearchBtn")?.addEventListener("click", async () => {
    businessSearchState = { ...businessSearchState, name: "", industry: "", metro: "", platform: "", enabled: "", page: 1 };
    await loadBusinesses();
  });

  document.getElementById("addBusinessBtn")?.addEventListener("click", () => {
    businessEditorMode = true;
    businessesCache = [createBlankBusiness()];
    renderBusinessesFromCache();
  });

  document.querySelectorAll(".edit-business-btn").forEach((button) => {
    button.addEventListener("click", () => loadBusinessEditor(button.dataset.businessId));
  });

  document.getElementById("previousBusinessPageBtn")?.addEventListener("click", async () => {
    if (businessSearchState.page > 1) {
      businessSearchState.page -= 1;
      await loadBusinesses();
    }
  });

  document.getElementById("nextBusinessPageBtn")?.addEventListener("click", async () => {
    if (businessSearchState.page < businessSearchState.totalPages) {
      businessSearchState.page += 1;
      await loadBusinesses();
    }
  });
}

function renderBusinessesFromCache() {
  businessEditorMode = true;
  pageTitle.textContent = businessesCache[0]?.isNew ? "Add Business" : "Edit Business";
  pageSubtitle.textContent = "Save only this business and its service configuration.";

  content.innerHTML = `
    <div class="section-heading compact-heading">
      <div>
        <button id="backToBusinessSearchBtn" class="secondary-btn">← Back to Business Search</button>
      </div>
    </div>
    <div class="business-list">
      ${businessesCache.map(renderBusinessCard).join("")}
    </div>
  `;

  document.getElementById("backToBusinessSearchBtn")?.addEventListener("click", () => {
    businessEditorMode = false;
    loadBusinesses();
  });

  attachBusinessInputListeners();
  attachServiceInputListeners();
  attachAddServiceListeners();
  attachDeleteServiceListeners();
  attachSingleBusinessSaveListeners();
}

function attachSingleBusinessSaveListeners() {
  content.querySelectorAll("[data-save-business-index]").forEach((button) => {
    button.addEventListener("click", async () => {
      const index = Number(button.dataset.saveBusinessIndex);
      await saveSingleBusiness(index, button);
    });
  });
}

async function saveSingleBusiness(index, button = null) {
  const business = businessesCache[index];

  if (!business || !String(business.businessName || "").trim()) {
    setStatus("Business name is required before saving.", "error");
    return;
  }

  const originalText = button?.textContent || "Save Business";

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Saving...";
    }

    setStatus(`Saving ${business.businessName}...`, "info");
    const identifier = business.businessId || business.id || "new";
    const data = await fetchJson(`/api/admin/businesses/${encodeURIComponent(identifier)}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business })
    });

    businessesCache[index] = normalizeBusinessDefaults(data.business || business);
    setStatus(`${business.businessName} saved to PostgreSQL.`, "success");
    renderBusinessesFromCache();
  } catch (error) {
    setStatus(`Save failed: ${error.message}`, "error");
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function loadBusinessEditor(businessId) {
  try {
    businessEditorMode = true;
    setLoading("Loading business details and services...");
    const data = await fetchJson(`/api/admin/businesses/${encodeURIComponent(businessId)}`);
    businessesCache = [normalizeBusinessDefaults(data.business || {})];
    renderBusinessesFromCache();
    setStatus(`Loaded ${businessesCache[0]?.businessName || "business"}.`, "success");
  } catch (error) {
    businessEditorMode = false;
    setStatus(`Could not load business: ${error.message}`, "error");
    await loadBusinesses();
  }
}

function getBusinessSubscriptionKey(businessName) {
  return String(businessName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getNestedValue(source, path, fallback = "") {
  const parts = String(path || "").split(".");
  let current = source;

  for (const part of parts) {
    if (!current || typeof current !== "object") return fallback;
    current = current[part];
  }

  return current ?? fallback;
}

function renderSubscriptionTextInput(label, id, value, placeholder = "") {
  return `
    <div class="admin-field">
      <span>${escapeHtml(label)}</span>
      <input id="${escapeHtml(id)}" value="${escapeHtml(value || "")}" placeholder="${escapeHtml(placeholder)}" />
    </div>
  `;
}

function renderSubscriptionUrlInput(label, id, value, placeholder = "https://...") {
  return `
    <div class="admin-field">
      <span>${escapeHtml(label)}</span>
      <input id="${escapeHtml(id)}" type="url" value="${escapeHtml(value || "")}" placeholder="${escapeHtml(placeholder)}" />
    </div>
  `;
}

function renderSubscriptionTextarea(label, id, value, placeholder = "", rows = 4) {
  return `
    <div class="admin-field admin-field-full">
      <span>${escapeHtml(label)}</span>
      <textarea id="${escapeHtml(id)}" rows="${rows}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value || "")}</textarea>
    </div>
  `;
}

async function loadBusinessSubscriptionsView() {
  currentView = "subscriptions";
  setLoading("Loading subscription search...");

  pageTitle.textContent = views.subscriptions.title;
  pageSubtitle.textContent = "Search businesses and manage one page of subscriptions at a time.";

  try {
    const params = new URLSearchParams({
      page: String(subscriptionSearchState.page),
      limit: String(subscriptionSearchState.limit)
    });

    if (subscriptionSearchState.name) params.set("name", subscriptionSearchState.name);
    if (subscriptionSearchState.industry) params.set("industry", subscriptionSearchState.industry);
    if (subscriptionSearchState.metro) params.set("metro", subscriptionSearchState.metro);
    if (subscriptionSearchState.plan) params.set("plan", subscriptionSearchState.plan);
    if (subscriptionSearchState.status) params.set("status", subscriptionSearchState.status);

    const searchData = await fetchJson(`/api/admin/business-subscriptions/search?${params.toString()}`);
    const subscriptionRows = Array.isArray(searchData.subscriptions)
      ? searchData.subscriptions
      : [];

    subscriptionSearchState.page = Number(searchData.page || 1);
    subscriptionSearchState.limit = Number(searchData.limit || 20);
    subscriptionSearchState.total = Number(searchData.total || 0);
    subscriptionSearchState.totalPages = Number(searchData.totalPages || 1);

    const businesses = subscriptionRows.map((row) => ({
      ...row,
      businessName: row.businessName || row.business_name || "",
      businessCategory: row.businessCategory || row.business_category || "",
      metro: row.metro || row.city || "",
      address: row.address || "",
      website: row.website || "",
      bookingUrl: row.bookingUrl || row.booking_url || "",
      platform: row.platform || ""
    }));

    const subscriptions = Object.fromEntries(
      subscriptionRows.map((row) => [
        getBusinessSubscriptionKey(row.businessName || row.business_name || ""),
        {
          ...row,
          subscriptionStatus: row.subscriptionStatus || row.subscription_status || row.status || "active",
          businessProfile: row.businessProfile || row.publicProfile || row.public_profile || {},
          bookingWidget: row.bookingWidget || row.bookingIntegration || row.booking_integration || {},
          cardPromotion: row.cardPromotion || row.activeDeal || row.active_deal || {}
        }
      ])
    );

    content.innerHTML = `
      <form id="subscriptionSearchForm" class="admin-search-grid">
        ${renderSubscriptionTextInput("Business Name", "subscriptionSearchName", subscriptionSearchState.name, "Search business")}
        ${renderSubscriptionTextInput("Industry", "subscriptionSearchIndustry", subscriptionSearchState.industry, "wellness")}
        ${renderSubscriptionTextInput("Metro", "subscriptionSearchMetro", subscriptionSearchState.metro, "Austin")}

        <label class="admin-field">
          <span>Plan</span>
          <select id="subscriptionSearchPlan">
            <option value="">All plans</option>
            <option value="verified_basic" ${subscriptionSearchState.plan === "verified_basic" ? "selected" : ""}>Verified Basic</option>
            <option value="premium" ${subscriptionSearchState.plan === "premium" ? "selected" : ""}>Premium</option>
          </select>
        </label>

        <label class="admin-field">
          <span>Status</span>
          <select id="subscriptionSearchStatus">
            <option value="">All statuses</option>
            <option value="active" ${subscriptionSearchState.status === "active" ? "selected" : ""}>Active</option>
            <option value="trialing" ${subscriptionSearchState.status === "trialing" ? "selected" : ""}>Trialing</option>
            <option value="inactive" ${subscriptionSearchState.status === "inactive" ? "selected" : ""}>Inactive</option>
            <option value="past_due" ${subscriptionSearchState.status === "past_due" ? "selected" : ""}>Past Due</option>
            <option value="canceled" ${subscriptionSearchState.status === "canceled" ? "selected" : ""}>Canceled</option>
          </select>
        </label>

        <div class="admin-search-actions">
          <button class="primary-btn" type="submit">Search</button>
          <button id="clearSubscriptionSearchBtn" class="secondary-btn" type="button">Clear</button>
        </div>
      </form>

      <div class="admin-search-summary">
        <strong>${subscriptionSearchState.total} matching businesses</strong>
        <span>Page ${subscriptionSearchState.page} of ${subscriptionSearchState.totalPages}</span>
      </div>

      <div class="section-heading compact-heading">
        <div>
          <h3>Business Subscriptions</h3>
          <p class="admin-muted">
            Universal premium controls for booking widgets, business bio text, and small search-card promotions.
          </p>
        </div>
      </div>

      <div class="business-list">
        ${businesses
          .map((business, index) => {
            const businessName = business.businessName || business.name || "";
            const key = getBusinessSubscriptionKey(businessName);
            const subscription = subscriptions[key] || {};
            const widget = subscription.bookingWidget || {};
            const profile = subscription.businessProfile || {};
            const promotion = subscription.cardPromotion || {};
            const plan = subscription.plan || "verified_basic";
            const status = subscription.subscriptionStatus || "active";
            const widgetType = widget.type || "url";

            return `
              <div class="admin-business-card">
                <div class="business-card-header">
                  <div>
                    <h3>${escapeHtml(businessName || "Unknown Business")}</h3>
                    <p>${escapeHtml(business.address || "No address listed")}</p>
                  </div>

                  <div class="business-header-actions">
                    <span class="platform-pill">${escapeHtml(plan)}</span>
                    ${widget.enabled ? `<span class="enabled-pill enabled">Widget Enabled</span>` : ""}
                  </div>
                </div>

                <details open>
                  <summary>Subscription</summary>
                  <div class="business-edit-grid">
                    <div class="admin-field">
                      <span>Plan</span>
                      <select id="subscriptionPlan-${index}">
                        <option value="verified_basic" ${plan === "verified_basic" ? "selected" : ""}>Verified Basic</option>
                        <option value="premium" ${plan === "premium" ? "selected" : ""}>Premium</option>
                      </select>
                    </div>

                    <div class="admin-field">
                      <span>Status</span>
                      <select id="subscriptionStatus-${index}">
                        <option value="active" ${status === "active" ? "selected" : ""}>Active</option>
                        <option value="trialing" ${status === "trialing" ? "selected" : ""}>Trialing</option>
                        <option value="inactive" ${status === "inactive" ? "selected" : ""}>Inactive</option>
                        <option value="past_due" ${status === "past_due" ? "selected" : ""}>Past Due</option>
                        <option value="canceled" ${status === "canceled" ? "selected" : ""}>Canceled</option>
                      </select>
                    </div>

                    ${renderSubscriptionTextInput("Admin Notes", `subscriptionNotes-${index}`, subscription.notes || "", "Internal admin note")}
                  </div>
                </details>

                <details>
                  <summary>Universal Booking Widget</summary>
                  <p class="admin-muted">
                    Supports URL buttons, iframe URLs, and full provider embed snippets. This is intentionally provider-neutral.
                  </p>

                  <div class="business-edit-grid">
                    <div class="admin-field checkbox-wrap">
                      <span>Widget Status</span>
                      <label class="admin-checkbox">
                        <input id="bookingWidgetEnabled-${index}" type="checkbox" ${widget.enabled ? "checked" : ""} />
                        <span>Enable booking widget</span>
                      </label>
                    </div>

                    <div class="admin-field">
                      <span>Widget Type</span>
                      <select id="bookingWidgetType-${index}">
                        <option value="url" ${widgetType === "url" ? "selected" : ""}>Booking URL Button</option>
                        <option value="iframe" ${widgetType === "iframe" ? "selected" : ""}>Iframe URL</option>
                        <option value="html" ${widgetType === "html" ? "selected" : ""}>HTML / JS Embed Snippet</option>
                        <option value="link" ${widgetType === "link" ? "selected" : ""}>External Link</option>
                      </select>
                    </div>

                    ${renderSubscriptionTextInput("Provider", `bookingWidgetProvider-${index}`, widget.provider || business.platform || "other", "mindbody, vagaro, schedulista, other")}
                    ${renderSubscriptionTextInput("Widget Title", `bookingWidgetTitle-${index}`, widget.title || "Book online", "Book online")}
                    ${renderSubscriptionUrlInput("Widget / Booking URL", `bookingWidgetUrl-${index}`, widget.url || "")}
                    ${renderSubscriptionTextarea(
                      "Embed Code / HTML Snippet",
                      `bookingWidgetHtml-${index}`,
                      widget.html || widget.code || "",
                      '<div class="provider-widget"></div><script async src="https://..."></script>',
                      7
                    )}
                  </div>
                </details>

                <details>
                  <summary>Business Profile Content</summary>
                  <div class="business-edit-grid">
                    ${renderSubscriptionTextInput("Short Description", `businessShortDescription-${index}`, profile.shortDescription || "", "Short public summary")}
                    ${renderSubscriptionUrlInput("Website URL", `businessWebsiteUrl-${index}`, profile.websiteUrl || business.website || business.bookingUrl || "")}
                    ${renderSubscriptionTextarea("Business Bio", `businessBio-${index}`, profile.bio || "", "Longer business description for premium pages", 6)}
                  </div>
                </details>

                <details>
                  <summary>Search Card Promo / Deal</summary>
                  <div class="business-edit-grid">
                    <div class="admin-field checkbox-wrap">
                      <span>Promo Status</span>
                      <label class="admin-checkbox">
                        <input id="cardPromotionEnabled-${index}" type="checkbox" ${promotion.enabled ? "checked" : ""} />
                        <span>Show promo on business cards</span>
                      </label>
                    </div>

                    ${renderSubscriptionTextInput("Promo Title", `cardPromotionTitle-${index}`, promotion.title || "", "Example: New client special")}
                    ${renderSubscriptionTextInput("CTA Text", `cardPromotionCtaText-${index}`, promotion.ctaText || "Learn More", "Book Deal")}
                    ${renderSubscriptionUrlInput("CTA URL", `cardPromotionCtaUrl-${index}`, promotion.ctaUrl || "")}
                    ${renderSubscriptionTextInput("Expires At", `cardPromotionExpiresAt-${index}`, promotion.expiresAt || "", "YYYY-MM-DD or leave blank")}
                    ${renderSubscriptionTextarea("Promo Body", `cardPromotionBody-${index}`, promotion.body || "", "Small deal text displayed on search cards", 3)}
                  </div>
                </details>

                <div class="settings-actions">
                  <button
                    class="primary-btn"
                    data-save-subscription="true"
                    data-business-name="${escapeHtml(businessName)}"
                    data-index="${index}"
                  >
                    Save Subscription + Premium Features
                  </button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>

      <div class="business-pagination">
        <button id="previousSubscriptionPageBtn" class="secondary-btn" ${subscriptionSearchState.page <= 1 ? "disabled" : ""}>Previous</button>
        <span>Page ${subscriptionSearchState.page} of ${subscriptionSearchState.totalPages}</span>
        <button id="nextSubscriptionPageBtn" class="secondary-btn" ${subscriptionSearchState.page >= subscriptionSearchState.totalPages ? "disabled" : ""}>Next</button>
      </div>
    `;

    document.getElementById("subscriptionSearchForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      subscriptionSearchState.name = getInputValue("subscriptionSearchName").trim();
      subscriptionSearchState.industry = getInputValue("subscriptionSearchIndustry").trim();
      subscriptionSearchState.metro = getInputValue("subscriptionSearchMetro").trim();
      subscriptionSearchState.plan = getInputValue("subscriptionSearchPlan");
      subscriptionSearchState.status = getInputValue("subscriptionSearchStatus");
      subscriptionSearchState.page = 1;
      await loadBusinessSubscriptionsView();
    });

    document.getElementById("clearSubscriptionSearchBtn")?.addEventListener("click", async () => {
      subscriptionSearchState = {
        ...subscriptionSearchState,
        name: "",
        industry: "",
        metro: "",
        plan: "",
        status: "",
        page: 1
      };
      await loadBusinessSubscriptionsView();
    });

    document.getElementById("previousSubscriptionPageBtn")?.addEventListener("click", async () => {
      if (subscriptionSearchState.page > 1) {
        subscriptionSearchState.page -= 1;
        await loadBusinessSubscriptionsView();
      }
    });

    document.getElementById("nextSubscriptionPageBtn")?.addEventListener("click", async () => {
      if (subscriptionSearchState.page < subscriptionSearchState.totalPages) {
        subscriptionSearchState.page += 1;
        await loadBusinessSubscriptionsView();
      }
    });

    attachSubscriptionSaveHandlers();
    setStatus(
      `Loaded ${businesses.length} of ${subscriptionSearchState.total} matching subscription records.`,
      "success"
    );
  } catch (error) {
    content.innerHTML = `
      <h3>Could Not Load Subscriptions</h3>
      <p>${escapeHtml(error.message)}</p>
    `;
    setStatus("Failed to load business subscriptions.", "error");
  }
}

function getInputValue(id) {
  return document.getElementById(id)?.value || "";
}

function getInputChecked(id) {
  return document.getElementById(id)?.checked === true;
}

function buildSubscriptionPayload(index, businessName) {
  return {
    businessName,
    plan: getInputValue(`subscriptionPlan-${index}`),
    subscriptionStatus: getInputValue(`subscriptionStatus-${index}`),
    notes: getInputValue(`subscriptionNotes-${index}`),
    bookingWidget: {
      enabled: getInputChecked(`bookingWidgetEnabled-${index}`),
      type: getInputValue(`bookingWidgetType-${index}`),
      provider: getInputValue(`bookingWidgetProvider-${index}`),
      title: getInputValue(`bookingWidgetTitle-${index}`),
      url: getInputValue(`bookingWidgetUrl-${index}`),
      html: getInputValue(`bookingWidgetHtml-${index}`)
    },
    businessProfile: {
      shortDescription: getInputValue(`businessShortDescription-${index}`),
      websiteUrl: getInputValue(`businessWebsiteUrl-${index}`),
      bio: getInputValue(`businessBio-${index}`)
    },
    cardPromotion: {
      enabled: getInputChecked(`cardPromotionEnabled-${index}`),
      title: getInputValue(`cardPromotionTitle-${index}`),
      body: getInputValue(`cardPromotionBody-${index}`),
      ctaText: getInputValue(`cardPromotionCtaText-${index}`),
      ctaUrl: getInputValue(`cardPromotionCtaUrl-${index}`),
      expiresAt: getInputValue(`cardPromotionExpiresAt-${index}`)
    }
  };
}

function attachSubscriptionSaveHandlers() {
  document
    .querySelectorAll("[data-save-subscription='true']")
    .forEach((button) => {
      button.addEventListener("click", async () => {
        const businessName = button.dataset.businessName || "";
        const index = button.dataset.index;

        try {
          button.disabled = true;
          button.textContent = "Saving...";

          await fetchJson("/api/admin/business-subscriptions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(buildSubscriptionPayload(index, businessName))
          });

          button.textContent = "Saved";
          setStatus("Business subscription and premium feature settings saved.", "success");
          setTimeout(() => loadBusinessSubscriptionsView(), 500);
        } catch (error) {
          button.disabled = false;
          button.textContent = "Save Subscription + Premium Features";
          setStatus(`Subscription save failed: ${error.message}`, "error");
          alert(error.message);
        }
      });
    });
}
async function loadBusinesses() {
  currentView = "businesses";
  businessEditorMode = false;
  setLoading("Loading business search...");

  try {
    if (!businessSearchFacets.industries.length && !businessSearchFacets.metros.length) {
      const facetsData = await fetchJson("/api/admin/businesses/facets");
      businessSearchFacets = facetsData.facets || businessSearchFacets;
    }

    const params = new URLSearchParams({
      page: String(businessSearchState.page),
      limit: String(businessSearchState.limit)
    });

    if (businessSearchState.name) params.set("name", businessSearchState.name);
    if (businessSearchState.industry) params.set("industry", businessSearchState.industry);
    if (businessSearchState.metro) params.set("metro", businessSearchState.metro);
    if (businessSearchState.platform) params.set("platform", businessSearchState.platform);
    if (businessSearchState.enabled) params.set("enabled", businessSearchState.enabled);

    const data = await fetchJson(`/api/admin/businesses/search?${params.toString()}`);
    businessesCache = Array.isArray(data.businesses)
      ? data.businesses.map(normalizeBusinessDefaults)
      : [];

    businessSearchState.page = Number(data.page || 1);
    businessSearchState.limit = Number(data.limit || 20);
    businessSearchState.total = Number(data.total || 0);
    businessSearchState.totalPages = Number(data.totalPages || 1);

    renderBusinessSearchResults();
    setStatus(`Loaded ${businessesCache.length} of ${businessSearchState.total} matching businesses.`, "success");
  } catch (error) {
    content.innerHTML = `<h3>Could Not Load Businesses</h3><p>${escapeHtml(error.message)}</p>`;
    setStatus("Failed to load businesses.", "error");
  }
}

async function loadResults() {
  currentView = "inventory";
  setLoading("Loading appointment inventory search...");

  pageTitle.textContent = views.inventory.title;
  pageSubtitle.textContent = views.inventory.subtitle;

  content.innerHTML = `
    <div class="settings-panel settings-panel-full">
      <h3>Appointment Inventory</h3>
      <p class="admin-muted">Search PostgreSQL inventory in small pages instead of loading every appointment.</p>

      <form id="inventorySearchForm" class="admin-search-grid">
        ${renderSubscriptionTextInput("Business", "inventoryBusiness", inventorySearchState.business, "Business name")}
        ${renderSubscriptionTextInput("Service", "inventoryService", inventorySearchState.service, "Service name")}
        ${renderSubscriptionTextInput("Service Type", "inventoryServiceType", inventorySearchState.serviceType, "massage")}
        ${renderSubscriptionTextInput("Platform", "inventoryPlatform", inventorySearchState.platform, "mindbody")}

        <label class="admin-field">
          <span>Date</span>
          <input id="inventoryDate" type="date" value="${escapeHtml(inventorySearchState.date)}" />
        </label>

        <label class="admin-field">
          <span>Source</span>
          <select id="inventorySourceType">
            <option value="">Confirmed + Inferred</option>
            <option value="confirmed" ${inventorySearchState.sourceType === "confirmed" ? "selected" : ""}>Confirmed only</option>
            <option value="inferred" ${inventorySearchState.sourceType === "inferred" ? "selected" : ""}>Inferred only</option>
          </select>
        </label>

        ${renderSubscriptionTextInput("Status", "inventoryStatus", inventorySearchState.status, "active")}

        <label class="admin-checkbox">
          <input id="inventoryShowPast" type="checkbox" ${inventorySearchState.showPast ? "checked" : ""} />
          <span>Include past appointments</span>
        </label>

        <label class="admin-checkbox">
          <input id="inventoryIncludeInactive" type="checkbox" ${inventorySearchState.includeInactive ? "checked" : ""} />
          <span>Include inactive appointments</span>
        </label>

        <div class="admin-search-actions">
          <button class="primary-btn" type="submit">Search Inventory</button>
          <button id="clearInventorySearchBtn" class="secondary-btn" type="button">Clear</button>
        </div>
      </form>

      <div id="inventoryResults"><p>Loading...</p></div>
    </div>
  `;

  const runInventorySearch = async () => {
    try {
      const params = new URLSearchParams({
        page: String(inventorySearchState.page),
        limit: String(inventorySearchState.limit),
        showPast: String(inventorySearchState.showPast),
        includeInactive: String(inventorySearchState.includeInactive)
      });

      if (inventorySearchState.business) params.set("business", inventorySearchState.business);
      if (inventorySearchState.service) params.set("service", inventorySearchState.service);
      if (inventorySearchState.serviceType) params.set("serviceType", inventorySearchState.serviceType);
      if (inventorySearchState.platform) params.set("platform", inventorySearchState.platform);
      if (inventorySearchState.date) params.set("date", inventorySearchState.date);
      if (inventorySearchState.sourceType) params.set("sourceType", inventorySearchState.sourceType);
      if (inventorySearchState.status) params.set("status", inventorySearchState.status);

      const data = await fetchJson(`/api/admin/results?${params.toString()}`);
      const results = Array.isArray(data.results) ? data.results : [];

      inventorySearchState.page = Number(data.page || 1);
      inventorySearchState.limit = Number(data.limit || 25);
      inventorySearchState.total = Number(data.total || 0);
      inventorySearchState.totalPages = Number(data.totalPages || 1);

      const target = document.getElementById("inventoryResults");
      if (!target) return;

      target.innerHTML = `
        <div class="admin-search-summary">
          <strong>${inventorySearchState.total} matching appointments</strong>
          <span>Page ${inventorySearchState.page} of ${inventorySearchState.totalPages}</span>
        </div>

        <div class="inventory-list">
          ${results.length
            ? results.map((row) => `
                <article class="inventory-card">
                  <div>
                    <strong>${escapeHtml(row.business_name || row.businessName || "Unknown business")}</strong>
                    <p>${escapeHtml(row.service_name || row.serviceName || row.service_category || "Service")} · ${escapeHtml(row.duration_minutes || row.durationMinutes || "?")} min</p>
                  </div>
                  <div>
                    <strong>${escapeHtml(row.local_date || row.localDate || row.target_local_date_key || "")}</strong>
                    <p>${escapeHtml(row.local_time || row.localTime || "")} · ${escapeHtml(row.platform || "")}</p>
                  </div>
                  <span class="platform-pill">${escapeHtml(row.appointment_source || row.source_type || row.sourceType || "confirmed")}</span>
                </article>
              `).join("")
            : `<p class="empty-note">No inventory records matched these filters.</p>`}
        </div>

        <div class="business-pagination">
          <button id="previousInventoryPageBtn" class="secondary-btn" ${inventorySearchState.page <= 1 ? "disabled" : ""}>Previous</button>
          <span>Page ${inventorySearchState.page} of ${inventorySearchState.totalPages}</span>
          <button id="nextInventoryPageBtn" class="secondary-btn" ${inventorySearchState.page >= inventorySearchState.totalPages ? "disabled" : ""}>Next</button>
        </div>

        <details class="raw-json-box">
          <summary>View current page as raw PostgreSQL inventory</summary>
          <pre>${escapeHtml(JSON.stringify(results, null, 2))}</pre>
        </details>
      `;

      document.getElementById("previousInventoryPageBtn")?.addEventListener("click", async () => {
        if (inventorySearchState.page > 1) {
          inventorySearchState.page -= 1;
          await runInventorySearch();
        }
      });

      document.getElementById("nextInventoryPageBtn")?.addEventListener("click", async () => {
        if (inventorySearchState.page < inventorySearchState.totalPages) {
          inventorySearchState.page += 1;
          await runInventorySearch();
        }
      });

      setStatus(
        `Loaded ${results.length} of ${inventorySearchState.total} matching inventory records.`,
        "success"
      );
    } catch (error) {
      const target = document.getElementById("inventoryResults");
      if (target) target.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
      setStatus("Failed to load appointment inventory.", "error");
    }
  };

  document.getElementById("inventorySearchForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    inventorySearchState.business = getInputValue("inventoryBusiness").trim();
    inventorySearchState.service = getInputValue("inventoryService").trim();
    inventorySearchState.serviceType = getInputValue("inventoryServiceType").trim();
    inventorySearchState.platform = getInputValue("inventoryPlatform").trim();
    inventorySearchState.date = getInputValue("inventoryDate");
    inventorySearchState.sourceType = getInputValue("inventorySourceType");
    inventorySearchState.status = getInputValue("inventoryStatus").trim();
    inventorySearchState.showPast = getInputChecked("inventoryShowPast");
    inventorySearchState.includeInactive = getInputChecked("inventoryIncludeInactive");
    inventorySearchState.page = 1;
    await runInventorySearch();
  });

  document.getElementById("clearInventorySearchBtn")?.addEventListener("click", async () => {
    inventorySearchState = {
      business: "",
      service: "",
      serviceType: "",
      platform: "",
      date: "",
      sourceType: "",
      status: "",
      showPast: false,
      includeInactive: false,
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 1
    };
    await loadResults();
  });

  await runInventorySearch();
}

async function loadErrors() {
  currentView = "errors";
  setLoading("Loading error logs...");

  try {
    const data = await fetchJson("/api/admin/errors");
    const errors = Array.isArray(data.errors) ? data.errors : [];

    pageTitle.textContent = views.errors.title;
    pageSubtitle.textContent = views.errors.subtitle;

    content.innerHTML = `
      <h3>Error Logs</h3>
      <p>${errors.length} error log entries found.</p>
      <details class="raw-json-box" open>
        <summary>View PostgreSQL scrape errors</summary>
        <pre>${escapeHtml(JSON.stringify(errors, null, 2))}</pre>
      </details>
    `;

    setStatus(`Loaded ${errors.length} error log entries.`, "success");
  } catch (error) {
    content.innerHTML = `<h3>Could Not Load Error Logs</h3><p>${escapeHtml(error.message)}</p>`;
    setStatus("Failed to load error logs.", "error");
  }
}

function renderSettingsCheckbox(label, path, checked) {
  return `
    <label class="settings-row">
      <span>${escapeHtml(label)}</span>
      <input type="checkbox" data-settings-path="${escapeHtml(path)}" ${checked ? "checked" : ""} />
    </label>
  `;
}

function renderSettingsInput(label, path, value, type = "text") {
  return `
    <label class="settings-row">
      <span>${escapeHtml(label)}</span>
      <input type="${type}" data-settings-path="${escapeHtml(path)}" value="${escapeHtml(value ?? "")}" />
    </label>
  `;
}

function renderSettingsArrayInput(label, path, value) {
  const textValue = Array.isArray(value) ? value.join(", ") : "";

  return `
    <label class="settings-row settings-row-wide">
      <span>${escapeHtml(label)}</span>
      <input type="text" data-settings-path="${escapeHtml(path)}" data-settings-array="true" value="${escapeHtml(textValue)}" placeholder="high, medium, normal" />
    </label>
  `;
}

function renderTargetedCheckbox(label, id, checked = false) {
  return `
    <label class="admin-checkbox targeted-checkbox">
      <input id="${escapeHtml(id)}" type="checkbox" ${checked ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function setNestedSetting(target, path, value) {
  const parts = String(path).split(".");
  let current = target;

  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }

    current = current[parts[i]];
  }

  current[parts[parts.length - 1]] = value;
}

async function getBusinessesForSettings() {
  const data = await fetchJson("/api/admin/businesses");
  return Array.isArray(data.businesses)
    ? data.businesses.map(normalizeBusinessDefaults)
    : [];
}

function renderTargetedScrapePanel() {
  const platforms = getPlatformsFromBusinesses();

  return `
    <div class="settings-panel settings-panel-full">
      <h3>Run Targeted Scrape</h3>
      <p class="settings-help">
        Choose from businesses and services stored in PostgreSQL. This avoids typos and bad commands.
      </p>

      <div class="targeted-scrape-grid">
        ${renderSelect("1. Platform", "targetPlatform", platforms, "Choose platform")}
        ${renderSelect("2. Business", "targetBusiness", [], "Choose business")}
        ${renderSelect("3. Service", "targetService", [], "Choose service")}
        ${renderSelect("4. Duration", "targetDuration", [], "Any duration")}
        ${renderSelect("5. Service Type", "targetServiceType", [], "Any service type")}
        ${renderSelect("6. Priority", "targetPriority", ["high", "medium", "normal", "low"], "Any priority")}
        ${renderSelect("7. Discovery Status", "targetDiscoveryStatus", ["approved", "manual", "test", "pending"], "Any status")}
      </div>

      <div class="targeted-options">
        ${renderTargetedCheckbox("Force refresh", "targetForceRefresh", true)}
        ${renderTargetedCheckbox("Manual mode", "targetManual", true)}
        
        ${renderTargetedCheckbox("Ignore service rules", "targetIgnoreServiceRules", false)}
        ${renderTargetedCheckbox("Skip Vagaro discovery", "targetSkipVagaroDiscovery", true)}
      </div>

      <div id="targetedPreview" class="targeted-preview">
        Select a platform to begin.
      </div>

      <div class="targeted-actions">
        <button id="runTargetedScrapeBtn" class="primary-btn">Run Targeted Scrape</button>
        <button id="clearTargetedScrapeBtn" class="secondary-btn">Reset Choices</button>
      </div>
    </div>
  `;
}

async function loadSettings() {
  currentView = "settings";
  setLoading("Loading admin controls...");

  pageTitle.textContent = views.settings.title;
  pageSubtitle.textContent = views.settings.subtitle;

  try {
    const [settingsData, businesses] = await Promise.all([
      fetchJson("/api/admin/settings"),
      getBusinessesForSettings()
    ]);

    settingsBusinessesCache = businesses;

    const settings = settingsData.settings || {};
    const scraping = settings.scraping || {};
    const cache = settings.cache || {};
    const serviceRules = settings.serviceRules || {};
    const platforms = settings.platforms || {};
    const clusters = settings.clusters || {};

    content.innerHTML = `
      <div class="settings-grid">
        ${renderTargetedScrapePanel()}

        <div class="settings-panel">
          <h3>Scraping Controls</h3>
          ${renderSettingsCheckbox("Scraping Enabled", "scraping.enabled", scraping.enabled !== false)}
          ${renderSettingsCheckbox("Search Enabled", "searchEnabled", settings.searchEnabled !== false)}
          ${renderSettingsCheckbox("Scheduled Scraping Enabled", "scraping.scheduledScrapingEnabled", scraping.scheduledScrapingEnabled !== false)}
          ${renderSettingsCheckbox("Skip Fresh Cache", "scraping.skipFreshCache", scraping.skipFreshCache !== false)}
          ${renderSettingsCheckbox("Skip Vagaro Discovery By Default", "scraping.skipVagaroDiscoveryByDefault", scraping.skipVagaroDiscoveryByDefault !== false)}
          ${renderSettingsInput("Default Lookahead Hours", "scraping.defaultLookaheadHours", scraping.defaultLookaheadHours || 48, "number")}
          ${renderSettingsInput("Default Interval Minutes", "scraping.defaultIntervalMinutes", scraping.defaultIntervalMinutes || 15, "number")}
          ${renderSettingsInput("Max Concurrent Scrapes", "scraping.maxConcurrentScrapes", scraping.maxConcurrentScrapes || 1, "number")}
        </div>

        <div class="settings-panel">
          <h3>Cache TTL Rules</h3>
          ${renderSettingsCheckbox("Cache Enabled", "cache.enabled", cache.enabled !== false)}
          ${renderSettingsInput("Default TTL Minutes", "cache.defaultTtlMinutes", cache.defaultTtlMinutes || 15, "number")}
          ${renderSettingsInput("Success TTL Minutes", "cache.successTtlMinutes", cache.successTtlMinutes || 15, "number")}
          ${renderSettingsInput("No Times Found TTL Minutes", "cache.noTimesFoundTtlMinutes", cache.noTimesFoundTtlMinutes || 8, "number")}
          ${renderSettingsInput("Fully Booked TTL Minutes", "cache.fullyBookedTtlMinutes", cache.fullyBookedTtlMinutes || 8, "number")}
          ${renderSettingsInput("Error TTL Minutes", "cache.errorTtlMinutes", cache.errorTtlMinutes || 3, "number")}
          ${renderSettingsInput("Unknown TTL Minutes", "cache.unknownTtlMinutes", cache.unknownTtlMinutes || 5, "number")}
        </div>

        <div class="settings-panel settings-panel-full">
          <h3>Service Scrape Rules</h3>
          <p class="settings-help">Scheduled scraping should stay strict. Manual testing can be broad.</p>

          <div class="service-rules-grid">
            ${renderSettingsArrayInput("Scheduled Priorities", "serviceRules.scheduledPriorities", serviceRules.scheduledPriorities || ["high"])}
            ${renderSettingsArrayInput("Scheduled Discovery Statuses", "serviceRules.scheduledDiscoveryStatuses", serviceRules.scheduledDiscoveryStatuses || ["approved"])}
            ${renderSettingsArrayInput("Manual Priorities", "serviceRules.manualPriorities", serviceRules.manualPriorities || ["high", "medium", "normal", "low"])}
            ${renderSettingsArrayInput("Manual Discovery Statuses", "serviceRules.manualDiscoveryStatuses", serviceRules.manualDiscoveryStatuses || ["approved", "manual", "test", "pending"])}
            ${renderSettingsInput("Max Services Per Business / Scheduled Run", "serviceRules.maxServicesPerBusinessPerScheduledRun", serviceRules.maxServicesPerBusinessPerScheduledRun || 2, "number")}
            ${renderSettingsCheckbox("Allow Services Without Priority", "serviceRules.allowServicesWithoutPriority", serviceRules.allowServicesWithoutPriority === true)}
            ${renderSettingsCheckbox("Allow Services Without Discovery Status", "serviceRules.allowServicesWithoutDiscoveryStatus", serviceRules.allowServicesWithoutDiscoveryStatus === true)}
          </div>
        </div>

        <div class="settings-panel">
          <h3>Platform Toggles</h3>
          ${Object.keys(platforms).map((platform) =>
            renderSettingsCheckbox(platform, `platforms.${platform}`, platforms[platform] !== false)
          ).join("")}
        </div>

        <div class="settings-panel settings-panel-full">
          <h3>Clusters</h3>
          ${
            Object.keys(clusters).length
              ? Object.keys(clusters).map((clusterId) => {
                  const cluster = clusters[clusterId] || {};
                  return `
                    <div class="cluster-settings-card">
                      <h4>${escapeHtml(clusterId)}</h4>
                      ${renderSettingsCheckbox("Cluster Enabled", `clusters.${clusterId}.enabled`, cluster.enabled !== false)}
                      ${renderSettingsInput("Interval Minutes", `clusters.${clusterId}.intervalMinutes`, cluster.intervalMinutes || 15, "number")}
                    </div>
                  `;
                }).join("")
              : `<p class="empty-note">No cluster settings found.</p>`
          }
        </div>

        <div class="settings-panel settings-panel-full">
          <h3>Actions</h3>
          <div class="settings-actions">
            <button id="saveSettingsBtn" class="primary-btn">Save Settings</button>
            <button id="reloadSettingsBtn" class="secondary-btn">Reload Settings</button>
            <button id="clearCacheBtn" class="danger-btn large-danger-btn">Clear Cache</button>
            <button id="runSchedulerOnceBtn" class="secondary-btn">Run Scheduler Once</button>
            <button id="runScrapeOnceBtn" class="secondary-btn">Run Scrape Once</button>
            <button id="viewCacheStatsBtn" class="secondary-btn">View Cache Stats</button>
          </div>

          <details class="raw-json-box">
            <summary>Raw PostgreSQL admin settings</summary>
            <pre>${escapeHtml(JSON.stringify(settings, null, 2))}</pre>
          </details>
        </div>
      </div>
    `;

    attachSettingsListeners(settings);
    attachTargetedScrapeListeners();
    hydrateTargetedDropdowns();
    setStatus("Loaded admin controls.", "success");
  } catch (error) {
    content.innerHTML = `<h3>Could Not Load Admin Settings</h3><p>${escapeHtml(error.message)}</p>`;
    setStatus("Failed to load admin settings.", "error");
  }
}

function attachSettingsListeners(settings) {
  const draftSettings = JSON.parse(JSON.stringify(settings));

  content.querySelectorAll("[data-settings-path]").forEach((input) => {
    const update = () => {
      const path = input.dataset.settingsPath;

      let value = input.type === "checkbox" ? input.checked : input.value;

      if (input.dataset.settingsArray === "true") {
        value = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
      }

      if (input.type === "number") {
        value = value === "" ? null : Number(value);
      }

      setNestedSetting(draftSettings, path, value);
      setStatus("Unsaved admin setting changes.", "info");
    };

    input.addEventListener("input", update);
    input.addEventListener("change", update);
  });

  document.getElementById("saveSettingsBtn")?.addEventListener("click", async () => {
    try {
      setStatus("Saving admin settings...", "info");

      await fetchJson("/api/admin/settings/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: draftSettings })
      });

      setStatus("Admin settings saved.", "success");
      await loadSettings();
    } catch (error) {
      setStatus(`Save failed: ${error.message}`, "error");
    }
  });

  document.getElementById("reloadSettingsBtn")?.addEventListener("click", loadSettings);

  document.getElementById("clearCacheBtn")?.addEventListener("click", async () => {
    if (!window.confirm("Clear appointment cache? This cannot be undone.")) return;

    try {
      await fetchJson("/api/admin/cache/clear", { method: "POST" });
      setStatus("Appointment cache cleared.", "success");
    } catch (error) {
      setStatus(`Cache clear failed: ${error.message}`, "error");
    }
  });

  document.getElementById("runSchedulerOnceBtn")?.addEventListener("click", async () => {
    try {
      await fetchJson("/api/admin/scheduler/run-once", { method: "POST" });
      setStatus("Scheduler run started.", "success");
    } catch (error) {
      setStatus(`Scheduler run failed: ${error.message}`, "error");
    }
  });

  document.getElementById("runScrapeOnceBtn")?.addEventListener("click", async () => {
    try {
      await fetchJson("/api/admin/scrape/run-once", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceRefresh: false })
      });

      setStatus("Scrape run started.", "success");
    } catch (error) {
      setStatus(`Scrape run failed: ${error.message}`, "error");
    }
  });

  document.getElementById("viewCacheStatsBtn")?.addEventListener("click", async () => {
    try {
      const data = await fetchJson("/api/admin/cache/stats");
      window.alert(JSON.stringify(data.stats, null, 2));
    } catch (error) {
      setStatus(`Cache stats failed: ${error.message}`, "error");
    }
  });
}

function fillSelect(id, values, placeholder) {
  const select = document.getElementById(id);
  if (!select) return;

  const currentValue = select.value;

  select.innerHTML = `
    <option value="">${escapeHtml(placeholder)}</option>
    ${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}
  `;

  if (values.includes(currentValue)) {
    select.value = currentValue;
  }
}

function updateTargetedPreview() {
  const payload = buildTargetedPayload();
  const preview = document.getElementById("targetedPreview");

  if (!preview) return;

  if (!Object.keys(payload).length) {
    preview.textContent = "Select a platform to begin.";
    return;
  }

  preview.innerHTML = `
    <strong>Target:</strong>
    <code>${escapeHtml(JSON.stringify(payload, null, 2))}</code>
  `;
}

function hydrateTargetedDropdowns() {
  const platformSelect = document.getElementById("targetPlatform");
  const businessSelect = document.getElementById("targetBusiness");
  const serviceSelect = document.getElementById("targetService");

  if (!platformSelect || !businessSelect || !serviceSelect) return;

  const refreshBusinesses = () => {
    const platform = platformSelect.value;
    const businesses = getBusinessesForPlatform(platform).map((business) => business.businessName);
    fillSelect("targetBusiness", uniqueSorted(businesses), "Choose business");
    fillSelect("targetService", [], "Choose service");
    fillSelect("targetDuration", [], "Any duration");
    fillSelect("targetServiceType", [], "Any service type");
    updateTargetedPreview();
  };

  const refreshServices = () => {
    const businessName = businessSelect.value;
    const services = getServicesForBusinessName(businessName);

    fillSelect("targetService", uniqueSorted(services.map((service) => service.serviceName)), "Choose service");
    fillSelect("targetDuration", uniqueSorted(services.map((service) => service.durationMinutes).filter(Boolean)), "Any duration");
    fillSelect("targetServiceType", uniqueSorted(services.map((service) => service.serviceType).filter(Boolean)), "Any service type");

    updateTargetedPreview();
  };

  const refreshFromService = () => {
    const businessName = businessSelect.value;
    const serviceName = serviceSelect.value;
    const services = getServicesForBusinessName(businessName);
    const selectedService = services.find((service) => service.serviceName === serviceName);

    if (selectedService) {
      const durationSelect = document.getElementById("targetDuration");
      const serviceTypeSelect = document.getElementById("targetServiceType");
      const prioritySelect = document.getElementById("targetPriority");
      const discoverySelect = document.getElementById("targetDiscoveryStatus");

      if (durationSelect && selectedService.durationMinutes) {
        durationSelect.value = String(selectedService.durationMinutes);
      }

      if (serviceTypeSelect && selectedService.serviceType) {
        serviceTypeSelect.value = selectedService.serviceType;
      }

      if (prioritySelect && selectedService.priority) {
        prioritySelect.value = selectedService.priority;
      }

      if (discoverySelect && selectedService.discoveryStatus) {
        discoverySelect.value = selectedService.discoveryStatus;
      }
    }

    updateTargetedPreview();
  };

  platformSelect.addEventListener("change", refreshBusinesses);
  businessSelect.addEventListener("change", refreshServices);
  serviceSelect.addEventListener("change", refreshFromService);

  [
    "targetDuration",
    "targetServiceType",
    "targetPriority",
    "targetDiscoveryStatus",
    "targetForceRefresh",
    "targetManual",
    "targetOnDemand",
    "targetIgnoreServiceRules",
    "targetSkipVagaroDiscovery"
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", updateTargetedPreview);
  });

  refreshBusinesses();
}

function getSelectValue(id) {
  return document.getElementById(id)?.value || "";
}

function getCheckboxValue(id) {
  return document.getElementById(id)?.checked === true;
}

function buildTargetedPayload() {
  const payload = {
    platform: getSelectValue("targetPlatform"),
    business: getSelectValue("targetBusiness"),
    service: getSelectValue("targetService"),
    serviceType: getSelectValue("targetServiceType"),
    durationMinutes: getSelectValue("targetDuration"),
    priority: getSelectValue("targetPriority"),
    discoveryStatus: getSelectValue("targetDiscoveryStatus"),
    forceRefresh: getCheckboxValue("targetForceRefresh"),
    manual: getCheckboxValue("targetManual"),
    ignoreServiceRules: getCheckboxValue("targetIgnoreServiceRules"),
    skipVagaroDiscovery: getCheckboxValue("targetSkipVagaroDiscovery")
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === "" || payload[key] === null || payload[key] === undefined) {
      delete payload[key];
    }
  });

  if (payload.durationMinutes) {
    payload.durationMinutes = Number(payload.durationMinutes);
  }

  return payload;
}

function attachTargetedScrapeListeners() {
  document.getElementById("runTargetedScrapeBtn")?.addEventListener("click", async () => {
    const payload = buildTargetedPayload();

    try {
      setStatus("Starting targeted scrape...", "info");

      const data = await fetchJson("/api/admin/scrape/targeted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      setStatus(`Targeted scrape started. Args: ${data.args.join(" ")}`, "success");
    } catch (error) {
      setStatus(`Targeted scrape failed: ${error.message}`, "error");
    }
  });

  document.getElementById("clearTargetedScrapeBtn")?.addEventListener("click", () => {
    ["targetPlatform", "targetBusiness", "targetService", "targetDuration", "targetServiceType", "targetPriority", "targetDiscoveryStatus"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.value = "";
    });

    document.getElementById("targetForceRefresh").checked = true;
    document.getElementById("targetManual").checked = true;
    document.getElementById("targetOnDemand").checked = false;
    document.getElementById("targetIgnoreServiceRules").checked = false;
    document.getElementById("targetSkipVagaroDiscovery").checked = true;

    hydrateTargetedDropdowns();
    setStatus("Targeted scrape choices reset.", "info");
  });
}
async function approveBusinessClaim(claimId) {
  try {
    setStatus("Approving claim...", "info");

    await fetchJson(`/api/business/claims/${claimId}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        reviewedBy: "admin"
      })
    });

    setStatus("Business claim approved.", "success");

    await loadClaims();
  } catch (error) {
    setStatus(`Approval failed: ${error.message}`, "error");
  }
}

async function rejectBusinessClaim(claimId) {
  const reason = window.prompt("Reason for rejection?") || "";

  try {
    setStatus("Rejecting claim...", "info");

    await fetchJson(`/api/business/claims/${claimId}/reject`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        reviewedBy: "admin",
        reason
      })
    });

    setStatus("Business claim rejected.", "success");

    await loadClaims();
  } catch (error) {
    setStatus(`Rejection failed: ${error.message}`, "error");
  }
}

function attachClaimActionListeners() {
  content.querySelectorAll("[data-approve-claim]").forEach((button) => {
    button.addEventListener("click", () => {
      approveBusinessClaim(button.dataset.approveClaim);
    });
  });

  content.querySelectorAll("[data-reject-claim]").forEach((button) => {
    button.addEventListener("click", () => {
      rejectBusinessClaim(button.dataset.rejectClaim);
    });
  });
}

function renderClaimCard(claim) {
  const verification = claim.verification || {};

  return `
    <div class="admin-business-card">
      <div class="business-card-header">
        <div>
          <h3>${escapeHtml(claim.businessName || "Unknown Business")}</h3>

          <p>
            ${escapeHtml(claim.ownerName || "Unknown Owner")}
            ·
            ${escapeHtml(claim.email || "")}
          </p>
        </div>

        <div class="business-header-actions">
          <span class="platform-pill">
            ${escapeHtml(claim.status || "unknown")}
          </span>
        </div>
      </div>

      <div class="business-edit-grid">
        <div class="admin-field">
          <span>Business ID</span>
          <input value="${escapeHtml(claim.businessId || "")}" disabled />
        </div>

        <div class="admin-field">
          <span>Phone</span>
          <input value="${escapeHtml(claim.phone || "")}" disabled />
        </div>

        <div class="admin-field">
          <span>Website</span>
          <input value="${escapeHtml(claim.website || "")}" disabled />
        </div>

        <div class="admin-field">
          <span>Requested At</span>
          <input value="${escapeHtml(claim.requestedAt || "")}" disabled />
        </div>
      </div>

      <details class="raw-json-box">
        <summary>Verification Details</summary>

        <pre>${escapeHtml(
          JSON.stringify(verification, null, 2)
        )}</pre>
      </details>

      <div class="settings-actions">
        <button
          class="primary-btn"
          data-approve-claim="${escapeHtml(claim.claimId)}"
        >
          Approve
        </button>

        <button
          class="danger-btn"
          data-reject-claim="${escapeHtml(claim.claimId)}"
        >
          Reject
        </button>
      </div>
    </div>
  `;
}

async function loadClaims() {
  currentView = "claims";
  setLoading("Loading business claim search...");

  pageTitle.textContent = views.claims.title;
  pageSubtitle.textContent = views.claims.subtitle;

  try {
    const params = new URLSearchParams({
      page: String(claimSearchState.page),
      limit: String(claimSearchState.limit)
    });

    if (claimSearchState.business) params.set("business", claimSearchState.business);
    if (claimSearchState.owner) params.set("owner", claimSearchState.owner);
    if (claimSearchState.email) params.set("email", claimSearchState.email);
    if (claimSearchState.status) params.set("status", claimSearchState.status);

    const data = await fetchJson(`/api/admin/claims/search?${params.toString()}`);
    const claims = Array.isArray(data.claims) ? data.claims : [];

    claimSearchState.page = Number(data.page || 1);
    claimSearchState.limit = Number(data.limit || 20);
    claimSearchState.total = Number(data.total || 0);
    claimSearchState.totalPages = Number(data.totalPages || 1);

    content.innerHTML = `
      <form id="claimSearchForm" class="admin-search-grid">
        ${renderSubscriptionTextInput("Business", "claimSearchBusiness", claimSearchState.business, "Business name")}
        ${renderSubscriptionTextInput("Owner", "claimSearchOwner", claimSearchState.owner, "Owner name")}
        ${renderSubscriptionTextInput("Email", "claimSearchEmail", claimSearchState.email, "owner@example.com")}

        <label class="admin-field">
          <span>Status</span>
          <select id="claimSearchStatus">
            <option value="">All statuses</option>
            <option value="claimed_pending" ${claimSearchState.status === "claimed_pending" ? "selected" : ""}>Pending</option>
            <option value="claimed_verified" ${claimSearchState.status === "claimed_verified" ? "selected" : ""}>Verified</option>
            <option value="claimed_rejected" ${claimSearchState.status === "claimed_rejected" ? "selected" : ""}>Rejected</option>
          </select>
        </label>

        <div class="admin-search-actions">
          <button class="primary-btn" type="submit">Search Claims</button>
          <button id="clearClaimSearchBtn" class="secondary-btn" type="button">Clear</button>
        </div>
      </form>

      <div class="section-heading compact-heading">
        <div>
          <h3>${claimSearchState.total} Matching Claims</h3>
          <p>
            Pending: ${escapeHtml(data.stats?.pending || 0)} ·
            Verified: ${escapeHtml(data.stats?.verified || 0)} ·
            Rejected: ${escapeHtml(data.stats?.rejected || 0)}
          </p>
        </div>
      </div>

      <div class="business-list">
        ${claims.length
          ? claims.map(renderClaimCard).join("")
          : `<p class="empty-note">No business claims matched these filters.</p>`}
      </div>

      <div class="business-pagination">
        <button id="previousClaimPageBtn" class="secondary-btn" ${claimSearchState.page <= 1 ? "disabled" : ""}>Previous</button>
        <span>Page ${claimSearchState.page} of ${claimSearchState.totalPages}</span>
        <button id="nextClaimPageBtn" class="secondary-btn" ${claimSearchState.page >= claimSearchState.totalPages ? "disabled" : ""}>Next</button>
      </div>
    `;

    document.getElementById("claimSearchForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      claimSearchState.business = getInputValue("claimSearchBusiness").trim();
      claimSearchState.owner = getInputValue("claimSearchOwner").trim();
      claimSearchState.email = getInputValue("claimSearchEmail").trim();
      claimSearchState.status = getInputValue("claimSearchStatus");
      claimSearchState.page = 1;
      await loadClaims();
    });

    document.getElementById("clearClaimSearchBtn")?.addEventListener("click", async () => {
      claimSearchState = {
        business: "",
        owner: "",
        email: "",
        status: "",
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1
      };
      await loadClaims();
    });

    document.getElementById("previousClaimPageBtn")?.addEventListener("click", async () => {
      if (claimSearchState.page > 1) {
        claimSearchState.page -= 1;
        await loadClaims();
      }
    });

    document.getElementById("nextClaimPageBtn")?.addEventListener("click", async () => {
      if (claimSearchState.page < claimSearchState.totalPages) {
        claimSearchState.page += 1;
        await loadClaims();
      }
    });

    attachClaimActionListeners();
    setStatus(`Loaded ${claims.length} of ${claimSearchState.total} matching business claims.`, "success");
  } catch (error) {
    content.innerHTML = `
      <h3>Could Not Load Claims</h3>
      <p>${escapeHtml(error.message)}</p>
    `;
    setStatus("Failed to load business claims.", "error");
  }
}

function refreshNavButtons() {
  navButtons = document.querySelectorAll(".nav-btn");
}

function ensureSubscriptionsNavButton() {
  if (document.querySelector(".nav-btn[data-view='subscriptions']")) {
    refreshNavButtons();
    return;
  }

  const navContainer =
    document.querySelector(".admin-nav") ||
    document.querySelector(".sidebar-nav") ||
    document.querySelector("nav") ||
    document.querySelector(".nav-btn")?.parentElement;

  if (!navContainer) {
    refreshNavButtons();
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-btn";
  button.dataset.view = "subscriptions";
  button.textContent = "Subscriptions";

  const settingsButton = navContainer.querySelector(".nav-btn[data-view='settings']");

  if (settingsButton) {
    navContainer.insertBefore(button, settingsButton);
  } else {
    navContainer.appendChild(button);
  }

  refreshNavButtons();
}

function setActiveNav(viewName) {
  navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
}

function loadView(viewName) {
  setActiveNav(viewName);

  if (viewName === "businesses") return loadBusinesses();
  if (viewName === "claims") return loadClaims();
  if (viewName === "results" || viewName === "inventory") return loadResults();
  if (viewName === "errors") return loadErrors();
  if (viewName === "settings") return loadSettings();
  if (viewName === "subscriptions") return loadBusinessSubscriptionsView();
}

ensureSubscriptionsNavButton();

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    loadView(button.dataset.view);
  });
});

refreshBtn.addEventListener("click", () => {
  loadView(currentView);
});

loadView("businesses");