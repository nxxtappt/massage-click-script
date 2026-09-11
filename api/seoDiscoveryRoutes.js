const fs = require("fs");
const path = require("path");

const DEFAULT_SITE_ORIGIN = "https://nextappt.ai";
const DEFAULT_TIME_ZONE = "America/Chicago";
const SITEMAP_CACHE_SECONDS = 300;

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(value = "") {
  return escapeHtml(value);
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function slugify(value = "") {
  return String(value || "business")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 90) || "business";
}

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOrigin(value = "") {
  try {
    const url = new URL(value || DEFAULT_SITE_ORIGIN);
    return url.origin;
  } catch {
    return DEFAULT_SITE_ORIGIN;
  }
}

function safePublicUrl(value = "") {
  if (!value) return "";

  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function getBusinessSlug(business = {}) {
  return (
    business.businessSlug ||
    business.slug ||
    slugify(business.businessName || business.name)
  );
}

function getBusinessName(business = {}) {
  return business.businessName || business.displayName || business.name || "Business";
}

function isBusinessEnabled(business = {}) {
  return business.enabled !== false && business.businessEnabled !== false;
}

function getServiceCategories(business = {}) {
  const values = [];

  for (const category of Array.isArray(business.categories) ? business.categories : []) {
    values.push(category.displayName || category.name || category.slug);
  }

  for (const service of Array.isArray(business.services) ? business.services : []) {
    values.push(
      service.category?.displayName ||
        service.marketplaceCategory ||
        service.categorySlug ||
        service.serviceCategory ||
        service.serviceType
    );
  }

  if (!values.filter(Boolean).length && business.businessCategory) {
    values.push(business.businessCategory);
  }

  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalize(value);
      if (!key || seen.has(key) || key === "wellness") return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function getServices(business = {}) {
  const seen = new Set();

  return (Array.isArray(business.services) ? business.services : [])
    .filter((service) => service && service.enabled !== false)
    .filter((service) => {
      const name = String(service.serviceName || service.name || "").trim();
      const key = `${normalize(name)}|${Number(service.durationMinutes) || ""}`;
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getModifiedAt(record = {}) {
  const raw = record.rawJson && typeof record.rawJson === "object" ? record.rawJson : {};
  const candidates = [
    record.updatedAt,
    record.updated_at,
    record.lastCheckedAt,
    record.last_checked_at,
    record.createdAt,
    record.created_at,
    raw.lastCheckedAt,
    raw.lastChecked,
    raw.updatedAt
  ];

  for (const candidate of candidates) {
    const parsed = parseDate(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function getLatestModified(records = []) {
  return records.reduce((latest, record) => {
    const candidate = getModifiedAt(record);
    return candidate && (!latest || candidate > latest) ? candidate : latest;
  }, null);
}

function formatLastMod(date) {
  return date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toISOString()
    : "";
}

function getLocalDateTimeParts(appointment = {}) {
  const localDate =
    appointment.localDateKey ||
    appointment.localDate ||
    appointment.local_date ||
    "";
  const localTime =
    appointment.localTimeKey ||
    appointment.localTime ||
    appointment.local_time ||
    "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(localDate) && /^\d{2}:\d{2}/.test(localTime)) {
    return {
      localDate,
      localTime: localTime.slice(0, 5),
      isoLocal: `${localDate}T${localTime.slice(0, 5)}:00`
    };
  }

  const raw =
    appointment.appointmentStart ||
    appointment.startAt ||
    appointment.startTime ||
    appointment.appointment_start ||
    "";
  const match = String(raw).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);

  return match
    ? { localDate: match[1], localTime: match[2], isoLocal: `${match[1]}T${match[2]}:00` }
    : { localDate: "", localTime: "", isoLocal: String(raw || "") };
}

function formatAppointment(appointment = {}, timeZone = DEFAULT_TIME_ZONE) {
  const parts = getLocalDateTimeParts(appointment);
  const displayDate = appointment.displayDate || appointment.date || parts.localDate;
  const displayTime = appointment.displayTime || appointment.time || parts.localTime;
  const serviceName =
    appointment.serviceName || appointment.service || appointment.serviceCategory || "Appointment";
  const duration = Number(appointment.durationMinutes || appointment.duration_minutes);
  const providerName =
    appointment.providerName || appointment.therapistName || appointment.provider || "First available";

  return {
    id: appointment.id || null,
    serviceName,
    serviceCategory: appointment.serviceCategory || appointment.serviceType || "",
    durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : null,
    providerName,
    startAt:
      appointment.appointmentStart || appointment.startAt || appointment.startTime || parts.isoLocal,
    localDate: parts.localDate,
    localTime: parts.localTime,
    localStart: parts.isoLocal,
    displayDate,
    displayTime,
    timeZone: appointment.timezone || timeZone,
    sourceType: appointment.sourceType || "confirmed",
    bookingUrl: safePublicUrl(appointment.bookingUrl),
    updatedAt: formatLastMod(getModifiedAt(appointment)) || null
  };
}

function findCachedBusiness(businessManager, slugOrName) {
  const target = normalize(slugOrName);
  const businesses = businessManager.getAllBusinessesSync({ includeDisabled: true });

  return (
    (Array.isArray(businesses) ? businesses : []).find((business) => {
      return [
        getBusinessSlug(business),
        business.businessId,
        business.id,
        getBusinessName(business)
      ].some((value) => normalize(value) === target);
    }) || null
  );
}

async function loadBusinesses(businessManager, includeDisabled = false) {
  let businesses = businessManager.getAllBusinessesSync({ includeDisabled });

  if ((!Array.isArray(businesses) || !businesses.length) && businessManager.getAllBusinesses) {
    businesses = await businessManager.getAllBusinesses({ includeDisabled });
  }

  return Array.isArray(businesses) ? businesses : [];
}

async function loadBusiness(businessManager, slugOrName) {
  const cached = findCachedBusiness(businessManager, slugOrName);
  let page = null;
  let pageError = null;

  try {
    page = await businessManager.getBusinessPageData(slugOrName);
  } catch (error) {
    pageError = error;
  }

  if (!page && !cached && businessManager.getBusinessByName) {
    try {
      const byName = await businessManager.getBusinessByName(slugOrName);
      page = businessManager.buildBusinessPageData
        ? businessManager.buildBusinessPageData(byName)
        : byName;
    } catch {
      page = null;
    }
  }

  if (!cached && !page && pageError) throw pageError;

  if (!cached && !page) return null;

  return {
    ...(cached || {}),
    ...(page || {}),
    services: page?.services || cached?.services || [],
    categories: page?.categories || cached?.categories || [],
    city: page?.city || cached?.city || "Austin",
    state: page?.state || cached?.state || "TX",
    postalCode: page?.postalCode || cached?.postalCode || "",
    timezone: page?.timezone || cached?.timezone || DEFAULT_TIME_ZONE
  };
}

async function loadUpcomingAppointments(inventoryManager, businessName, limit = 12) {
  const appointments = await inventoryManager.getInventory({
    businessName,
    hours: 168,
    includeInferred: false,
    includeConfirmed: true,
    includeInactive: false,
    showPast: false,
    limit: Math.max(limit, 50)
  });

  return (Array.isArray(appointments) ? appointments : [])
    .filter((appointment) => appointment.enabled !== false && appointment.businessEnabled !== false)
    .filter((appointment) => normalize(appointment.sourceType || "confirmed") === "confirmed")
    .slice(0, limit);
}

function getLocationText(business = {}) {
  const city = business.city || "Austin";
  const state = business.state || "TX";
  return [city, state].filter(Boolean).join(", ");
}

function getCategoryText(business = {}) {
  const categories = getServiceCategories(business);
  if (!categories.length) return "appointment";
  if (categories.length === 1) return `${categories[0]} appointment`;
  return `${categories.slice(0, 2).join(" and ")} appointments`;
}

function buildBusinessDescription(business, appointments) {
  const businessName = getBusinessName(business);
  const location = getLocationText(business);
  const categoryText = getCategoryText(business);
  const next = appointments[0] ? formatAppointment(appointments[0], business.timezone) : null;

  if (next) {
    const service = next.serviceName ? ` for ${next.serviceName}` : "";
    return `${businessName} in ${location} has ${categoryText} listed on NextAppt.ai. Next confirmed opening: ${next.displayDate} at ${next.displayTime}${service}. Recheck before booking.`;
  }

  return `View ${categoryText}, services, and booking information for ${businessName} in ${location} on NextAppt.ai.`;
}

function buildBusinessJsonLd(business, appointments, siteOrigin) {
  const businessName = getBusinessName(business);
  const slug = getBusinessSlug(business);
  const canonical = `${siteOrigin}/business/${encodeURIComponent(slug)}`;
  const services = getServices(business);
  const categories = getServiceCategories(business);
  const bookingUrl = safePublicUrl(business.bookingUrl);
  const website = safePublicUrl(business.website);
  const address = {
    "@type": "PostalAddress",
    streetAddress: business.address || undefined,
    addressLocality: business.city || "Austin",
    addressRegion: business.state || "TX",
    postalCode: business.postalCode || undefined,
    addressCountry: "US"
  };

  const localBusiness = {
    "@type": "LocalBusiness",
    "@id": `${canonical}#business`,
    name: businessName,
    url: canonical,
    description: buildBusinessDescription(business, appointments),
    address,
    telephone: business.phone || undefined,
    image: safePublicUrl(business.logoUrl) || undefined,
    sameAs: website ? [website] : undefined,
    knowsAbout: [...categories, ...services.map((service) => service.serviceName || service.name)]
      .filter(Boolean)
      .slice(0, 30),
    hasOfferCatalog: services.length
      ? {
          "@type": "OfferCatalog",
          name: `${businessName} services`,
          itemListElement: services.map((service) => ({
            "@type": "Offer",
            itemOffered: {
              "@type": "Service",
              name: service.serviceName || service.name,
              serviceType: service.serviceType || service.serviceCategory || undefined
            }
          }))
        }
      : undefined,
    potentialAction: bookingUrl
      ? {
          "@type": "ReserveAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: bookingUrl
          }
        }
      : undefined
  };

  const availabilityUrl = `${siteOrigin}/availability/austin?business=${encodeURIComponent(
    businessName
  )}`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      localBusiness,
      {
        "@type": "WebPage",
        "@id": `${canonical}#webpage`,
        name: `${businessName} Appointments and Availability`,
        url: canonical,
        description: buildBusinessDescription(business, appointments),
        mainEntity: { "@id": `${canonical}#business` },
        subjectOf: {
          "@type": "DataFeed",
          name: `${businessName} appointment availability`,
          url: availabilityUrl,
          dateModified: formatLastMod(getLatestModified(appointments)) || undefined
        }
      }
    ]
  };
}

function buildPrerenderedBusinessMain(business, appointments) {
  const businessName = getBusinessName(business);
  const location = getLocationText(business);
  const categories = getServiceCategories(business);
  const services = getServices(business);
  const slots = appointments.map((appointment) => formatAppointment(appointment, business.timezone));

  return `
    <article class="business-page-prerender" aria-label="${escapeHtml(businessName)} profile">
      <section class="hero-card">
        <p class="section-label">NextAppt.ai business listing</p>
        <h1>${escapeHtml(businessName)}</h1>
        ${business.address ? `<p class="address">${escapeHtml(business.address)} · ${escapeHtml(location)}</p>` : `<p class="address">${escapeHtml(location)}</p>`}
        ${categories.length ? `<p>${escapeHtml(categories.join(" · "))}</p>` : ""}
      </section>
      ${services.length ? `
        <section class="service-catalog-card">
          <h2>Services</h2>
          <ul>${services.slice(0, 12).map((service) => `<li>${escapeHtml(service.serviceName || service.name)}${Number(service.durationMinutes) ? ` — ${Number(service.durationMinutes)} minutes` : ""}</li>`).join("")}</ul>
        </section>` : ""}
      <section class="inventory-card">
        <h2>Current appointment availability</h2>
        ${slots.length
          ? `<ol>${slots.map((slot) => `<li><strong>${escapeHtml(slot.displayDate)} at ${escapeHtml(slot.displayTime)}</strong> — ${escapeHtml(slot.serviceName)}${slot.durationMinutes ? ` (${slot.durationMinutes} minutes)` : ""}. Confirmed opening; recheck before booking.</li>`).join("")}</ol>`
          : "<p>No confirmed upcoming appointment was present when this page was generated. Check the booking page for the latest schedule.</p>"}
      </section>
    </article>`;
}

function replaceOrAppendTitle(html, title) {
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  }
  return html.replace(/<\/head>/i, `<title>${escapeHtml(title)}</title>\n</head>`);
}

function renderBusinessPage(template, business, appointments, siteOrigin) {
  const businessName = getBusinessName(business);
  const slug = getBusinessSlug(business);
  const canonical = `${siteOrigin}/business/${encodeURIComponent(slug)}`;
  const availabilityUrl = `${siteOrigin}/availability/austin?business=${encodeURIComponent(
    businessName
  )}`;
  const apiUrl = `${siteOrigin}/api/public/availability?business=${encodeURIComponent(
    businessName
  )}`;
  const title = `${businessName} Appointments & Live Availability | NextAppt.ai`;
  const description = buildBusinessDescription(business, appointments);
  const jsonLd = buildBusinessJsonLd(business, appointments, siteOrigin);
  const head = `
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="alternate" type="text/html" title="${escapeHtml(businessName)} live appointment availability" href="${escapeHtml(availabilityUrl)}">
  <link rel="alternate" type="application/json" title="${escapeHtml(businessName)} appointment availability data" href="${escapeHtml(apiUrl)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="NextAppt.ai">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <script type="application/ld+json">${safeJson(jsonLd)}</script>`;

  let html = replaceOrAppendTitle(template, title);
  html = html.replace(/<\/head>/i, `${head}\n</head>`);

  const prerendered = buildPrerenderedBusinessMain(business, appointments);
  if (/<main[^>]*id=["']businessPage["'][^>]*>[\s\S]*?<\/main>/i.test(html)) {
    html = html.replace(
      /<main([^>]*id=["']businessPage["'][^>]*)>[\s\S]*?<\/main>/i,
      `<main$1>${prerendered}</main>`
    );
  }

  return html;
}

function buildAvailabilityJsonLd(business, appointments, canonical, siteOrigin) {
  const businessName = getBusinessName(business);
  const slots = appointments.map((appointment) => formatAppointment(appointment, business.timezone));

  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${businessName} appointment availability`,
    url: canonical,
    about: {
      "@type": "LocalBusiness",
      name: businessName,
      url: `${siteOrigin}/business/${encodeURIComponent(getBusinessSlug(business))}`
    },
    dateModified: formatLastMod(getLatestModified(appointments)) || undefined,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: slots.length,
      itemListElement: slots.map((slot, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: `${businessName}: ${slot.serviceName}, ${slot.localStart}, confirmed`,
        url: `${canonical}#opening-${index + 1}`
      }))
    }
  };
}

