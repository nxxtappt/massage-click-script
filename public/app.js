let allAppointments = [];
let map = null;
let markerLayer = null;
let liveSearchInProgress = false;
let searchDebounceTimer = null;
let resultPollingTimer = null;
let resultPollingAttempts = 0;
let lastGoodAppointments = [];
let currentSearchResults = [];
let userLatitude = null;
let userLongitude = null;
let maxDistanceMiles = 5;
const MAX_POLLING_ATTEMPTS = 30;
const POLLING_INTERVAL_MS = 2000;

const appointmentsGrid = document.getElementById("appointmentsGrid");
const resultsSummary = document.getElementById("resultsSummary");
const searchInput = document.getElementById("searchInput");
const businessFilter = document.getElementById("businessFilter");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const assistantResponse = document.getElementById("assistantResponse");
const liveSearchResults = document.getElementById("liveSearchResults");
const chatSearchForm = document.getElementById("chatSearchForm");
const searchLiveBtn = document.getElementById("searchLiveBtn");

function buildSearchUrl(onDemand = false) {
  const params = new URLSearchParams();

  params.set("limitPerBusiness", "999");
  params.set("fresh", String(Date.now()));

  if (searchInput.value.trim()) {
    params.set("search", searchInput.value.trim());
  }

  if (businessFilter && businessFilter.value) {
    params.set("business", businessFilter.value);
  }

  if (onDemand) {
    params.set("onDemand", "true");
  }
if (userLatitude !== null && userLongitude !== null) {
  params.set("latitude", String(userLatitude));
  params.set("longitude", String(userLongitude));
  params.set("maxDistanceMiles", String(maxDistanceMiles));
}
  return `/api/search?${params.toString()}`;
}

function countBusinesses(appointments) {
  return new Set(
    appointments.map((item) => item.businessName).filter(Boolean)
  ).size;
}

function setAssistantMessage(message, type = "") {
  assistantResponse.innerHTML = `
    <div class="assistant-bubble ${type}">
      ${escapeHtml(message)}
    </div>
  `;
}

function renderThinkingCard() {
  liveSearchResults.classList.add("active");

  liveSearchResults.innerHTML = `
    <p class="live-search-title">Searching for relevant appointments...</p>

    <div class="thinking-card">
      <div class="thinking-line short"></div>
      <div class="thinking-line long"></div>
      <div class="thinking-line medium"></div>

      <div class="thinking-buttons">
        <div class="thinking-button"></div>
        <div class="thinking-button"></div>
        <div class="thinking-button"></div>
      </div>
    </div>
  `;
}

function stopResultPolling() {
  if (resultPollingTimer) {
    clearInterval(resultPollingTimer);
    resultPollingTimer = null;
  }

  resultPollingAttempts = 0;
}

function startResultPolling() {
  stopResultPolling();

  resultPollingAttempts = 0;

  resultPollingTimer = setInterval(async () => {
    resultPollingAttempts += 1;

    const data = await loadAppointments({
      onDemand: false,
      preserveExistingOnEmpty: true,
      isPollingRefresh: true
    });

    const serverStillSearching = data && data.liveSearchRunning === true;

    if (!serverStillSearching && resultPollingAttempts >= 4) {
      stopResultPolling();

      if (currentSearchResults.length > 0) {
        setAssistantMessage(
          `Search finished. I found ${currentSearchResults.length} relevant appointment${currentSearchResults.length === 1 ? "" : "s"} for your latest search.`
        );
      }
    }

    if (resultPollingAttempts >= MAX_POLLING_ATTEMPTS) {
      stopResultPolling();

      if (currentSearchResults.length > 0) {
        setAssistantMessage(
          "I kept checking for new results and updated the search results as they came in."
        );
      }
    }
  }, POLLING_INTERVAL_MS);
}

