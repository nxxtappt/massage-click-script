(() => {
  const script = document.currentScript;

  if (!script) return;

  const businessSlug = String(script.dataset.business || "").trim();
  const limitTimes = Math.max(1, Math.min(Number(script.dataset.limitTimes || 8), 30));
  const apiOrigin = new URL(script.src, window.location.href).origin;
  const host = document.createElement("div");

  host.className = "nextappt-widget-host";
  script.insertAdjacentElement("beforebegin", host);

  const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  const styles = `
    :host {
      display: block;
      width: 100%;
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #14263a;
    }

    * {
      box-sizing: border-box;
    }

    .widget {
      width: 100%;
      max-width: 420px;
      background: #ffffff;
      border: 1px solid rgba(18, 48, 73, 0.12);
      border-radius: 11px;
      box-shadow: 0 4px 14px rgba(10, 38, 59, 0.055);
      padding: 11px 12px 9px;
    }

    .title {
      margin: 0 0 10px;
      font-size: 12px;
      line-height: 1.2;
      letter-spacing: 0.055em;
      font-weight: 800;
      color: #0b3552;
    }

    .date-section + .date-section {
      margin-top: 13px;
    }

    .date-label {
      margin: 0 0 5px;
      font-size: 9px;
      line-height: 1.2;
      letter-spacing: 0.075em;
      font-weight: 800;
      color: #718493;
    }

    .slots {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .slot-card {
      overflow: hidden;
      border: 1px solid rgba(0, 95, 149, 0.17);
      border-radius: 8px;
      background: #fbfdff;
    }

    .slot-row {
      display: flex;
      min-height: 39px;
      align-items: stretch;
    }

    .time-link {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      align-items: center;
      padding: 8px 10px;
      color: #003f66;
      text-decoration: none;
      font-size: 14px;
      line-height: 1;
      font-weight: 800;
      transition: background 120ms ease, color 120ms ease;
    }

    .time-link:hover,
    .time-link:focus-visible {
      background: #f2f8fc;
      color: #005f95;
      outline: none;
    }

    .services-toggle {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 5px;
      margin: 0;
      padding: 7px 9px;
      border: 0;
      border-left: 1px solid rgba(0, 95, 149, 0.12);
      background: transparent;
      color: #61798b;
      cursor: pointer;
      font: inherit;
      font-size: 10.5px;
      line-height: 1.1;
      font-weight: 700;
      white-space: nowrap;
      transition: background 120ms ease, color 120ms ease;
    }

    .services-toggle:hover,
    .services-toggle:focus-visible {
      background: #f2f8fc;
      color: #005f95;
      outline: none;
    }

    .chevron {
      display: inline-block;
      font-size: 10px;
      line-height: 1;
      transition: transform 140ms ease;
    }

    .services-toggle[aria-expanded="true"] .chevron {
      transform: rotate(180deg);
    }

    .service-panel {
      border-top: 1px solid rgba(0, 95, 149, 0.11);
      background: #ffffff;
    }

    .service-panel[hidden] {
      display: none;
    }

    .service-list {
      max-height: 146px;
      margin: 0;
      padding: 6px 10px 7px 25px;
      overflow-y: auto;
      color: #506979;
      font-size: 10.5px;
      line-height: 1.35;
    }

    .service-list li {
      padding: 2px 0;
    }

    .powered {
      margin: 8px 1px 0;
      text-align: right;
      font-size: 9px;
      line-height: 1.2;
      color: #8797a2;
    }

    .powered a {
      color: #005f95;
      text-decoration: none;
      font-weight: 700;
    }

    .powered a:hover,
    .powered a:focus-visible {
      text-decoration: underline;
    }

    .state {
      margin: 0;
      padding: 9px 2px 4px;
      color: #60788a;
      font-size: 11px;
      line-height: 1.4;
    }

    @media (max-width: 360px) {
      .widget {
        padding: 9px 9px 8px;
        border-radius: 9px;
      }

      .time-link {
        padding-left: 8px;
        font-size: 13px;
      }

      .services-toggle {
        padding-left: 7px;
        padding-right: 7px;
        font-size: 10px;
      }
    }
  `;
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeExternalUrl(value) {
    if (!String(value || "").trim()) return "#";

    try {
      const url = new URL(String(value || ""), apiOrigin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
    } catch {
      return "#";
    }
  }

  function renderFrame(bodyHtml) {
    root.innerHTML = `
      <style>${styles}</style>
      <section class="widget" aria-label="Next available appointments">
        ${bodyHtml}
      </section>
    `;
  }

  function renderLoading() {
    renderFrame(`
      <h2 class="title">NEXT AVAILABLE APPOINTMENTS</h2>
      <p class="state">Loading availability…</p>
    `);
  }

  function renderError(message) {
    renderFrame(`
      <h2 class="title">NEXT AVAILABLE APPOINTMENTS</h2>
      <p class="state">${escapeHtml(message || "Availability is temporarily unavailable.")}</p>
      <p class="powered">
        <a href="https://nextappt.ai/" target="_blank" rel="noopener noreferrer">Powered by NextAppt.ai</a>
      </p>
    `);
  }

  function renderWidget(payload) {
    const dateGroups = Array.isArray(payload.dateGroups) ? payload.dateGroups : [];
    const poweredUrl = safeExternalUrl(payload.poweredBy?.url || "https://nextappt.ai/");
    let slotIndex = 0;

    const groupsHtml = dateGroups
      .map((group) => {
        const times = Array.isArray(group.times) ? group.times : [];

        const timesHtml = times
          .map((slot) => {
            const currentIndex = slotIndex++;
            const count = Number(slot.serviceCount || 0);
            const serviceLabel = `${count} service${count === 1 ? "" : "s"}`;
            const services = Array.isArray(slot.services)
              ? slot.services.filter((service) => service && service.name)
              : [];
            const serviceNames = services.map((service) => service.name).join(", ");
            const bookingUrl = safeExternalUrl(slot.bookingUrl || payload.bookingUrl || "");
            const panelId = `nextappt-services-${currentIndex}`;

            const serviceItems = services.length
              ? services
                  .map(
                    (service) =>
                      `<li>${escapeHtml(service.name)}</li>`
                  )
                  .join("")
              : `<li>Service details unavailable</li>`;

            return `
              <article class="slot-card">
                <div class="slot-row">
                  <a
                    class="time-link"
                    href="${escapeHtml(bookingUrl)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="${escapeHtml(`Book ${slot.timeLabel}${serviceNames ? `. Available services: ${serviceNames}` : ""}`)}"
                    title="Book at ${escapeHtml(slot.timeLabel || "this time")}" 
                  >
                    ${escapeHtml(slot.timeLabel || "Time available")}
                  </a>
                  <button
                    class="services-toggle"
                    type="button"
                    aria-expanded="false"
                    aria-controls="${escapeHtml(panelId)}"
                  >
                    <span>${escapeHtml(serviceLabel)}</span>
                    <span class="chevron" aria-hidden="true">⌄</span>
                  </button>
                </div>
                <div class="service-panel" id="${escapeHtml(panelId)}" hidden>
                  <ul class="service-list">${serviceItems}</ul>
                </div>
              </article>
            `;
          })
          .join("");

        return `
          <section class="date-section">
            <h3 class="date-label">${escapeHtml(group.dateLabel || "UPCOMING")}</h3>
            <div class="slots">${timesHtml}</div>
          </section>
        `;
      })
      .join("");

    const emptyHtml = dateGroups.length
      ? groupsHtml
      : `<p class="state">No upcoming appointment times are currently listed.</p>`;

    renderFrame(`
      <h2 class="title">${escapeHtml(payload.title || "NEXT AVAILABLE APPOINTMENTS")}</h2>
      ${emptyHtml}
      <p class="powered">
        <a href="${escapeHtml(poweredUrl)}" target="_blank" rel="noopener noreferrer">Powered by NextAppt.ai</a>
      </p>
    `);

    bindServiceToggles();
  }

  function bindServiceToggles() {
    const toggles = root.querySelectorAll?.(".services-toggle") || [];

    toggles.forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const targetId = toggle.getAttribute("aria-controls");
        const panel = targetId ? root.getElementById?.(targetId) : null;

        if (!panel) return;

        const willOpen = toggle.getAttribute("aria-expanded") !== "true";

        toggles.forEach((otherToggle) => {
          const otherId = otherToggle.getAttribute("aria-controls");
          const otherPanel = otherId ? root.getElementById?.(otherId) : null;

          otherToggle.setAttribute("aria-expanded", "false");
          if (otherPanel) otherPanel.hidden = true;
        });

        toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
        panel.hidden = !willOpen;
      });
    });
  }

  async function loadWidget() {
    if (!businessSlug) {
      renderError("Widget setup is missing a business identifier.");
      return;
    }

    renderLoading();

    try {
      const endpoint = `${apiOrigin}/api/widget/${encodeURIComponent(
        businessSlug
      )}?limitTimes=${encodeURIComponent(limitTimes)}`;

      const isSameOrigin = apiOrigin === window.location.origin;

      const response = await fetch(endpoint, {
        method: "GET",
        mode: isSameOrigin ? "same-origin" : "cors",
        credentials: isSameOrigin ? "same-origin" : "omit",
        headers: {
          Accept: "application/json"
        }
      });

      const contentType = response.headers?.get?.("content-type") || "";
      const data = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : null;

      if (!response.ok || !data?.success || !data.widget) {
        throw new Error(
          data?.error ||
            `Widget API returned ${response.status || "an unexpected response"}.`
        );
      }

      renderWidget(data.widget);
    } catch (error) {
      console.error("[NextAppt Widget]", error);
      renderError("Availability is temporarily unavailable.");
    }
  }

  loadWidget();
})();