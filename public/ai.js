const queryInput = document.getElementById("query");
const searchBtn = document.getElementById("searchBtn");
const chatThread = document.getElementById("chatThread");
const chatForm = document.getElementById("chatForm");

const conversationState = {
  messages: [],
  lastQuery: "",
  lastResolvedQuery: "",
  lastIntent: null,
  lastSearchParams: {},
  lastPromptMode: "",
  lastAppointments: []
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function groupAppointmentsByBusiness(appointments = []) {
  const groups = {};

  const sortedAppointments = [...appointments].sort((a, b) => {
    const aScore = Number(a.ranking?.score || 0);
    const bScore = Number(b.ranking?.score || 0);
    if (aScore !== bScore) return bScore - aScore;

    const aSort = Number(a.localSortable || 999999999999);
    const bSort = Number(b.localSortable || 999999999999);
    if (aSort !== bSort) return aSort - bSort;

    return String(a.businessName || "").localeCompare(String(b.businessName || ""));
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

function dedupeAppointments(appointments = []) {
  const seen = new Set();
  const output = [];

  appointments.forEach((appointment) => {
    const key = [
      appointment.businessName,
      appointment.platform,
      appointment.serviceName || appointment.service,
      appointment.serviceCategory || appointment.serviceType,
      appointment.durationMinutes,
      appointment.therapistName,
      appointment.startTime,
      appointment.localDateKey,
      appointment.localTimeKey,
      appointment.time
    ]
      .map(normalize)
      .join("|");

    if (seen.has(key)) return;
    seen.add(key);
    output.push(appointment);
  });

  return output;
}

function getServiceSummary(appointments = []) {
  const services = [
    ...new Set(
      appointments
        .map((item) => item.serviceName || item.service || "")
        .filter(Boolean)
    )
  ];

  if (!services.length) return "Available appointments";
  if (services.length === 1) return services[0];

  return `${services[0]} + ${services.length - 1} more service${
    services.length - 1 === 1 ? "" : "s"
  }`;
}

function formatTimeButtonText(appointment = {}) {
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

function getInitials(name) {
  return String(name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function makeBusinessCardId(name) {
  return (
    "ai-business-card-" +
    String(name || "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
  );
}

function countBusinesses(appointments = []) {
  return Object.keys(groupAppointmentsByBusiness(appointments)).length;
}

function renderResultsSummary(container, appointments = []) {
  const summary = document.createElement("p");
  summary.className = "results-summary";

  const businessCount = countBusinesses(appointments);

  if (!appointments.length) {
    summary.textContent = "No matching appointment cards found.";
  } else {
    summary.textContent = `${businessCount} business${
      businessCount === 1 ? "" : "es"
    } • ${appointments.length} appointment${appointments.length === 1 ? "" : "s"}`;
  }

  container.appendChild(summary);
}

function buildAppointmentPayload(appointment = {}, businessName = "", bookingUrl = "") {
  return {
    businessName: appointment.businessName || businessName,
    platform: appointment.platform || "",
    serviceName: appointment.serviceName || appointment.service || "",
    serviceCategory: appointment.serviceCategory || appointment.serviceType || "",
    durationMinutes: appointment.durationMinutes || null,
    therapistName: appointment.therapistName || "",
    appointmentDate: appointment.date || "",
    appointmentTime: appointment.time || "",
    startTime: appointment.startTime || "",
    localDateKey: appointment.localDateKey || "",
    localTimeKey: appointment.localTimeKey || "",
    bookingUrl: appointment.bookingUrl || bookingUrl,
    sourcePage: "ai-search"
  };
}

function renderBusinessCards(container, appointments = [], options = {}) {
  const grid = document.createElement("section");
  grid.className = "appointments-grid";

  const groupedBusinesses = groupAppointmentsByBusiness(dedupeAppointments(appointments));
  const businessGroups = Object.values(groupedBusinesses);
  const maxBusinessCards = Number(options.maxBusinessCards || 4);
  const visibleBusinessGroups = maxBusinessCards > 0 ? businessGroups.slice(0, maxBusinessCards) : businessGroups;

  if (!businessGroups.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h2>No appointment cards found</h2>
        <p>Try a broader search like “massage today”, “swedish massage”, or “deep tissue massage tomorrow”.</p>
      </div>
    `;

    container.appendChild(grid);
    return;
  }

  visibleBusinessGroups.forEach((group) => {
    const firstAppointment = group.appointments[0] || {};
    const businessName = firstAppointment.businessName || "Unknown Business";
    const bookingUrl = firstAppointment.bookingUrl || "#";
    const address = firstAppointment.address || "Address not listed";
    const logoUrl = firstAppointment.logoUrl || "";
    const logoAlt = firstAppointment.logoAlt || `${businessName} logo`;
    const verificationStatus = firstAppointment.verificationStatus || "unclaimed";
    const isVerifiedBusiness = verificationStatus === "verified";
    const claimBusinessUrl = `/business?businessName=${encodeURIComponent(businessName)}`;
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
              ${isVerifiedBusiness ? `<span class="verified-business-badge">Verified Business</span>` : ""}
            </div>

            <p class="business-address">${escapeHtml(address)}</p>

            ${
              !isVerifiedBusiness
                ? `<a class="claim-business-link" href="${escapeAttribute(claimBusinessUrl)}">Claim this business</a>`
                : ""
            }
          </div>

          <div class="business-meta">
            ${distance ? `<span class="distance-pill">${escapeHtml(distance)}</span>` : ""}
            ${firstAppointment.platform ? `<span class="platform-pill">${escapeHtml(firstAppointment.platform)}</span>` : ""}
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
              const payload = buildAppointmentPayload(appointment, businessName, bookingUrl);

              return `
                <a
                  class="time-button"
                  href="${escapeAttribute(appointment.bookingUrl || bookingUrl)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-track-appointment-click="true"
                  data-appointment-payload="${escapeAttribute(JSON.stringify(payload))}"
                >
                  ${escapeHtml(formatTimeButtonText(appointment))}
                </a>
              `;
            })
            .join("")}
        </div>
      </div>
    `;

    grid.appendChild(card);
  });

  if (businessGroups.length > visibleBusinessGroups.length) {
    const more = document.createElement("p");
    more.className = "results-summary";
    more.textContent = `Showing top ${visibleBusinessGroups.length} businesses. Refine your prompt for more specific cards.`;
    grid.appendChild(more);
  }

  container.appendChild(grid);
}

function renderRelevantBusinesses(container, businesses = []) {
  if (!Array.isArray(businesses) || !businesses.length) return;

  const wrap = document.createElement("div");
  wrap.className = "inline-results business-info-results";

  const title = document.createElement("p");
  title.className = "results-summary";
  title.textContent = "Relevant business knowledge";
  wrap.appendChild(title);

  businesses.slice(0, 3).forEach((business) => {
    const card = document.createElement("article");
    card.className = "business-card info-only-card";

    const businessName = business.businessName || business.name || "Business";
    const description =
      business.positioning?.shortDescription ||
      business.shortDescription ||
      business.description ||
      "Listed in NextAppt business knowledge.";
    const specialties = Array.isArray(business.specialties) ? business.specialties.slice(0, 4) : [];
    const amenities = Array.isArray(business.amenities) ? business.amenities.slice(0, 4) : [];

    card.innerHTML = `
      <div class="logo-circle">${escapeHtml(getInitials(businessName))}</div>
      <div class="business-main">
        <div class="business-header">
          <div>
            <div class="business-title-row">
              <h2>${escapeHtml(businessName)}</h2>
            </div>
            <p class="business-address">${escapeHtml(description)}</p>
          </div>
        </div>
        ${specialties.length ? `<p class="business-service">Specialties: ${escapeHtml(specialties.join(", "))}</p>` : ""}
        ${amenities.length ? `<p class="business-service">Amenities/services: ${escapeHtml(amenities.join(", "))}</p>` : ""}
      </div>
    `;

    wrap.appendChild(card);
  });

  container.appendChild(wrap);
}

function renderDebug(container, data) {
  const showDebug = new URLSearchParams(window.location.search).get("debug") === "true";
  if (!showDebug || !data?.debug) return;

  const debug = document.createElement("details");
  debug.className = "debug-box";
  debug.innerHTML = `
    <summary style="cursor:pointer;font-weight:800;">Debug</summary>
    <pre>${escapeHtml(JSON.stringify(data.debug, null, 2))}</pre>
  `;

  container.appendChild(debug);
}

function addChatMessage(role, message, options = {}) {
  const item = document.createElement("div");
  item.className = `chat-message ${role}`;

  if (role === "assistant" && options.allowHtml === true) {
    item.innerHTML = message;
  } else {
    item.textContent = message;
  }

  chatThread.appendChild(item);

  conversationState.messages.push({
    role,
    content: String(message || ""),
    createdAt: new Date().toISOString()
  });

  requestAnimationFrame(() => {
    item.scrollIntoView({ behavior: "smooth", block: "end" });
  });

  return item;
}

function shouldRenderAppointmentCards(data = {}, appointments = []) {
  if (!appointments.length) return false;
  if (data.shouldShowAppointmentCards === true) return true;

  return ["appointment_search", "appointment_search_followup"].includes(String(data.promptMode || ""));
}

function shouldRenderBusinessKnowledge(data = {}, appointments = []) {
  if (appointments.length) return false;
  if (["appointment_search", "appointment_search_followup"].includes(String(data.promptMode || ""))) return false;
  return Array.isArray(data.relevantBusinesses) && data.relevantBusinesses.length > 0;
}

function addFeedbackBox(item) {
  const feedbackBox = document.createElement("div");
  feedbackBox.className = "chat-feedback-box";
  feedbackBox.innerHTML = `
    <button type="button" class="chat-feedback-btn" data-chat-rating="good">👍 Good result</button>
    <button type="button" class="chat-feedback-btn" data-chat-rating="bad">👎 Bad result</button>

    <div class="chat-feedback-form" style="display:none;">
      <textarea class="chat-feedback-text" placeholder="Tell us what was helpful or wrong..."></textarea>
      <button type="button" class="chat-feedback-submit">Submit feedback</button>
    </div>
  `;

  item.appendChild(feedbackBox);
}

function addAssistantResultMessage(answer, appointments = [], data = {}) {
  const item = document.createElement("div");
  item.className = "chat-message assistant";

  const answerText = document.createElement("div");
  answerText.className = "chat-answer-text";
  answerText.textContent = answer || "Here’s what I found.";
  item.appendChild(answerText);

  const cleanAppointments = dedupeAppointments(Array.isArray(appointments) ? appointments : []);

  if (shouldRenderAppointmentCards(data, cleanAppointments)) {
    const resultsWrap = document.createElement("div");
    resultsWrap.className = "inline-results";

    renderResultsSummary(resultsWrap, cleanAppointments);
    renderBusinessCards(resultsWrap, cleanAppointments, { maxBusinessCards: 4 });
    renderDebug(resultsWrap, data);

    item.appendChild(resultsWrap);
  } else if (shouldRenderBusinessKnowledge(data, cleanAppointments)) {
    renderRelevantBusinesses(item, data.relevantBusinesses);
    renderDebug(item, data);
  } else {
    renderDebug(item, data);
  }

  addFeedbackBox(item);
  chatThread.appendChild(item);

  conversationState.messages.push({
    role: "assistant",
    content: answerText.textContent,
    createdAt: new Date().toISOString()
  });

  requestAnimationFrame(() => {
    item.scrollIntoView({ behavior: "smooth", block: "end" });
  });

  return item;
}

function addLoadingMessage(query) {
  const item = document.createElement("div");
  item.className = "chat-message assistant";
  item.innerHTML = `
    <div class="chat-answer-text">Checking NextAppt data...</div>
    <div class="inline-results">
      <div class="empty-state">
        <h2>Thinking...</h2>
        <p>Checking the best response for “${escapeHtml(query)}”.</p>
      </div>
    </div>
  `;

  chatThread.appendChild(item);

  requestAnimationFrame(() => {
    item.scrollIntoView({ behavior: "smooth", block: "end" });
  });

  return item;
}

function removeMessage(item) {
  if (item && item.parentNode) item.parentNode.removeChild(item);
}

function setSearchingState() {
  if (!searchBtn) return;
  searchBtn.disabled = true;
  searchBtn.textContent = "Searching...";
}

function clearSearchingState() {
  if (!searchBtn) return;
  searchBtn.disabled = false;
  searchBtn.textContent = "Ask AI";
}

function updateConversationState(data, query, appointments) {
  conversationState.lastQuery = query;
  conversationState.lastResolvedQuery = data.resolvedQuery || query;
  conversationState.lastIntent = data.matchedIntent || null;
  conversationState.lastSearchParams = data.searchParamsUsed || {};
  conversationState.lastPromptMode = data.promptMode || "";
  conversationState.lastAppointments = Array.isArray(appointments) ? appointments : [];

  if (data.conversationState && typeof data.conversationState === "object") {
    conversationState.lastQuery = data.conversationState.lastQuery || conversationState.lastQuery;
    conversationState.lastResolvedQuery = data.conversationState.lastResolvedQuery || conversationState.lastResolvedQuery;
    conversationState.lastIntent = data.conversationState.lastIntent || conversationState.lastIntent;
    conversationState.lastSearchParams = data.conversationState.lastSearchParams || conversationState.lastSearchParams;
    conversationState.lastPromptMode = data.conversationState.lastPromptMode || conversationState.lastPromptMode;
  }
}

function getPayloadConversationState() {
  return {
    messages: conversationState.messages.slice(-12),
    lastQuery: conversationState.lastQuery,
    lastResolvedQuery: conversationState.lastResolvedQuery,
    lastIntent: conversationState.lastIntent,
    lastSearchParams: conversationState.lastSearchParams,
    lastPromptMode: conversationState.lastPromptMode
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response. Status ${response.status}. Response starts with: ${text.slice(0, 160)}`);
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.error || response.statusText || "AI search failed");
  }

  return data;
}

async function runAiSearch(promptOverride = "") {
  const query = String(promptOverride || queryInput?.value || "").trim();

  if (!query) {
    addChatMessage("assistant", "Enter a search first.");
    return;
  }

  addChatMessage("user", query);

  if (queryInput) {
    queryInput.value = "";
    autoResizeTextarea();
  }

  setSearchingState();
  const loadingMessage = addLoadingMessage(query);

  try {
    const response = await fetch("/api/ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        conversationState: getPayloadConversationState()
      })
    });

    const data = await parseJsonResponse(response);
    const appointments = Array.isArray(data.appointments) ? dedupeAppointments(data.appointments) : [];
    const answer = data.answer || "Here’s what I found.";

    updateConversationState(data, query, appointments);
    removeMessage(loadingMessage);
    addAssistantResultMessage(answer, appointments, data);
  } catch (error) {
    removeMessage(loadingMessage);
    addChatMessage("assistant", error.message || "The AI search had an issue.");
  } finally {
    clearSearchingState();
  }
}

function autoResizeTextarea() {
  if (!queryInput) return;
  queryInput.style.height = "auto";
  queryInput.style.height = `${Math.min(queryInput.scrollHeight, 150)}px`;
}

if (chatForm) {
  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runAiSearch();
  });
}

if (queryInput) {
  queryInput.addEventListener("input", autoResizeTextarea);

  queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      runAiSearch();
    }
  });
}

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    runAiSearch(button.dataset.prompt || "");
  });
});

document.addEventListener("click", async (event) => {
  const ratingButton = event.target.closest("[data-chat-rating]");

  if (ratingButton) {
    const feedbackBox = ratingButton.closest(".chat-feedback-box");
    const form = feedbackBox?.querySelector(".chat-feedback-form");

    if (form) {
      form.style.display = "block";
      form.dataset.selectedRating = ratingButton.dataset.chatRating || "";
    }

    return;
  }

  const submitButton = event.target.closest(".chat-feedback-submit");
  if (!submitButton) return;

  const feedbackBox = submitButton.closest(".chat-feedback-box");
  const form = feedbackBox?.querySelector(".chat-feedback-form");
  const feedbackTextInput = feedbackBox?.querySelector(".chat-feedback-text");
  const rating = form?.dataset.selectedRating || "";
  const feedbackText = feedbackTextInput?.value || "";

  const lastUserMessage = [...conversationState.messages].reverse().find((msg) => msg.role === "user");
  const lastAssistantMessage = [...conversationState.messages].reverse().find((msg) => msg.role === "assistant");

  submitButton.disabled = true;
  submitButton.textContent = "Saving...";

  try {
    const response = await fetch("/api/chatbot-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        aiVersion: "v2-ai-route-relevance-fix",
        rating,
        feedbackText,
        prompt: lastUserMessage?.content || "",
        normalizedPrompt: normalize(lastUserMessage?.content || ""),
        assistantAnswer: lastAssistantMessage?.content || "",
        lastPromptMode: conversationState.lastPromptMode,
        lastSearchParams: conversationState.lastSearchParams,
        page: window.location.pathname
      })
    });

    const data = await parseJsonResponse(response);
    if (!data.success) throw new Error(data.error || "Feedback failed");

    submitButton.textContent = "Saved";
    if (feedbackTextInput) feedbackTextInput.disabled = true;
  } catch (error) {
    console.error("Feedback save failed:", error);
    submitButton.disabled = false;
    submitButton.textContent = "Try again";
  }
});

document.addEventListener("click", async (event) => {
  const link = event.target.closest("[data-track-appointment-click='true']");
  if (!link) return;

  try {
    const payload = JSON.parse(link.dataset.appointmentPayload || "{}");

    await fetch("/api/analytics/appointment-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    });
  } catch (error) {
    console.warn("Appointment click tracking failed:", error);
  }
});

addChatMessage(
  "system",
  "Ask for an appointment, or ask about services and businesses. Appointment cards only appear when your prompt is actually asking for availability."
);