function mergeAppointments(existingAppointments, incomingAppointments) {
  const existing = Array.isArray(existingAppointments) ? existingAppointments : [];
  const incoming = Array.isArray(incomingAppointments) ? incomingAppointments : [];
  const mapByKey = new Map();

  [...existing, ...incoming].forEach((appointment) => {
    const key = [
      appointment.businessName || "",
      appointment.platform || "",
      appointment.serviceName || "",
      appointment.serviceCategory || "",
      appointment.durationMinutes || "",
      appointment.therapistName || "",
      appointment.startTime || "",
      appointment.localDateKey || appointment.date || appointment.rawDate || "",
      appointment.localTimeKey || appointment.time || appointment.rawTime || ""
    ]
      .map((value) => String(value).toLowerCase().trim())
      .join("|");

    if (!mapByKey.has(key)) {
      mapByKey.set(key, appointment);
    }
  });

  return [...mapByKey.values()].sort((a, b) => {
    const aScore = Number(a.ranking?.score || 0);
    const bScore = Number(b.ranking?.score || 0);

    if (aScore !== bScore) return bScore - aScore;

    const aSort = Number(a.localSortable || 999999999999);
    const bSort = Number(b.localSortable || 999999999999);

    if (aSort !== bSort) return aSort - bSort;

    return String(a.businessName || "").localeCompare(
      String(b.businessName || "")
    );
  });
}

function updateAssistantMessage(data, appointments, promptText = "", isPollingRefresh = false) {
  const businessCount = countBusinesses(appointments);

  if (!appointments.length) {
    if (isPollingRefresh) {
      setAssistantMessage(
        "Still searching. Relevant appointment cards will appear under the search bar as soon as results come in."
      );
      return;
    }

    setAssistantMessage(
      "I couldn't find matching appointments yet. Try a broader search.",
      "error"
    );
    return;
  }

  if (isPollingRefresh && data && data.liveSearchRunning) {
    setAssistantMessage(
      `Still searching live availability. So far I found ${appointments.length} appointment${appointments.length === 1 ? "" : "s"} across ${businessCount} business${businessCount === 1 ? "" : "es"}.`
    );
    return;
  }

  if (promptText) {
    setAssistantMessage(
      `I searched for "${promptText}" and found ${appointments.length} appointment${appointments.length === 1 ? "" : "s"} across ${businessCount} business${businessCount === 1 ? "" : "es"}.`
    );
    return;
  }

  setAssistantMessage(
    `I found ${appointments.length} fresh appointment${appointments.length === 1 ? "" : "s"} across ${businessCount} business${businessCount === 1 ? "" : "es"}.`
  );
}

function triggerLiveSearchInBackground() {
  if (liveSearchInProgress) {
    return;
  }

  liveSearchInProgress = true;
  searchLiveBtn.disabled = true;
  searchLiveBtn.textContent = "Searching...";

  fetch(buildSearchUrl(true))
    .then((response) => response.json())
    .then((data) => {
      if (!data.success) {
        throw new Error(data.error || "Live search failed");
      }

      return loadAppointments({
        onDemand: false,
        preserveExistingOnEmpty: true,
        isPollingRefresh: true
      });
    })
    .catch((error) => {
      console.error("Live search failed:", error);

      if (currentSearchResults.length > 0) {
        setAssistantMessage(
          "I found cached results for your search. Live refresh had an issue, but I kept the relevant results visible."
        );
        return;
      }

      if (lastGoodAppointments.length > 0) {
        setAssistantMessage(
          "I’m still checking live availability. For now, I kept the latest fresh appointment results visible."
        );
        return;
      }

      setAssistantMessage(
        "I’m still checking availability. Try a broader search if nothing appears.",
        "error"
      );
    })
    .finally(() => {
      liveSearchInProgress = false;
      searchLiveBtn.disabled = false;
      searchLiveBtn.textContent = "Search";
    });
}
function requestUserLocation() {
  if (!navigator.geolocation) {
    setAssistantMessage("Location is not available in this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      userLatitude = position.coords.latitude;
      userLongitude = position.coords.longitude;

      setAssistantMessage("Location enabled. Search results will now prioritize nearby appointments.");
    },
    () => {
      setAssistantMessage("Location permission was not enabled. I’ll keep searching without distance sorting.");
    },
    {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 300000
    }
  );
}
async function runPromptSearch() {
  const promptText = searchInput.value.trim();
if (
  promptText &&
  userLatitude === null &&
  userLongitude === null
) {
  requestUserLocation();
}
  if (!promptText) {
    await loadAppointments({
      onDemand: false,
      preserveExistingOnEmpty: true
    });

    return;
  }

  stopResultPolling();

  currentSearchResults = [];
  renderThinkingCard();

  setAssistantMessage(
    `Searching for "${promptText}". I’ll show cached results first, then live results as they come in.`
  );

  resultsSummary.textContent = "Checking cache and live availability...";

  await loadAppointments({
    onDemand: false,
    preserveExistingOnEmpty: true,
    isPollingRefresh: true
  });

  triggerLiveSearchInBackground();
  startResultPolling();
}

