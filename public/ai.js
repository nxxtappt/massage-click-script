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
  lastAppointments: []
};

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

function groupAppointmentsByBusiness(appointments = []) {
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
  if (
    appointment.date &&
    appointment.time &&
    !String(appointment.time).includes("T")
  ) {
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

function renderBusinessCards(container, appointments = []) {
  const grid = document.createElement("section");
  grid.className = "appointments-grid";

  const groupedBusinesses = groupAppointmentsByBusiness(appointments);
  const businessGroups = Object.values(groupedBusinesses);

  if (!businessGroups.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h2>No appointment cards found</h2>
        <p>Try a broader search like “massage today”, “swedish massage”, or “deep tissue massage”.</p>
      </div>
    `;

    container.appendChild(grid);
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
            ? `<img src="${escapeAttribute(logoUrl)}" alt="${escapeAttribute(
                logoAlt
              )}">`
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
                ? `<a class="claim-business-link" href="${escapeAttribute(
                    claimBusinessUrl
                  )}">Claim this business</a>`
                : ""
            }
          </div>

          <div class="business-meta">
            ${
              distance
                ? `<span class="distance-pill">${escapeHtml(distance)}</span>`
                : ""
            }

            ${
              firstAppointment.platform
                ? `<span class="platform-pill">${escapeHtml(
                    firstAppointment.platform
                  )}</span>`
                : ""
            }
          </div>
        </div>

        <p class="business-service">
          ${escapeHtml(getServiceSummary(group.appointments))}
          ${
            firstAppointment.price
              ? ` · ${escapeHtml(firstAppointment.price)}`
              : ""
          }
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
                    sourcePage: "ai-search"
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

    grid.appendChild(card);
  });

  container.appendChild(grid);
}

function renderDebug(container, data) {
  const showDebug =
    new URLSearchParams(window.location.search).get("debug") === "true";

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
    content: message,
    createdAt: new Date().toISOString()
  });

  requestAnimationFrame(() => {
    item.scrollIntoView({
      behavior: "smooth",
      block: "end"
    });
  });

  return item;
}

function addAssistantResultMessage(answer, appointments = [], data = {}) {
  const item = document.createElement("div");
  item.className = "chat-message assistant";

  const answerText = document.createElement("div");
  answerText.className = "chat-answer-text";
  answerText.textContent =
    answer || "Here are live appointment times that match your search.";

  item.appendChild(answerText);

  const resultsWrap = document.createElement("div");
  resultsWrap.className = "inline-results";

  renderResultsSummary(resultsWrap, appointments);
  renderBusinessCards(resultsWrap, appointments);
  renderDebug(resultsWrap, data);

  item.appendChild(resultsWrap);

  const feedbackBox = document.createElement("div");
  feedbackBox.className = "chat-feedback-box";
  feedbackBox.innerHTML = `
    <button type="button" class="chat-feedback-btn" data-chat-rating="good">
      👍 Good result
    </button>

    <button type="button" class="chat-feedback-btn" data-chat-rating="bad">
      👎 Bad result
    </button>

    <div class="chat-feedback-form" style="display:none;">
      <textarea
        class="chat-feedback-text"
        placeholder="Tell us what was helpful or wrong..."
      ></textarea>

      <button type="button" class="chat-feedback-submit">
        Submit feedback
      </button>
    </div>
  `;

  item.appendChild(feedbackBox);
  chatThread.appendChild(item);

  conversationState.messages.push({
    role: "assistant",
    content: answerText.textContent,
    createdAt: new Date().toISOString()
  });

  requestAnimationFrame(() => {
    item.scrollIntoView({
      behavior: "smooth",
      block: "end"
    });
  });

  return item;
}

function addLoadingMessage(query) {
  const item = document.createElement("div");
  item.className = "chat-message assistant";
  item.innerHTML = `
    <div class="chat-answer-text">Checking NextAppt data and live appointments...</div>
    <div class="inline-results">
      <div class="empty-state">
        <h2>Searching...</h2>
        <p>Checking cached results and live appointment data for “${escapeHtml(query)}”.</p>
      </div>
    </div>
  `;

  chatThread.appendChild(item);

  requestAnimationFrame(() => {
    item.scrollIntoView({
      behavior: "smooth",
      block: "end"
    });
  });

  return item;
}

function removeMessage(item) {
  if (item && item.parentNode) {
    item.parentNode.removeChild(item);
  }
}

function setSearchingState() {
  searchBtn.disabled = true;
  searchBtn.textContent = "Searching...";
}

function clearSearchingState() {
  searchBtn.disabled = false;
  searchBtn.textContent = "Ask AI";
}

function updateConversationState(data, query, appointments) {
  conversationState.lastQuery = query;
  conversationState.lastResolvedQuery = data.resolvedQuery || query;
  conversationState.lastIntent = data.matchedIntent || null;
  conversationState.lastSearchParams = data.searchParamsUsed || {};
  conversationState.lastAppointments = appointments;

  if (data.conversationState && typeof data.conversationState === "object") {
    conversationState.lastQuery =
      data.conversationState.lastQuery || conversationState.lastQuery;

    conversationState.lastResolvedQuery =
      data.conversationState.lastResolvedQuery ||
      conversationState.lastResolvedQuery;

    conversationState.lastIntent =
      data.conversationState.lastIntent || conversationState.lastIntent;

    conversationState.lastSearchParams =
      data.conversationState.lastSearchParams ||
      conversationState.lastSearchParams;
  }
}

function getPayloadConversationState() {
  return {
    messages: conversationState.messages.slice(-12),
    lastQuery: conversationState.lastQuery,
    lastResolvedQuery: conversationState.lastResolvedQuery,
    lastIntent: conversationState.lastIntent,
    lastSearchParams: conversationState.lastSearchParams
  };
}

async function runAiSearch(promptOverride = "") {
  const query = String(promptOverride || queryInput.value || "").trim();

  if (!query) {
    addChatMessage("assistant", "Enter a search first.");
    return;
  }

  addChatMessage("user", query);

  queryInput.value = "";
  autoResizeTextarea();
  setSearchingState();

  const loadingMessage = addLoadingMessage(query);

  try {
    const response = await fetch("/api/ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        conversationState: getPayloadConversationState()
      })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "AI search failed");
    }

    const appointments = Array.isArray(data.appointments)
      ? data.appointments
      : [];

    const answer =
      data.answer ||
      "Here are live appointment times that match your search.";

    updateConversationState(data, query, appointments);
    removeMessage(loadingMessage);
    addAssistantResultMessage(answer, appointments, data);
  } catch (error) {
    removeMessage(loadingMessage);
    addChatMessage("assistant", error.message || "Load failed.");
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

  const lastUserMessage = [...conversationState.messages]
    .reverse()
    .find((msg) => msg.role === "user");

  const lastAssistantMessage = [...conversationState.messages]
    .reverse()
    .find((msg) => msg.role === "assistant");

  submitButton.disabled = true;
  submitButton.textContent = "Saving...";

  try {
    const response = await fetch("/api/chatbot-feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        aiVersion: "v1",
        rating,
        feedbackText,
        prompt: lastUserMessage?.content || "",
        normalizedPrompt: String(lastUserMessage?.content || "").toLowerCase(),
        assistantAnswer: lastAssistantMessage?.content || "",
        page: window.location.pathname
      })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Feedback failed");
    }

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
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      keepalive: true
    });
  } catch (error) {
    console.warn("Appointment click tracking failed:", error);
  }
});

addChatMessage(
  "system",
  "Ask for an appointment, then refine it with follow-ups like “tomorrow after 4”, “only 60 minute”, or “which one is best for athletes?”"
);