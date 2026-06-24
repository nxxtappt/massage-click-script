const queryInput = document.getElementById("query");
const searchBtn = document.getElementById("searchBtn");
const answerBox = document.getElementById("answer");
const debugBox = document.getElementById("debug");

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function groupByBusiness(appointments = []) {
  const groups = {};

  appointments.forEach((appt) => {
    const name = appt.businessName || "Unknown Business";

    if (!groups[name]) {
      groups[name] = [];
    }

    groups[name].push(appt);
  });

  return groups;
}

function renderAppointmentCards(appointments = []) {
  if (!appointments.length) {
    debugBox.innerHTML = `
      <div class="box">
        No live appointment times found yet. Try a broader search like
        “neck pain massage today” or “deep tissue massage”.
      </div>
    `;
    return;
  }

  const groups = groupByBusiness(appointments);

  debugBox.innerHTML = Object.entries(groups)
    .map(([businessName, appts]) => {
      const first = appts[0];

      return `
        <div class="box">
          <h3>${escapeHtml(businessName)}</h3>
          <p>${escapeHtml(first.address || "Address not listed")}</p>
          <p>${escapeHtml(first.serviceName || "Available appointment")}</p>

          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;">
            ${appts
              .slice(0, 4)
              .map((appt) => {
                const label = `${appt.date || ""} ${appt.time || ""}`.trim() || "Time available";

                return `
                  <a
                    href="${escapeHtml(appt.bookingUrl || "#")}"
                    target="_blank"
                    rel="noopener noreferrer"
                    style="
                      display:inline-block;
                      padding:10px 14px;
                      border-radius:999px;
                      background:#0075b9;
                      color:white;
                      text-decoration:none;
                      font-weight:700;
                    "
                  >
                    ${escapeHtml(label)}
                  </a>
                `;
              })
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");
}

searchBtn.addEventListener("click", async () => {
  const query = queryInput.value.trim();

  if (!query) {
    answerBox.textContent = "Enter a search first.";
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = "Thinking...";
  answerBox.textContent = "Checking NextAppt data and live appointments...";
  debugBox.innerHTML = "";

  try {
    const response = await fetch("/api/ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "AI search failed");
    }

    answerBox.textContent =
      data.answer ||
      "I can’t give medical advice, but massage is commonly used by people seeking relief from muscle tension. Here are available appointment options based on your search.";

    renderAppointmentCards(data.appointments || []);
  } catch (error) {
    answerBox.textContent = error.message;
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "Ask AI";
  }
});