async function loadAppointments(options = {}) {
  const onDemand = options.onDemand === true;
  const preserveExistingOnEmpty = options.preserveExistingOnEmpty === true;
  const isPollingRefresh = options.isPollingRefresh === true;
  const promptText = searchInput.value.trim();

  try {
    if (onDemand) {
      triggerLiveSearchInBackground();
      return null;
    }

    if (!isPollingRefresh) {
      resultsSummary.textContent = "Loading fresh appointments...";
    }

    const response = await fetch(buildSearchUrl(false));
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to load appointments");
    }

    const incomingAppointments = Array.isArray(data.appointments)
      ? data.appointments
      : [];

    if (promptText) {
      if (incomingAppointments.length > 0) {
        currentSearchResults = mergeAppointments(
          currentSearchResults,
          incomingAppointments
        );

        renderLiveSearchResults(currentSearchResults);

        updateAssistantMessage(
          data,
          currentSearchResults,
          promptText,
          isPollingRefresh
        );
      } else if (!currentSearchResults.length) {
        renderThinkingCard();

        updateAssistantMessage(
          data,
          currentSearchResults,
          promptText,
          isPollingRefresh
        );
      }

      if (lastGoodAppointments.length > 0) {
        allAppointments = lastGoodAppointments;
      } else if (incomingAppointments.length > 0) {
        allAppointments = incomingAppointments;
        lastGoodAppointments = incomingAppointments;
      }
    } else {
      currentSearchResults = [];
      renderLiveSearchResults(currentSearchResults);

      if (incomingAppointments.length > 0) {
        allAppointments = incomingAppointments;
        lastGoodAppointments = incomingAppointments;
      } else if (preserveExistingOnEmpty && lastGoodAppointments.length > 0) {
        allAppointments = lastGoodAppointments;
      } else {
        allAppointments = [];
      }

      updateAssistantMessage(data, allAppointments, "", isPollingRefresh);
    }

    populateFilters(allAppointments);
    allAppointments = mergeAppointments([], allAppointments);
    renderBusinessCards(allAppointments);
    initMap();
    renderMapMarkers(allAppointments);

    const businessCount = countBusinesses(allAppointments);

    resultsSummary.textContent = `${businessCount} business${businessCount === 1 ? "" : "es"} • ${allAppointments.length} appointment${allAppointments.length === 1 ? "" : "s"}`;

    return data;
  } catch (error) {
    console.error("Failed to load appointments:", error);

    if (currentSearchResults.length > 0) {
      renderLiveSearchResults(currentSearchResults);
      setAssistantMessage(
        "I found cached results for your search. Live refresh had an issue, but I kept the relevant results visible."
      );
      return null;
    }

    if (lastGoodAppointments.length > 0) {
      allAppointments = lastGoodAppointments;
      allAppointments = mergeAppointments([], allAppointments);
      renderBusinessCards(allAppointments);
      renderMapMarkers(allAppointments);
      setAssistantMessage(
        "The search had an issue, so I kept the latest visible appointment results.",
        "error"
      );
      resultsSummary.textContent = `${countBusinesses(allAppointments)} businesses • ${allAppointments.length} appointments`;
      return null;
    }

    setAssistantMessage("Something went wrong while searching appointments.", "error");
    resultsSummary.textContent = "Could not load appointment data.";

    appointmentsGrid.innerHTML = `
      <div class="empty-state">
        <h2>Something went wrong</h2>
        <p>${escapeHtml(error.message)}</p>
      </div>
    `;

    return null;
  }
}

