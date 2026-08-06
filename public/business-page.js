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

function formatAppointmentService(appointment = {}) {
  const serviceName = String(
    appointment.serviceName ||
      appointment.service ||
      appointment.serviceCategory ||
      "Appointment"
  ).trim();
  const durationMinutes = Number(appointment.durationMinutes);

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return serviceName;
  }

  const durationAlreadyShown = new RegExp(
    `(^|\\D)${durationMinutes}(\\D|$)`
  ).test(serviceName);

  return durationAlreadyShown
    ? serviceName
    : `${serviceName} - ${durationMinutes} min`;
}

function groupAppointmentsByDate(appointments = []) {
  return appointments.reduce((groups, appointment) => {
    const key = appointment.localDateKey || appointment.date || "Upcoming";

    if (!groups[key]) groups[key] = [];
    groups[key].push(appointment);

    return groups;
  }, {});
}

function normalizeMarketplaceCategorySlug(
  value = ""
) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function titleCaseCategorySlug(
  value = ""
) {
  return normalizeMarketplaceCategorySlug(
    value
  )
    .split("-")
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ");
}

function getServiceCategoryGroups(
  page = {}
) {
  const apiGroups =
    Array.isArray(
      page.servicesByCategory
    )
      ? page.servicesByCategory
          .filter(
            (group) =>
              group &&
              Array.isArray(
                group.services
              ) &&
              group.services.length
          )
      : [];

  if (apiGroups.length) {
    return apiGroups;
  }

  const categoryMetadata =
    new Map(
      (Array.isArray(page.categories)
        ? page.categories
        : []
      ).map((category) => [
        normalizeMarketplaceCategorySlug(
          category.slug
        ),
        category
      ])
    );

  const groups = new Map();

  for (
    const service
    of Array.isArray(page.services)
      ? page.services
      : []
  ) {
    const slug =
      normalizeMarketplaceCategorySlug(
        service.categorySlug ||
        service.marketplaceCategory ||
        service.category?.slug ||
        ""
      ) || "massage";

    const metadata =
      categoryMetadata.get(slug) ||
      {};

    if (!groups.has(slug)) {
      groups.set(slug, {
        slug,
        displayName:
          metadata.displayName ||
          titleCaseCategorySlug(slug),
        description:
          metadata.description || "",
        sortOrder:
          Number(
            metadata.sortOrder || 100
          ),
        services: []
      });
    }

    groups.get(slug)
      .services.push(service);
  }

  return [...groups.values()]
    .sort((left, right) => {
      if (
        left.sortOrder !==
        right.sortOrder
      ) {
        return (
          left.sortOrder -
          right.sortOrder
        );
      }

      return String(
        left.displayName
      ).localeCompare(
        String(
          right.displayName
        )
      );
    });
}

function formatServiceDetails(
  service = {}
) {
  const details = [];

  const duration =
    Number(
      service.durationMinutes
    );

  if (
    Number.isFinite(duration) &&
    duration > 0
  ) {
    details.push(
      `${duration} min`
    );
  }

  const serviceType =
    String(
      service.serviceType || ""
    )
      .trim()
      .replace(/[_-]+/g, " ");

  const serviceName =
    String(
      service.serviceName || ""
    ).trim();

  if (
    serviceType &&
    serviceType.toLowerCase() !==
      serviceName.toLowerCase()
  ) {
    details.push(serviceType);
  }

  const rawPrice =
    service.price ??
    service.servicePrice ??
    null;

  if (
    rawPrice !== null &&
    rawPrice !== undefined &&
    rawPrice !== ""
  ) {
    const numericPrice =
      Number(rawPrice);

    details.push(
      Number.isFinite(numericPrice)
        ? `$${numericPrice.toFixed(
            Number.isInteger(
              numericPrice
            )
              ? 0
              : 2
          )}`
        : String(rawPrice)
    );
  }

  return details.join(" • ");
}

