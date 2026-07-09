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

function getSlugFromPath() {
  return window.location.pathname.split("/").filter(Boolean).pop();
}

function getInitials(name = "") {
  return String(name || "B")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function formatAppointmentButton(appointment = {}) {
  if (appointment.date && appointment.time) {
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

  return appointment.time || "Time available";
}

function groupAppointmentsByDate(appointments = []) {
  return appointments.reduce((groups, appointment) => {
    const key = appointment.localDateKey || appointment.date || "Upcoming";

    if (!groups[key]) groups[key] = [];
    groups[key].push(appointment);

    return groups;
  }, {});
}

function renderLogo(page, muted = false) {
  return `
    <div class="logo-circle ${muted ? "muted" : ""}">
      ${
        page.logoUrl && !muted
          ? `<img src="${escapeAttribute(page.logoUrl)}" alt="${escapeAttribute(page.logoAlt || page.businessName)}">`
          : escapeHtml(getInitials(page.businessName))
      }
    </div>
  `;
}

function renderDeal(deal) {
  if (!deal || deal.enabled === false || !deal.title) return "";

  return `
    <section class="deal-card">
      <p class="section-label">Current Deal</p>
      <h2>${escapeHtml(deal.title || "Special Offer")}</h2>
      <p>${escapeHtml(deal.body || "")}</p>
      ${
        deal.promoCode
          ? `<div class="promo-code">Promo Code: <strong>${escapeHtml(deal.promoCode)}</strong></div>`
          : ""
      }
    </section>
  `;
}

function renderPills(items = [], emptyText = "None listed yet.") {
  if (!Array.isArray(items) || !items.length) {
    return `<p>${escapeHtml(emptyText)}</p>`;
  }

  return `
    <div class="pill-list">
      ${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
}

function renderVerifiedPage(page) {
  const profile = page.publicProfile || {};

  return `
    <section class="business-hero verified">
      ${renderLogo(page)}

      <div>
        <div class="title-row">
          <h1>${escapeHtml(page.businessName)}</h1>
          <span class="verified-badge">Verified Business</span>
        </div>

        <p class="address">${escapeHtml(page.address || "Address not listed")}</p>

        ${
          profile.shortDescription
            ? `<p class="short-description">${escapeHtml(profile.shortDescription)}</p>`
            : `<p class="short-description">Verified business profile on NextAppt.</p>`
        }
      </div>
    </section>

    ${renderDeal(page.activeDeal)}

    <section class="content-grid">
      <article class="info-card about-card">
        <p class="section-label">About</p>
        <p>${escapeHtml(profile.bio || "This verified business has not added a full bio yet.")}</p>
      </article>

      <article class="info-card">
        <p class="section-label">Specialties</p>
        ${renderPills(profile.specialties, "No specialties listed yet.")}
      </article>

      <article class="info-card">
        <p class="section-label">Amenities</p>
        ${renderPills(profile.amenities, "No amenities listed yet.")}
      </article>
    </section>

    <section class="inventory-card">
      <div class="inventory-header">
        <div>
          <p class="section-label">Appointment Inventory</p>
          <h2>Available appointment times</h2>
        </div>
      </div>

      <div id="businessInventory" class="inventory-placeholder">
        <p>Loading appointment inventory...</p>
      </div>
    </section>
  `;
}

function renderUnverifiedPage(page) {
  return `
    <section class="business-hero unverified">
      ${renderLogo(page, true)}

      <div>
        <div class="title-row">
          <h1>${escapeHtml(page.businessName)}</h1>
          <span class="unverified-badge">Unverified</span>
        </div>

        <p class="address">${escapeHtml(page.address || "Address not listed")}</p>

        <p class="short-description">
          ${escapeHtml(page.unverifiedMessage || "This business has not claimed its NextAppt profile yet.")}
        </p>

        <a class="claim-button" href="/business?businessName=${encodeURIComponent(page.businessName)}">
          Claim this business
        </a>
      </div>
    </section>

    <section class="locked-card">
      <h2>Limited public profile</h2>
      <p>
        This page is intentionally limited until the business verifies ownership.
        Verified businesses can add a bio, logo, deals, specialties, amenities,
        and richer appointment inventory.
      </p>
    </section>

    <section class="inventory-card muted">
      <p class="section-label">Appointment Preview</p>
      <h2>Limited appointment display</h2>

      <div id="businessInventory" class="inventory-placeholder">
        <p>Loading limited appointment preview...</p>
      </div>
    </section>
  `;
}

async function loadBusinessInventory(page) {
  const inventory = document.getElementById("businessInventory");

  if (!inventory || !page?.businessName) return;

  try {
    const params = new URLSearchParams();
    params.set("business", page.businessName);
    params.set("limitPerBusiness", page.isVerified ? "999" : "4");
    params.set("fresh", String(Date.now()));

    const response = await fetch(`/api/search?${params.toString()}`);
    const data = await response.json();

    const appointments = (Array.isArray(data.appointments)
      ? data.appointments
      : []).filter((appointment) => {
        if (appointment.businessEnabled === false || appointment.enabled === false) return false;

        const status = String(
          appointment.inventoryStatus || appointment.status || ""
        ).toLowerCase();

        return !["inactive", "expired", "archived", "deleted", "disabled"].includes(status);
      });

    if (!appointments.length) {
      inventory.innerHTML = `<p>No appointment inventory found for this business yet.</p>`;
      return;
    }

    const visibleAppointments = page.isVerified
      ? appointments
      : appointments.slice(0, 4);

    const grouped = groupAppointmentsByDate(visibleAppointments);

    inventory.innerHTML = Object.entries(grouped)
      .slice(0, page.isVerified ? 14 : 1)
      .map(([dateKey, items]) => {
        return `
          <div class="inventory-day">
            <h3>${escapeHtml(dateKey)}</h3>

            <div class="appointment-button-grid">
              ${items
                .slice(0, page.isVerified ? 24 : 4)
                .map((appointment) => {
                  const sourceType =
                    appointment.sourceType ||
                    appointment.inventorySource ||
                    appointment.sourceStatus ||
                    "";

                  const isInferred = String(sourceType).toLowerCase() === "inferred";

                  return `
                    <a
                      class="appointment-button ${isInferred ? "inferred" : "confirmed"}"
                      href="${escapeAttribute(appointment.bookingUrl || "#")}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span>${escapeHtml(formatAppointmentButton(appointment))}</span>
                      <small>${escapeHtml(isInferred ? "Inferred" : "Confirmed")}</small>
                    </a>
                  `;
                })
                .join("")}
            </div>
          </div>
        `;
      })
      .join("");
  } catch (error) {
    inventory.innerHTML = `<p>Could not load appointment inventory.</p>`;
  }
}

async function loadBusinessPage() {
  const root = document.getElementById("businessPage");
  const slug = getSlugFromPath();

  try {
    const response = await fetch(`/api/business-pages/${slug}`);
    const data = await response.json();

    if (!data.success) {
      root.innerHTML = `
        <section class="error-card">
          <h1>Business not found</h1>
          <p>${escapeHtml(data.error || "Could not load this business page.")}</p>
        </section>
      `;
      return;
    }

    const page = data.businessPage;
    page.isVerified =
      page.isVerified === true ||
      page.claimed === true ||
      page.verificationStatus === "verified" ||
      page.verificationStatus === "claimed_verified";

    document.title = `${page.businessName} | NextAppt`;

    root.innerHTML = page.isVerified
      ? renderVerifiedPage(page)
      : renderUnverifiedPage(page);

    await loadBusinessInventory(page);
  } catch (error) {
    root.innerHTML = `
      <section class="error-card">
        <h1>Something went wrong</h1>
        <p>${escapeHtml(error.message)}</p>
      </section>
    `;
  }
}

loadBusinessPage();