function renderLiveSearchResults(appointments) {
  if (!liveSearchResults) return;

  if (!appointments.length) {
    liveSearchResults.classList.remove("active");
    liveSearchResults.innerHTML = "";
    return;
  }

  const groupedBusinesses = groupAppointmentsByBusiness(appointments);
  const businessGroups = Object.values(groupedBusinesses);

  liveSearchResults.classList.add("active");

  liveSearchResults.innerHTML = `
    <p class="live-search-title">Relevant results for your latest search</p>

    <div class="live-result-list">
      ${businessGroups
        .slice(0, 5)
        .map((group) => {
          const firstAppointment = group.appointments[0];
          const businessName = firstAppointment.businessName || "Unknown Business";
          const bookingUrl = firstAppointment.bookingUrl || "#";
          const address = firstAppointment.address || "Address not listed";
          const serviceSummary = getServiceSummary(group.appointments);
          const topAppointments = group.appointments.slice(0, 4);

          return `
            <article class="live-result-card">
              <div class="live-result-top">
                <div>
                  <h3>${escapeHtml(businessName)}</h3>
                  <p>${escapeHtml(address)}</p>
                  <p>
  ${escapeHtml(serviceSummary)}
  ${firstAppointment.price ? ` · ${escapeHtml(firstAppointment.price)}` : ""}
</p>
                </div>

                <div class="business-meta">
                  <span class="platform-pill">${escapeHtml(firstAppointment.platform || "Live")}</span>
                </div>
              </div>

              <div class="live-result-buttons">
                ${topAppointments
                  .map((appointment) => {
                    return `
                      <a
                        class="time-button"
                        href="${escapeAttribute(appointment.bookingUrl || bookingUrl)}"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        ${escapeHtml(formatTimeButtonText(appointment))}
                      </a>
                    `;
                  })
                  .join("")}
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function populateFilters(appointments) {
  if (!businessFilter) return;

  const currentValue = businessFilter.value;

  businessFilter.innerHTML = `<option value="">All businesses</option>`;

  const businesses = [
    ...new Set(appointments.map((item) => item.businessName).filter(Boolean))
  ];

  businesses.sort();

  businesses.forEach((business) => {
    const option = document.createElement("option");
    option.value = business;
    option.textContent = business;
    businessFilter.appendChild(option);
  });

  if (currentValue && businesses.includes(currentValue)) {
    businessFilter.value = currentValue;
  }
}

function applyFilters() {
  clearTimeout(searchDebounceTimer);

  searchDebounceTimer = setTimeout(() => {
    if (!searchInput.value.trim()) {
      loadAppointments({
        onDemand: false,
        preserveExistingOnEmpty: true
      });
    }
  }, 350);
}

function renderBusinessCards(appointments) {
  appointmentsGrid.innerHTML = "";

  const groupedBusinesses = groupAppointmentsByBusiness(appointments);
  const businessGroups = Object.values(groupedBusinesses);

  if (!businessGroups.length) {
    appointmentsGrid.innerHTML = `
      <div class="empty-state">
        <h2>No appointments found</h2>
        <p>Try a broader prompt or search again.</p>
      </div>
    `;
    return;
  }

  businessGroups.forEach((group) => {
    const firstAppointment = group.appointments[0];

    const businessName = firstAppointment.businessName || "Unknown Business";
    const bookingUrl = firstAppointment.bookingUrl || "#";
    const address = firstAppointment.address || "Address not listed";
    const logoUrl = firstAppointment.logoUrl || "";
    const logoAlt = firstAppointment.logoAlt || `${businessName} logo`;

    const verificationStatus =
      firstAppointment.verificationStatus || "unclaimed";

    const isVerifiedBusiness = verificationStatus === "verified";

    const claimBusinessUrl = `/business?businessName=${encodeURIComponent(
    businessName
    )}`;

    const distance =
      typeof firstAppointment.distanceMiles === "number"
        ? `${firstAppointment.distanceMiles.toFixed(1)} mi away`
        : "";

    const nextAppointments = group.appointments.slice(0, 4);

    const card = document.createElement("article");
    card.className = "business-card";
    card.id = makeBusinessCardId(businessName);

    card.innerHTML = `
      <div class="logo-circle">
        ${
          logoUrl
            ? `<img src="${escapeAttribute(logoUrl)}" alt="${escapeAttribute(logoAlt)}">`
            : escapeHtml(getInitials(businessName))
        }
      </div>

      <div class="business-main">
        <div class="business-header">
          <div>
            <div class="business-title-row">
              <h2>${escapeHtml(businessName)}</h2>
              ${
                isVerifiedBusiness
                  ? `<span class="verified-business-badge">Verified Business</span>`
                  : ""
              }
            </div>

            <p class="business-address">${escapeHtml(address)}</p>

            ${
              !isVerifiedBusiness
                ? `<a class="claim-business-link" href="${escapeAttribute(claimBusinessUrl)}">Claim this business</a>`
                : ""
            }
          </div>

          <div class="business-meta">
            ${
              distance
                ? `<span class="distance-pill">${escapeHtml(distance)}</span>`
                : ""
            }
          </div>
        </div>

        <p class="business-service">
          ${escapeHtml(getServiceSummary(group.appointments))}
          ${firstAppointment.price ? ` · ${escapeHtml(firstAppointment.price)}` : ""}
        </p>

        <p class="next-label">Fresh appointment times:</p>

        <div class="time-buttons">
          ${nextAppointments
            .map((appointment) => {
              return `
                <a
                  class="time-button"
                  href="${escapeAttribute(appointment.bookingUrl || bookingUrl)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-track-appointment-click="true"
                  data-appointment-payload="${escapeAttribute(JSON.stringify({
                    businessName: appointment.businessName || businessName,
                    platform: appointment.platform || "",
                    serviceName: appointment.serviceName || "",
                    serviceCategory: appointment.serviceCategory || "",
                    durationMinutes: appointment.durationMinutes || null,
                    therapistName: appointment.therapistName || "",
                    appointmentDate: appointment.date || "",
                    appointmentTime: appointment.time || "",
                    startTime: appointment.startTime || "",
                    localDateKey: appointment.localDateKey || "",
                    localTimeKey: appointment.localTimeKey || "",
                    bookingUrl: appointment.bookingUrl || bookingUrl,
                    sourcePage: "search"
                  }))}"
                >
                  ${escapeHtml(formatTimeButtonText(appointment))}
                </a>
              `;
            })
            .join("")}
        </div>
      </div>
    `;

    appointmentsGrid.appendChild(card);
  });
}