function renderAvailabilityPage(business, appointments, siteOrigin) {
  const businessName = getBusinessName(business);
  const slug = getBusinessSlug(business);
  const canonical = `${siteOrigin}/availability/austin?business=${encodeURIComponent(businessName)}`;
  const businessUrl = `${siteOrigin}/business/${encodeURIComponent(slug)}`;
  const apiUrl = `${siteOrigin}/api/public/availability?business=${encodeURIComponent(businessName)}`;
  const slots = appointments.map((appointment) => formatAppointment(appointment, business.timezone));
  const description = slots.length
    ? `See the next ${slots.length} confirmed appointment opening${slots.length === 1 ? "" : "s"} for ${businessName} in Austin, updated from NextAppt.ai inventory.`
    : `Check current appointment availability and booking information for ${businessName} in Austin on NextAppt.ai.`;
  const jsonLd = buildAvailabilityJsonLd(business, appointments, canonical, siteOrigin);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(businessName)} Next Appointment & Live Availability | NextAppt.ai</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-snippet:-1">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="alternate" type="application/json" title="${escapeHtml(businessName)} appointment availability data" href="${escapeHtml(apiUrl)}">
  <script type="application/ld+json">${safeJson(jsonLd)}</script>
</head>
<body>
  <header><a href="${escapeHtml(siteOrigin)}">NextAppt.ai</a></header>
  <main>
    <h1>${escapeHtml(businessName)} appointment availability</h1>
    <p>${escapeHtml(business.address || "Austin, TX")}</p>
    <p>Confirmed means the opening was observed in the booking source; it is not reserved. Recheck with the business before booking.</p>
    ${slots.length
      ? `<ol>${slots.map((slot, index) => `<li id="opening-${index + 1}"><h2>${escapeHtml(slot.serviceName)}</h2><p><time datetime="${escapeHtml(slot.localStart)}">${escapeHtml(slot.displayDate)} at ${escapeHtml(slot.displayTime)}</time> (${escapeHtml(slot.timeZone)})${slot.durationMinutes ? ` · ${slot.durationMinutes} minutes` : ""} · ${escapeHtml(slot.providerName)}</p>${slot.bookingUrl ? `<p><a href="${escapeHtml(slot.bookingUrl)}">Check and book this opening</a></p>` : ""}</li>`).join("")}</ol>`
      : "<p>No confirmed upcoming opening was present when this page was generated. The business booking page may have newer information.</p>"}
    <nav><a href="${escapeHtml(businessUrl)}">View ${escapeHtml(businessName)} on NextAppt.ai</a> · <a href="${escapeHtml(apiUrl)}">Read availability as JSON</a> · <a href="${escapeHtml(siteOrigin)}/availability-methodology">Availability methodology</a></nav>
  </main>