function renderServiceCatalog(
  page = {}
) {
  if (page.isVerified !== true) {
    return "";
  }

  const groups =
    getServiceCategoryGroups(page);

  if (!groups.length) {
    return "";
  }

  const categoryLinks =
    groups.length > 1
      ? `
        <nav
          class="business-category-links"
          aria-label="Services by category"
        >
          ${groups
            .map(
              (group) => `
                <a href="#business-category-${escapeAttribute(
                  group.slug
                )}">
                  ${escapeHtml(
                    group.displayName
                  )}
                  <span>${group.services.length}</span>
                </a>
              `
            )
            .join("")}
        </nav>
      `
      : "";

  return `
    <section class="service-catalog-card">
      <div class="service-catalog-header">
        <div>
          <p class="section-label">
            Services
          </p>
          <h2>
            Services by category
          </h2>
        </div>

        <span class="service-category-total">
          ${groups.length}
          ${groups.length === 1
            ? "category"
            : "categories"}
        </span>
      </div>

      ${categoryLinks}

      <div class="business-category-list">
        ${groups
          .map((group) => {
            const services =
              Array.isArray(
                group.services
              )
                ? group.services
                : [];

            return `
              <section
                id="business-category-${escapeAttribute(
                  group.slug
                )}"
                class="business-category-section"
                data-category-slug="${escapeAttribute(
                  group.slug
                )}"
              >
                <div class="business-category-header">
                  <div>
                    <h3>
                      ${escapeHtml(
                        group.displayName
                      )}
                    </h3>

                    ${
                      group.description
                        ? `
                          <p>
                            ${escapeHtml(
                              group.description
                            )}
                          </p>
                        `
                        : ""
                    }
                  </div>

                  <span>
                    ${services.length}
                    ${services.length === 1
                      ? "service"
                      : "services"}
                  </span>
                </div>

                <div class="business-service-list">
                  ${services
                    .map((service) => {
                      const serviceName =
                        service.serviceName ||
                        service.name ||
                        "Service";

                      const details =
                        formatServiceDetails(
                          service
                        );

                      const bookingUrl =
                        service.bookingUrl ||
                        page.bookingUrl ||
                        "";

                      const bookingLink =
                        bookingUrl &&
                        isSafePublicUrl(
                          bookingUrl,
                          [
                            "https:",
                            "http:"
                          ]
                        )
                          ? `
                            <a
                              class="business-service-book-link"
                              href="${escapeAttribute(
                                bookingUrl
                              )}"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Book
                            </a>
                          `
                          : "";

                      return `
                        <article class="business-service-row">
                          <div>
                            <h4>
                              ${escapeHtml(
                                serviceName
                              )}
                            </h4>

                            ${
                              details
                                ? `
                                  <p>
                                    ${escapeHtml(
                                      details
                                    )}
                                  </p>
                                `
                                : ""
                            }
                          </div>

                          ${bookingLink}
                        </article>
                      `;
                    })
                    .join("")}
                </div>
              </section>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function getAppointmentCategorySlug(
  appointment = {},
  page = {}
) {
  const pageGroups =
    getServiceCategoryGroups(page);

  const knownSlugs =
    new Set(
      pageGroups.map(
        (group) =>
          normalizeMarketplaceCategorySlug(
            group.slug
          )
      )
    );

  const directCandidates = [
    appointment.categorySlug,
    appointment.marketplaceCategory,
    appointment.category?.slug,
    appointment.businessCategory
  ];

  for (
    const candidate
    of directCandidates
  ) {
    const normalized =
      normalizeMarketplaceCategorySlug(
        candidate
      );

    if (
      normalized &&
      (
        knownSlugs.has(normalized) ||
        !knownSlugs.size
      )
    ) {
      return normalized;
    }
  }

  const serviceCategoryCandidate =
    normalizeMarketplaceCategorySlug(
      appointment.serviceCategory
    );

  if (
    serviceCategoryCandidate &&
    knownSlugs.has(
      serviceCategoryCandidate
    )
  ) {
    return serviceCategoryCandidate;
  }

  const appointmentServiceId =
    String(
      appointment.serviceId ||
      appointment.platformServiceId ||
      ""
    ).trim();

  const appointmentServiceName =
    String(
      appointment.serviceName ||
      appointment.service ||
      ""
    )
      .trim()
      .toLowerCase();

  const duration =
    Number(
      appointment.durationMinutes
    );

  for (const group of pageGroups) {
    const services =
      Array.isArray(group.services)
        ? group.services
        : [];

    const matches =
      services.some((service) => {
        const serviceId =
          String(
            service.serviceId ||
            service.platformServiceId ||
            ""
          ).trim();

        if (
          appointmentServiceId &&
          serviceId &&
          appointmentServiceId ===
            serviceId
        ) {
          return true;
        }

        const serviceName =
          String(
            service.serviceName ||
            service.name ||
            ""
          )
            .trim()
            .toLowerCase();

        if (
          !appointmentServiceName ||
          !serviceName ||
          appointmentServiceName !==
            serviceName
        ) {
          return false;
        }

        const serviceDuration =
          Number(
            service.durationMinutes
          );

        return (
          !Number.isFinite(duration) ||
          !Number.isFinite(
            serviceDuration
          ) ||
          duration === serviceDuration
        );
      });

    if (matches) {
      return normalizeMarketplaceCategorySlug(
        group.slug
      );
    }
  }

  if (pageGroups.length === 1) {
    return (
      normalizeMarketplaceCategorySlug(
        pageGroups[0].slug
      ) || "appointments"
    );
  }

  return "appointments";
}