function groupAppointmentsByBusiness(appointments) {
  const groups = {};

  const sortedAppointments = [...appointments].sort((a, b) => {
    const aScore = Number(a.ranking?.score || 0);
    const bScore = Number(b.ranking?.score || 0);

    if (aScore !== bScore) return bScore - aScore;

    const aSort = Number(a.localSortable || 999999999999);
    const bSort = Number(b.localSortable || 999999999999);

    if (aSort !== bSort) return aSort - bSort;

    return String(a.businessName || "").localeCompare(
      String(b.businessName || "")
    );
  });

  sortedAppointments.forEach((appointment) => {
    const key = appointment.businessName || "Unknown Business";

    if (!groups[key]) {
      groups[key] = {
        businessName: key,
        appointments: []
      };
    }

    groups[key].appointments.push(appointment);
  });

  return groups;
}

function getServiceSummary(appointments) {
  const services = [
    ...new Set(appointments.map((item) => item.serviceName).filter(Boolean))
  ];

  if (!services.length) return "Available appointments";

  if (services.length === 1) return services[0];

  return `${services[0]} + ${services.length - 1} more service${services.length - 1 === 1 ? "" : "s"}`;
}

function initMap() {
  if (map || !document.getElementById("map") || typeof L === "undefined") return;

  map = L.map("map", {
    scrollWheelZoom: false
  }).setView([30.2672, -97.7431], 11);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
}