</body>
</html>`;
}

function renderUrlSet(entries = []) {
  const body = entries
    .map((entry) => {
      const lastmod = entry.lastmod ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : "";
      return `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}

function renderSitemapIndex(siteOrigin) {
  const date = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${escapeXml(siteOrigin)}/sitemap.xml</loc><lastmod>${date}</lastmod></sitemap>
  <sitemap><loc>${escapeXml(siteOrigin)}/sitemap-businesses.xml</loc><lastmod>${date}</lastmod></sitemap>
  <sitemap><loc>${escapeXml(siteOrigin)}/sitemap-availability.xml</loc><lastmod>${date}</lastmod></sitemap>
</sitemapindex>`;
}

function setXmlHeaders(res) {
  res.type("application/xml");
  res.set("Cache-Control", `public, max-age=${SITEMAP_CACHE_SECONDS}`);
  res.set("X-Robots-Tag", "noindex, follow");
}

function createSeoDiscoveryRoutes(options = {}) {
  const express = require("express");
  const router = express.Router();
  const businessManager = options.businessManager;
  const inventoryManager = options.inventoryManager;
  const siteOrigin = normalizeOrigin(options.siteOrigin || process.env.SITE_ORIGIN);
  const publicDir = options.publicDir || path.join(process.cwd(), "public");
  const templatePath = path.join(publicDir, "business-page.html");

  if (!businessManager || !inventoryManager) {
    throw new Error("seoDiscoveryRoutes requires businessManager and inventoryManager");
  }

  router.get("/robots.txt", (req, res) => {
    res.type("text/plain");
    res.set("Cache-Control", `public, max-age=${SITEMAP_CACHE_SECONDS}`);
    res.send(`User-agent: *
Allow: /

Disallow: /admin
Disallow: /admin.html
Disallow: /business-dashboard
Disallow: /api/admin
Disallow: /api/business-dashboard

Sitemap: ${siteOrigin}/sitemap-index.xml
`);
  });

  router.get("/sitemap-index.xml", (req, res) => {
    setXmlHeaders(res);
    res.send(renderSitemapIndex(siteOrigin));
  });

  router.get("/sitemap-businesses.xml", async (req, res, next) => {
    try {
      const businesses = await loadBusinesses(businessManager, false);
      const entries = businesses
      .filter(isBusinessEnabled)
      .map((business) => ({
        loc: `${siteOrigin}/business/${encodeURIComponent(getBusinessSlug(business))}`,
        lastmod: formatLastMod(getModifiedAt(business))
      }))
      .sort((left, right) => left.loc.localeCompare(right.loc));

      setXmlHeaders(res);
      res.send(renderUrlSet(entries));
    } catch (error) {
      next(error);
    }
  });

  router.get("/sitemap-availability.xml", async (req, res, next) => {
    try {
      const businesses = await loadBusinesses(businessManager, false);
      const appointments = await inventoryManager.getInventory({
        hours: 168,
        includeInferred: false,
        includeConfirmed: true,
        includeInactive: false,
        showPast: false,
        limit: 10000
      });
      const grouped = new Map();

      for (const appointment of Array.isArray(appointments) ? appointments : []) {
        if (appointment.enabled === false || appointment.businessEnabled === false) continue;
        if (normalize(appointment.sourceType || "confirmed") !== "confirmed") continue;
        const key = normalize(appointment.businessName);
        if (!key) continue;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(appointment);
      }

      const entries = businesses
        .filter(isBusinessEnabled)
        .map((business) => {
          const businessAppointments = grouped.get(normalize(getBusinessName(business))) || [];
          if (!businessAppointments.length) return null;
          return {
            loc: `${siteOrigin}/availability/austin?business=${encodeURIComponent(
              getBusinessName(business)
            )}`,
            lastmod: formatLastMod(getLatestModified(businessAppointments))
          };
        })
        .filter(Boolean)
        .sort((left, right) => left.loc.localeCompare(right.loc));

      setXmlHeaders(res);
      res.send(renderUrlSet(entries));
    } catch (error) {
      next(error);
    }
  });

  router.get("/availability/austin", async (req, res, next) => {
    if (!req.query.business) return next();

    try {
      const business = await loadBusiness(businessManager, req.query.business);
      if (!business || !isBusinessEnabled(business)) {
        return res.status(404).send("Business not found");
      }

      const appointments = await loadUpcomingAppointments(
        inventoryManager,
        getBusinessName(business),
        24
      );
      const apiUrl = `${siteOrigin}/api/public/availability?business=${encodeURIComponent(
        getBusinessName(business)
      )}`;

      res.type("html");
      res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
      res.set("Link", `<${apiUrl}>; rel="alternate"; type="application/json"`);
      res.send(renderAvailabilityPage(business, appointments, siteOrigin));
    } catch (error) {
      next(error);
    }
  });

  router.get("/business/:slug", async (req, res, next) => {
    try {
      const business = await loadBusiness(businessManager, req.params.slug);
      if (!business || !isBusinessEnabled(business)) {
        return res.status(404).send("Business not found");
      }

      const [appointments, template] = await Promise.all([
        loadUpcomingAppointments(inventoryManager, getBusinessName(business), 8),
        fs.promises.readFile(templatePath, "utf8")
      ]);
      const businessName = getBusinessName(business);
      const apiUrl = `${siteOrigin}/api/public/availability?business=${encodeURIComponent(
        businessName
      )}`;
      const availabilityUrl = `${siteOrigin}/availability/austin?business=${encodeURIComponent(
        businessName
      )}`;

      res.type("html");
      res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      res.set(
        "Link",
        `<${apiUrl}>; rel="alternate"; type="application/json", <${availabilityUrl}>; rel="alternate"; type="text/html"`
      );
      res.send(renderBusinessPage(template, business, appointments, siteOrigin));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createSeoDiscoveryRoutes;
module.exports._private = {
  buildBusinessDescription,
  buildBusinessJsonLd,
  formatAppointment,
  getServiceCategories,
  renderAvailabilityPage,
  renderBusinessPage,
  renderSitemapIndex,
  renderUrlSet
};