function groupAppointmentsByCategory(
  appointments = [],
  page = {}
) {
  const serviceGroups =
    getServiceCategoryGroups(page);

  const metadata =
    new Map(
      serviceGroups.map(
        (group, index) => [
          normalizeMarketplaceCategorySlug(
            group.slug
          ),
          {
            slug:
              normalizeMarketplaceCategorySlug(
                group.slug
              ),
            displayName:
              group.displayName ||
              titleCaseCategorySlug(
                group.slug
              ),
            sortOrder:
              Number(
                group.sortOrder ??
                index
              )
          }
        ]
      )
    );

  const grouped = new Map();

  for (const appointment of appointments) {
    const slug =
      getAppointmentCategorySlug(
        appointment,
        page
      );

    const category =
      metadata.get(slug) ||
      {
        slug,
        displayName:
          slug === "appointments"
            ? "Other Appointments"
            : titleCaseCategorySlug(
                slug
              ),
        sortOrder: 1000
      };

    if (!grouped.has(slug)) {
      grouped.set(slug, {
        ...category,
        appointments: []
      });
    }

    grouped.get(slug)
      .appointments.push(
        appointment
      );
  }

  return [...grouped.values()]
    .sort((left, right) => {
      if (
        left.sortOrder !==
        right.sortOrder
      ) {
        return (
          left.sortOrder -
          right.sortOrder
        );
      }

      return String(
        left.displayName
      ).localeCompare(
        String(
          right.displayName
        )
      );
    });
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

function normalizeWidgetType(integration = {}) {
  const requested = String(
    integration.widgetType ||
      integration.type ||
      (integration.embedCode || integration.code || integration.html
        ? "html"
        : integration.iframeUrl || integration.widgetUrl
          ? "iframe"
          : "url")
  )
    .trim()
    .toLowerCase();

  return ["html", "iframe", "url"].includes(requested)
    ? requested
    : "url";
}

function renderBookingWidget(page) {
  const integration = page.bookingIntegration || {};

  if (integration.enabled !== true) return "";

  const widgetType = normalizeWidgetType(integration);
  const provider = String(integration.provider || page.platform || "booking")
    .trim()
    .replace(/[_-]+/g, " ");

  return `
    <section class="booking-widget-card">
      <div class="booking-widget-header">
        <div>
          <p class="section-label">Book Online</p>
          <h2>Schedule with ${escapeHtml(page.businessName)}</h2>
        </div>
        <span class="booking-provider-pill">${escapeHtml(provider)}</span>
      </div>

      <div
        id="businessBookingWidget"
        class="booking-widget-host"
        data-widget-type="${escapeAttribute(widgetType)}"
      >
        <p>Loading booking options...</p>
      </div>
    </section>
  `;
}

function isSafePublicUrl(value, allowedProtocols = ["https:"]) {
  try {
    const parsed = new URL(String(value || ""), window.location.origin);
    return allowedProtocols.includes(parsed.protocol);
  } catch {
    return false;
  }
}

function getProviderScriptSuffixes(provider = "") {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const suffixesByProvider = {
    mindbody: ["mindbodyonline.com", "healcode.com"],
    vagaro: ["vagaro.com"],
    zenoti: ["zenoti.com"],
    booker: ["booker.com"],
    meevo: ["meevo.com", "millenniumsi.com"],
    mangomint: ["mangomint.com"]
  };

  return suffixesByProvider[normalizedProvider] || [];
}

function hostnameMatchesSuffix(hostname, suffix) {
  const normalizedHostname = String(hostname || "").toLowerCase();
  const normalizedSuffix = String(suffix || "").toLowerCase();

  return (
    normalizedHostname === normalizedSuffix ||
    normalizedHostname.endsWith(`.${normalizedSuffix}`)
  );
}

function isAllowedWidgetScriptUrl(value, provider) {
  try {
    const parsed = new URL(String(value || ""), window.location.origin);

    if (parsed.protocol !== "https:") return false;
    if (parsed.origin === window.location.origin) return true;

    return getProviderScriptSuffixes(provider).some((suffix) =>
      hostnameMatchesSuffix(parsed.hostname, suffix)
    );
  } catch {
    return false;
  }
}

function sanitizeWidgetElement(element) {
  const blockedTags = new Set([
    "BASE",
    "EMBED",
    "IFRAME",
    "LINK",
    "META",
    "OBJECT",
    "STYLE",
    "SVG",
    "MATH"
  ]);

  if (blockedTags.has(element.tagName)) {
    element.remove();
    return;
  }

  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;

    if (name.startsWith("on") || name === "srcdoc") {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (["href", "src", "action", "formaction"].includes(name)) {
      const allowedProtocols = name === "href"
        ? ["https:", "http:", "mailto:", "tel:"]
        : ["https:", "http:"];

      if (!isSafePublicUrl(value, allowedProtocols)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  if (element.tagName === "A") {
    element.setAttribute("rel", "noopener noreferrer");

    if (element.getAttribute("target") === "_blank") {
      element.setAttribute("target", "_blank");
    }
  }
}

function buildSanitizedWidgetFragment(embedCode) {
  const template = document.createElement("template");
  template.innerHTML = String(embedCode || "");

  const scriptDescriptors = [...template.content.querySelectorAll("script")]
    .map((script) => ({
      src: script.getAttribute("src") || "",
      attributes: [...script.attributes]
        .filter((attribute) => attribute.name.toLowerCase() !== "src")
        .map((attribute) => ({
          name: attribute.name,
          value: attribute.value
        }))
    }));

  template.content.querySelectorAll("script").forEach((script) => script.remove());
  [...template.content.querySelectorAll("*")].forEach(sanitizeWidgetElement);

  return {
    fragment: template.content.cloneNode(true),
    scriptDescriptors
  };
}

function copyAllowedScriptAttributes(sourceAttributes, targetScript) {
  const allowedNames = new Set([
    "async",
    "crossorigin",
    "defer",
    "integrity",
    "nomodule",
    "referrerpolicy",
    "type"
  ]);

  for (const attribute of sourceAttributes) {
    const lowerName = String(attribute.name || "").toLowerCase();

    if (allowedNames.has(lowerName) || lowerName.startsWith("data-")) {
      targetScript.setAttribute(attribute.name, attribute.value);
    }
  }
}

function mountHtmlBookingWidget(container, integration) {
  const embedCode =
    integration.embedCode ||
    integration.code ||
    integration.html ||
    "";
  const provider = integration.provider || "";

  if (!embedCode) {
    throw new Error("Booking embed code is missing.");
  }

  const { fragment, scriptDescriptors } = buildSanitizedWidgetFragment(embedCode);
  container.replaceChildren(fragment);

  let loadedScriptCount = 0;

  for (const descriptor of scriptDescriptors) {
    if (!descriptor.src || !isAllowedWidgetScriptUrl(descriptor.src, provider)) {
      continue;
    }

    const script = document.createElement("script");
    script.src = new URL(descriptor.src, window.location.origin).href;
    copyAllowedScriptAttributes(descriptor.attributes, script);
    script.async = script.hasAttribute("async") ? script.async : true;
    script.dataset.nextapptBookingWidget = "true";
    container.appendChild(script);
    loadedScriptCount += 1;
  }

  if (!container.childNodes.length) {
    throw new Error("The saved booking embed did not contain displayable content.");
  }

  if (scriptDescriptors.length && loadedScriptCount === 0) {
    throw new Error(
      "The booking script host is not approved for the selected provider."
    );
  }
}

function mountIframeBookingWidget(container, integration) {
  const iframeUrl = integration.iframeUrl || integration.widgetUrl || "";

  if (!isSafePublicUrl(iframeUrl)) {
    throw new Error("The saved booking iframe URL is invalid.");
  }

  const iframe = document.createElement("iframe");
  iframe.src = iframeUrl;
  iframe.title = "Online booking widget";
  iframe.loading = "lazy";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.allow = "payment";
  iframe.setAttribute(
    "sandbox",
    [
      "allow-forms",
      "allow-modals",
      "allow-popups",
      "allow-popups-to-escape-sandbox",
      "allow-same-origin",
      "allow-scripts",
      "allow-top-navigation-by-user-activation"
    ].join(" ")
  );

  container.replaceChildren(iframe);
}

function mountBookingLink(container, integration, page) {
  const bookingUrl =
    integration.bookingUrl ||
    integration.url ||
    page.bookingUrl ||
    "";

  if (!isSafePublicUrl(bookingUrl)) {
    throw new Error("The saved booking URL is invalid.");
  }

  const link = document.createElement("a");
  link.className = "booking-link-button";
  link.href = bookingUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open online booking";

  container.replaceChildren(link);
}

function mountBookingWidget(page) {
  const container = document.getElementById("businessBookingWidget");
  const integration = page.bookingIntegration || {};

  if (!container || integration.enabled !== true) return;

  try {
    const widgetType = normalizeWidgetType(integration);

    if (widgetType === "html") {
      mountHtmlBookingWidget(container, integration);
      return;
    }

    if (widgetType === "iframe") {
      mountIframeBookingWidget(container, integration);
      return;
    }

    mountBookingLink(container, integration, page);
  } catch (error) {
    console.error("Could not render booking widget:", error);
    container.innerHTML = `
      <div class="booking-widget-error">
        <p>Online booking could not be loaded here.</p>
        ${
          isSafePublicUrl(integration.bookingUrl || page.bookingUrl || "")
            ? `<a href="${escapeAttribute(integration.bookingUrl || page.bookingUrl)}" target="_blank" rel="noopener noreferrer">Open the booking page</a>`
            : ""
        }
      </div>
    `;
  }
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

    <section class="content-grid about-only-grid">
      <article class="info-card about-card compact-about-card">
        <p class="section-label">About</p>
        <p class="about-copy">${escapeHtml(
          profile.bio ||
          "This verified business has not added a full bio yet."
        )}</p>
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

    ${renderBookingWidget(page)}
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
        This business has not verified ownership yet. Appointment inventory is
        shown in a muted preview, while verified businesses can add a full bio,
        logo, deals, and booking widgets.
      </p>
    </section>

    <section class="inventory-card muted">
      <div class="inventory-header">
        <div>
          <p class="section-label">Appointment Inventory</p>
          <h2>Available appointment times</h2>
          <p class="inventory-access-note">
            Previewing up to eight current times per appointment category.
          </p>
        </div>
      </div>
      <div id="businessInventory" class="inventory-placeholder">
        <p>Loading appointment inventory...</p>
      </div>
    </section>
  `;
}

async function loadBusinessInventory(page) {
  const inventory = document.getElementById("businessInventory");

  if (!inventory || !page?.businessName) {
    return;
  }

  try {
    const params = new URLSearchParams();
    params.set("business", page.businessName);
    params.set(
      "limitPerBusiness",
      page.isVerified ? "999" : "96"
    );
    params.set("fresh", String(Date.now()));

    const response = await fetch(`/api/search?${params.toString()}`);
    const data = await response.json();

    const appointments = (
      Array.isArray(data.appointments)
        ? data.appointments
        : []
    ).filter((appointment) => {
      if (
        appointment.businessEnabled === false ||
        appointment.enabled === false
      ) {
        return false;
      }

      const status = String(
        appointment.inventoryStatus ||
        appointment.status ||
        ""
      ).toLowerCase();

      return ![
        "inactive",
        "expired",
        "archived",
        "deleted",
        "disabled"
      ].includes(status);
    });

    if (!appointments.length) {
      inventory.innerHTML = `
        <p>No appointment inventory found for this business yet.</p>
      `;
      return;
    }

    const allCategoryGroups = groupAppointmentsByCategory(
      appointments,
      page
    );

    const categoryGroups = page.isVerified
      ? allCategoryGroups
      : allCategoryGroups
          .slice(0, 4)
          .map((categoryGroup) => ({
            ...categoryGroup,
            appointments: categoryGroup.appointments.slice(0, 8)
          }));

    inventory.innerHTML = categoryGroups
      .map((categoryGroup) => {
        const groupedDates = groupAppointmentsByDate(
          categoryGroup.appointments
        );

        const dateGroups = Object.entries(groupedDates).slice(
          0,
          page.isVerified ? 14 : 3
        );

        return `
          <section
            class="inventory-category"
            data-category-slug="${escapeAttribute(categoryGroup.slug)}"
          >
            <div class="inventory-category-header">
              <h3>${escapeHtml(categoryGroup.displayName)}</h3>
              <span>
                ${categoryGroup.appointments.length}
                ${categoryGroup.appointments.length === 1 ? "time" : "times"}
              </span>
            </div>

            ${dateGroups
              .map(([dateKey, items]) => `
                <div class="inventory-day">
                  <h4>${escapeHtml(dateKey)}</h4>
                  <div class="appointment-button-grid">
                    ${items
                      .slice(0, page.isVerified ? 24 : 6)
                      .map((appointment) => {
                        const sourceType =
                          appointment.sourceType ||
                          appointment.inventorySource ||
                          appointment.sourceStatus ||
                          "";

                        const isInferred =
                          String(sourceType).toLowerCase() === "inferred";

                        const availabilityLabel =
                          isInferred ? "Inferred" : "Confirmed";

                        const serviceLabel =
                          formatAppointmentService(appointment);

                        return `
                          <a
                            class="appointment-button ${
                              isInferred ? "inferred" : "confirmed"
                            }"
                            href="${escapeAttribute(
                              appointment.bookingUrl || "#"
                            )}"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <span class="appointment-date-time">
                              ${escapeHtml(
                                formatAppointmentButton(appointment)
                              )}
                            </span>
                            <small class="appointment-details">
                              <span class="appointment-status">
                                ${escapeHtml(availabilityLabel)}
                              </span>
                              <span
                                class="appointment-service"
                                title="${escapeAttribute(serviceLabel)}"
                              >
                                ${escapeHtml(serviceLabel)}
                              </span>
                            </small>
                          </a>
                        `;
                      })
                      .join("")}
                  </div>
                </div>
              `)
              .join("")}
          </section>
        `;
      })
      .join("");
  } catch (error) {
    console.error("Could not load business inventory:", error);
    inventory.innerHTML = `
      <p>Could not load appointment inventory.</p>
    `;
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

    updateBusinessMetadata(page);

    root.innerHTML = page.isVerified
      ? renderVerifiedPage(page)
      : renderUnverifiedPage(page);

    await loadBusinessInventory(page);
    mountBookingWidget(page);
  } catch (error) {
    root.innerHTML = `
      <section class="error-card">
        <h1>Something went wrong</h1>
        <p>${escapeHtml(error.message)}</p>
      </section>
    `;
  }
}

function updateBusinessMetadata(page = {}) {
  const businessName =
    page.businessName ||
    page.name ||
    "Local Business";

  const city =
    page.city ||
    page.address?.city ||
    page.location?.city ||
    "";

  const state =
    page.state ||
    page.address?.state ||
    page.location?.state ||
    "";

  const industry =
    page.industry ||
    page.category ||
    page.businessType ||
    page.serviceCategory ||
    "appointments";

  const location = [city, state].filter(Boolean).join(", ");

  const titleParts = [
    businessName,
    location ? `${industry} in ${location}` : industry,
    "NextAppt.ai"
  ];

  document.title = titleParts.join(" | ");

  const description = location
    ? `View appointment availability for ${businessName}, a local ${industry} provider in ${location}. Find services and book through NextAppt.ai.`
    : `View appointment availability, services, and booking information for ${businessName} through NextAppt.ai.`;

  let descriptionTag = document.querySelector('meta[name="description"]');

  if (!descriptionTag) {
    descriptionTag = document.createElement("meta");
    descriptionTag.setAttribute("name", "description");
    document.head.appendChild(descriptionTag);
  }

  descriptionTag.setAttribute("content", description);

  let robotsTag = document.querySelector('meta[name="robots"]');

  if (!robotsTag) {
    robotsTag = document.createElement("meta");
    robotsTag.setAttribute("name", "robots");
    document.head.appendChild(robotsTag);
  }

  robotsTag.setAttribute("content", "index,follow");

  let canonicalTag = document.querySelector('link[rel="canonical"]');

  if (!canonicalTag) {
    canonicalTag = document.createElement("link");
    canonicalTag.setAttribute("rel", "canonical");
    document.head.appendChild(canonicalTag);
  }

  canonicalTag.setAttribute(
    "href",
    `${window.location.origin}/business/${encodeURIComponent(getSlugFromPath())}`
  );
}

loadBusinessPage();