function renderMapMarkers(appointments) {
  if (!map || !markerLayer || typeof L === "undefined") return;

  markerLayer.clearLayers();

  const groupedBusinesses = Object.values(groupAppointmentsByBusiness(appointments));

  const businessesWithCoordinates = groupedBusinesses
    .map((group) => {
      const firstAppointment = group.appointments[0];

      return {
        businessName: firstAppointment.businessName || "Unknown Business",
        address: firstAppointment.address || "",
        bookingUrl: firstAppointment.bookingUrl || "#",
        logoUrl: firstAppointment.logoUrl || "",
        latitude: Number(firstAppointment.latitude),
        longitude: Number(firstAppointment.longitude),
        appointments: group.appointments
      };
    })
    .filter((business) => {
      return Number.isFinite(business.latitude) && Number.isFinite(business.longitude);
    });

  if (!businessesWithCoordinates.length) {
    map.setView([30.2672, -97.7431], 11);
    return;
  }

  const bounds = [];

  businessesWithCoordinates.forEach((business) => {
    const icon = L.divIcon({
      className: "",
      html: `
        <div class="map-thumb-marker">
          ${
            business.logoUrl
              ? `<img src="${escapeAttribute(business.logoUrl)}" alt="">`
              : escapeHtml(getInitials(business.businessName))
          }
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      popupAnchor: [0, -22]
    });

    const marker = L.marker([business.latitude, business.longitude], { icon });

    marker.bindPopup(`
      <div class="map-popup">
        <h3>${escapeHtml(business.businessName)}</h3>
        <p>${escapeHtml(business.address || "Address not listed")}</p>
        <p>${escapeHtml(formatTimeButtonText(business.appointments[0]))}</p>
        <a href="${escapeAttribute(business.bookingUrl)}" target="_blank" rel="noopener noreferrer">Book appointment</a>
      </div>
    `);

    marker.on("click", () => {
      const card = document.getElementById(makeBusinessCardId(business.businessName));

      if (card) {
        card.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      }
    });

    marker.addTo(markerLayer);
    bounds.push([business.latitude, business.longitude]);
  });

  if (bounds.length === 1) {
    map.setView(bounds[0], 13);
  } else {
    map.fitBounds(bounds, {
      padding: [40, 40]
    });
  }

  setTimeout(() => {
    map.invalidateSize();
  }, 100);
}

function formatTimeButtonText(appointment) {
  if (appointment.date && appointment.time && !String(appointment.time).includes("T")) {
    return `${appointment.date} ${appointment.time}`;
  }

  if (appointment.startTime) {
    const parsed = new Date(appointment.startTime);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    }
  }

  if (appointment.time) return appointment.time;

  return "Time available";
}

function makeBusinessCardId(name) {
  return "business-card-" + String(name || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getInitials(name) {
  return String(name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

searchInput.addEventListener("input", applyFilters);

chatSearchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runPromptSearch();
});

if (businessFilter) {
  businessFilter.addEventListener("change", () => {
    loadAppointments({
      onDemand: false,
      preserveExistingOnEmpty: true
    });
  });
}

if (clearFiltersBtn) {
  clearFiltersBtn.addEventListener("click", () => {
    searchInput.value = "";
    if (businessFilter) businessFilter.value = "";
    stopResultPolling();

    currentSearchResults = [];
    renderLiveSearchResults(currentSearchResults);

    loadAppointments({
      onDemand: false,
      preserveExistingOnEmpty: false
    });
  });
}

document.addEventListener("click", async (event) => {
  const link = event.target.closest(
    "[data-track-appointment-click='true']"
  );

  if (!link) {
    return;
  }

  try {
    const payload = JSON.parse(
      link.dataset.appointmentPayload || "{}"
    );

    await fetch("/api/analytics/appointment-click", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      keepalive: true
    });
  } catch (error) {
    console.warn(
      "Appointment click tracking failed:",
      error
    );
  }
});

async function initializeApp() {
  try {
    const response = await fetch(
      "/api/settings/public"
    );

    const settings =
      await response.json();

    if (
      settings.searchEnabled === false
    ) {
      const heroTitle =
  document.getElementById("heroTitle");

const heroSubtitle =
  document.getElementById("heroSubtitle");

if (heroTitle) {
  heroTitle.textContent =
    "Available Massage Appointments in Austin";
}

if (heroSubtitle) {
  heroSubtitle.textContent =
    "Freshly updated appointment availability from massage businesses across the Austin area.";
}
      if (chatSearchForm) {
        chatSearchForm.style.display =
          "none";
      }

      if (assistantResponse) {
        assistantResponse.innerHTML = `
          <div class="assistant-bubble">
            Find massage appointments available right now across Austin
          </div>
        `;
      }
    }

    loadAppointments({
      onDemand: false,
      preserveExistingOnEmpty: false
    });
  } catch (error) {
    console.error(
      "Failed to load public settings:",
      error
    );

    loadAppointments({
      onDemand: false,
      preserveExistingOnEmpty: false
    });
  }
}

initializeApp();