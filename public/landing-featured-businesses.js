(function initializeFeaturedBusinesses() {
  "use strict";

  const ROTATION_INTERVAL_MS = 10000;
  const FADE_DURATION_MS = 240;
  const MAX_APPOINTMENT_TIMES = 4;
  const DEFAULT_TIME_ZONE = "America/Chicago";

  const showcase = document.getElementById("featuredBusinessShowcase");
  const stage = document.getElementById("featuredBusinessStage");
  const previousButton = document.getElementById("featuredBusinessPrevious");
  const nextButton = document.getElementById("featuredBusinessNext");
  const position = document.getElementById("featuredBusinessPosition");

  if (!showcase || !stage) return;

  let businessGroups = [];
  let activeIndex = 0;
  let rotationTimer = null;
  let fadeTimer = null;
  let isPaused = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function isVerifiedBusiness(appointment = {}) {
    const status = String(
      appointment.verificationStatus || appointment.verification_status || ""
    )
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ");

    return (
      appointment.claimed === true ||
      status === "verified" ||
      status === "claimed verified"
    );
  }

  function getVerifiedRank(appointment = {}) {
    if (!isVerifiedBusiness(appointment)) return 0;

    const parsed = Number.parseInt(
      appointment.verifiedRank ?? appointment.verified_rank ?? 0,
      10
    );

    return Number.isFinite(parsed)
      ? Math.max(0, Math.min(100, parsed))
      : 0;
  }

  function compareAppointments(a = {}, b = {}) {
    const verifiedDifference =
      Number(isVerifiedBusiness(b)) - Number(isVerifiedBusiness(a));

    if (verifiedDifference !== 0) return verifiedDifference;

    const rankDifference = getVerifiedRank(b) - getVerifiedRank(a);
    if (rankDifference !== 0) return rankDifference;

    const scoreDifference =
      Number(b.ranking?.score || 0) - Number(a.ranking?.score || 0);
    if (scoreDifference !== 0) return scoreDifference;

    const aSortable = Number(a.localSortable || Number.MAX_SAFE_INTEGER);
    const bSortable = Number(b.localSortable || Number.MAX_SAFE_INTEGER);
    if (aSortable !== bSortable) return aSortable - bSortable;

    return String(a.businessName || "").localeCompare(
      String(b.businessName || "")
    );
  }

  function groupVerifiedBusinesses(appointments) {
    const groups = new Map();

    [...appointments]
      .filter(isVerifiedBusiness)
      .sort(compareAppointments)
      .forEach((appointment) => {
        const key = appointment.businessName || "Unknown Business";

        if (!groups.has(key)) {
          groups.set(key, {
            businessName: key,
            appointments: []
          });
        }

        groups.get(key).appointments.push(appointment);
      });

    return [...groups.values()];
  }

  function getInitials(name) {
    return String(name || "NA")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }

  function getBusinessUrl(appointment, businessName) {
    if (appointment.businessUrl) return appointment.businessUrl;
    if (appointment.businessSlug) return `/business/${appointment.businessSlug}`;

    const slug = String(businessName)
      .toLowerCase()
      .trim()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return `/business/${slug}`;
  }

  function getDateKey(appointment = {}) {
    if (appointment.localDateKey) return String(appointment.localDateKey);
    if (appointment.date || appointment.rawDate) {
      return String(appointment.date || appointment.rawDate);
    }

    if (appointment.startTime) {
      const parsed = new Date(appointment.startTime);
      if (!Number.isNaN(parsed.getTime())) {
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: DEFAULT_TIME_ZONE,
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).formatToParts(parsed);
        const values = Object.fromEntries(
          parts.map((part) => [part.type, part.value])
        );
        return `${values.year}-${values.month}-${values.day}`;
      }
    }

    return "upcoming";
  }

  function getTimeKey(appointment = {}) {
    if (appointment.localTimeKey) return String(appointment.localTimeKey);
    if (appointment.time || appointment.rawTime) {
      return String(appointment.time || appointment.rawTime).trim().toLowerCase();
    }
    return appointment.startTime || "time-available";
  }

  function formatDateTime(appointment = {}) {
    const dateKey = getDateKey(appointment);
    const isoMatch = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let dateLabel = dateKey === "upcoming" ? "Upcoming" : dateKey;

    if (isoMatch) {
      const parsedDate = new Date(`${dateKey}T12:00:00`);
      if (!Number.isNaN(parsedDate.getTime())) {
        dateLabel = parsedDate.toLocaleDateString("en-US", {
          timeZone: DEFAULT_TIME_ZONE,
          weekday: "short",
          month: "short",
          day: "numeric"
        });
      }
    }

    let timeLabel = appointment.time || appointment.rawTime || "";

    if ((!timeLabel || String(timeLabel).includes("T")) && appointment.startTime) {
      const parsedTime = new Date(appointment.startTime);
      if (!Number.isNaN(parsedTime.getTime())) {
        timeLabel = parsedTime.toLocaleTimeString("en-US", {
          timeZone: DEFAULT_TIME_ZONE,
          hour: "numeric",
          minute: "2-digit"
        });
      }
    }

    return `${dateLabel} · ${timeLabel || "Time available"}`;
  }

  function groupAppointmentsByTime(appointments) {
    const groups = new Map();

    [...appointments]
      .sort((a, b) => {
        const aSortable = Number(a.localSortable || Number.MAX_SAFE_INTEGER);
        const bSortable = Number(b.localSortable || Number.MAX_SAFE_INTEGER);
        return aSortable - bSortable || compareAppointments(a, b);
      })
      .forEach((appointment) => {
        const key = `${getDateKey(appointment)}|${getTimeKey(appointment)}`;

        if (!groups.has(key)) {
          if (groups.size >= MAX_APPOINTMENT_TIMES) return;
          groups.set(key, {
            appointment,
            services: new Map()
          });
        }

        const serviceName =
          appointment.serviceName || appointment.service || "Available appointment";
        const serviceKey = serviceName.trim().toLowerCase();
        groups.get(key).services.set(serviceKey, serviceName);
      });

    return [...groups.values()].map((group) => ({
      ...group,
      services: [...group.services.values()]
    }));
  }

  function getServiceSummary(appointments) {
    const services = [
      ...new Set(
        appointments
          .map((appointment) => appointment.serviceName)
          .filter(Boolean)
      )
    ];

    if (!services.length) return "Available appointments";
    if (services.length === 1) return services[0];
    return `${services[0]} + ${services.length - 1} more service${
      services.length === 2 ? "" : "s"
    }`;
  }

  function buildTrackingPayload(appointment, businessName, bookingUrl) {
    return {
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
      bookingUrl,
      sourcePage: "homepage-featured"
    };
  }

  function renderBusinessCard(group) {
    const first = group.appointments[0] || {};
    const businessName = first.businessName || group.businessName;
    const businessUrl = getBusinessUrl(first, businessName);
    const bookingUrl = first.bookingUrl || businessUrl;
    const logo = first.logoUrl
      ? `<img src="${escapeAttribute(first.logoUrl)}" alt="${escapeAttribute(
          first.logoAlt || `${businessName} logo`
        )}">`
      : escapeHtml(getInitials(businessName));
    const timeGroups = groupAppointmentsByTime(group.appointments);

    const timeMarkup = timeGroups
      .map((timeGroup, index) => {
        const appointment = timeGroup.appointment;
        const appointmentUrl = appointment.bookingUrl || bookingUrl;
        const panelId = `featured-services-${activeIndex}-${index}`;
        const count = timeGroup.services.length;
        const trackingPayload = JSON.stringify(
          buildTrackingPayload(appointment, businessName, appointmentUrl)
        );

        return `
          <article class="featured-time-slot">
            <div class="featured-time-row">
              <a
                class="featured-time-link"
                href="${escapeAttribute(appointmentUrl)}"
                target="_blank"
                rel="noopener noreferrer"
                data-track-appointment-click="true"
                data-appointment-payload="${escapeAttribute(trackingPayload)}"
              >${escapeHtml(formatDateTime(appointment))}</a>
              <button
                class="featured-services-toggle"
                type="button"
                aria-expanded="false"
                aria-controls="${escapeAttribute(panelId)}"
              >
                <span>${count} service${count === 1 ? "" : "s"}</span>
                <span class="featured-services-chevron" aria-hidden="true">⌄</span>
              </button>
            </div>
            <div class="featured-service-panel" id="${escapeAttribute(panelId)}" hidden>
              <ul class="featured-service-list">
                ${timeGroup.services
                  .map((service) => `<li>${escapeHtml(service)}</li>`)
                  .join("")}
              </ul>
            </div>
          </article>
        `;
      })
      .join("");

    stage.innerHTML = `
      <article class="featured-business-card">
        <div class="featured-business-card-header">
          <a class="featured-business-logo" href="${escapeAttribute(businessUrl)}" aria-label="View ${escapeAttribute(businessName)}">
            ${logo}
          </a>
          <div class="featured-business-details">
            <div class="featured-business-title-row">
              <h2 class="featured-business-title">
                <a href="${escapeAttribute(businessUrl)}">${escapeHtml(businessName)}</a>
              </h2>
              <span class="featured-verified-badge">Verified Business</span>
            </div>
            <p class="featured-business-address">${escapeHtml(
              first.address || "Austin, TX"
            )}</p>
            <p class="featured-business-service">${escapeHtml(
              getServiceSummary(group.appointments)
            )}${first.price ? ` · ${escapeHtml(first.price)}` : ""}</p>
          </div>
        </div>
        <div class="featured-time-groups">
          ${timeMarkup || '<p class="featured-business-empty">No current appointment times.</p>'}
        </div>
      </article>
    `;

    bindDropdowns();

    if (position) {
      position.textContent = `${activeIndex + 1} of ${businessGroups.length}`;
    }
  }

  function bindDropdowns() {
    const toggles = stage.querySelectorAll(".featured-services-toggle");

    toggles.forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const targetId = toggle.getAttribute("aria-controls");
        const panel = targetId ? document.getElementById(targetId) : null;
        if (!panel) return;

        const willOpen = toggle.getAttribute("aria-expanded") !== "true";

        toggles.forEach((otherToggle) => {
          const otherId = otherToggle.getAttribute("aria-controls");
          const otherPanel = otherId ? document.getElementById(otherId) : null;
          otherToggle.setAttribute("aria-expanded", "false");
          if (otherPanel) otherPanel.hidden = true;
          otherToggle.closest(".featured-time-slot")?.classList.remove("is-open");
        });

        toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
        panel.hidden = !willOpen;
        toggle.closest(".featured-time-slot")?.classList.toggle("is-open", willOpen);
      });
    });
  }

  function showBusiness(index, immediate) {
    if (!businessGroups.length) return;

    activeIndex = (index + businessGroups.length) % businessGroups.length;
    window.clearTimeout(fadeTimer);

    if (immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      stage.classList.remove("is-fading");
      renderBusinessCard(businessGroups[activeIndex]);
      return;
    }

    stage.classList.add("is-fading");
    fadeTimer = window.setTimeout(() => {
      renderBusinessCard(businessGroups[activeIndex]);
      requestAnimationFrame(() => stage.classList.remove("is-fading"));
    }, FADE_DURATION_MS);
  }

  function restartRotation() {
    window.clearInterval(rotationTimer);

    if (businessGroups.length <= 1 || isPaused) return;

    rotationTimer = window.setInterval(() => {
      showBusiness(activeIndex + 1, false);
    }, ROTATION_INTERVAL_MS);
  }

  function moveBusiness(direction) {
    showBusiness(activeIndex + direction, false);
    restartRotation();
  }

  function setPaused(paused) {
    isPaused = paused;
    restartRotation();
  }

  async function loadFeaturedBusinesses() {
    try {
      const response = await fetch(
        "/api/appointments?metro=austin&limitPerBusiness=50&includeInferred=true",
        { headers: { Accept: "application/json" } }
      );
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Featured businesses could not be loaded.");
      }

      businessGroups = groupVerifiedBusinesses(
        Array.isArray(data.appointments) ? data.appointments : []
      );

      if (!businessGroups.length) {
        stage.innerHTML = `
          <div class="featured-business-empty">
            <span>Verified businesses will appear here when fresh appointments are available.</span>
          </div>
        `;
        if (position) position.textContent = "";
        return;
      }

      showBusiness(0, true);
      restartRotation();
    } catch (error) {
      console.error("Failed to load featured verified businesses:", error);
      stage.innerHTML = `
        <div class="featured-business-empty">
          <span>Live featured appointments are temporarily unavailable. <a href="/austin">Search all Austin appointments</a>.</span>
        </div>
      `;
      if (position) position.textContent = "";
    }
  }

  previousButton?.addEventListener("click", () => moveBusiness(-1));
  nextButton?.addEventListener("click", () => moveBusiness(1));
  showcase.addEventListener("mouseenter", () => setPaused(true));
  showcase.addEventListener("mouseleave", () => setPaused(false));
  showcase.addEventListener("focusin", () => setPaused(true));
  showcase.addEventListener("focusout", (event) => {
    if (!showcase.contains(event.relatedTarget)) setPaused(false);
  });
  document.addEventListener("visibilitychange", () => {
    setPaused(document.hidden);
  });
  document.addEventListener("click", async (event) => {
    const link = event.target.closest("[data-track-appointment-click='true']");
    if (!link || !showcase.contains(link)) return;

    try {
      const payload = JSON.parse(link.dataset.appointmentPayload || "{}");
      await fetch("/api/analytics/appointment-click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      });
    } catch (error) {
      console.warn("Featured appointment click tracking failed:", error);
    }
  });

  loadFeaturedBusinesses();
})();
