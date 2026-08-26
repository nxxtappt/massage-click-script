"use strict";

const DEFAULT_TIMEZONE = "America/Chicago";
const MAX_DAYS_PER_REQUEST = 30;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function parseDateKey(value) {
  if (!isDateKey(value)) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getTodayDateKey(timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function daysBetweenInclusive(startDateKey, endDateKey) {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);

  if (!start || !end) return null;

  const diff = Math.floor((end.getTime() - start.getTime()) / 86400000);
  return Math.max(1, diff + 1);
}

function addDaysToDateKey(dateKey, daysToAdd) {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey;
  date.setDate(date.getDate() + Number(daysToAdd || 0));
  return formatDateKey(date);
}

function normalizeOwnerId(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_-]+$/.test(text) ? text : "";
}

function parseOwnerIdFromUrl(rawUrl = "") {
  try {
    const url = new URL(rawUrl);

    const pathMatch = url.pathname.match(/\/schedule\/([A-Za-z0-9_-]+)/i);
    if (pathMatch) return normalizeOwnerId(pathMatch[1]);

    const queryOwner = url.searchParams.get("owner");
    if (queryOwner) return normalizeOwnerId(queryOwner);
  } catch {
    // Ignore malformed URLs here; validation happens later.
  }

  return "";
}

function parseOwnerIdFromHtml(html = "") {
  const text = String(html || "");

  const patterns = [
    /\/schedule\/([A-Za-z0-9_-]{6,})/i,
    /["']owner["']\s*:\s*["']([A-Za-z0-9_-]{6,})["']/i,
    /owner=([A-Za-z0-9_-]{6,})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return normalizeOwnerId(match[1]);
  }

  return "";
}

async function resolveAcuityOwnerId(business = {}) {
  const configured = normalizeOwnerId(
    business.acuityOwnerId ||
      business.ownerId ||
      business.owner ||
      business.integrationConfig?.acuityOwnerId ||
      business.integrationConfig?.ownerId
  );

  if (configured) return configured;

  const fromUrl = parseOwnerIdFromUrl(business.bookingUrl || "");
  if (fromUrl) return fromUrl;

  if (!business.bookingUrl) return "";

  // Custom *.as.me pages do not expose the owner in the hostname. Do one
  // lightweight HTML request and inspect the final URL/body for the scheduler id.
  const response = await fetch(business.bookingUrl, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent":
        "Mozilla/5.0 (compatible; NextAppt/1.0; +https://nextappt.ai)"
    }
  });

  const finalUrlOwner = parseOwnerIdFromUrl(response.url || "");
  if (finalUrlOwner) return finalUrlOwner;

  const html = await response.text();
  return parseOwnerIdFromHtml(html);
}

function resolveApiOrigin(business = {}) {
  const explicit = String(
    business.acuityApiOrigin || business.integrationConfig?.acuityApiOrigin || ""
  ).trim();

  if (explicit) return explicit.replace(/\/$/, "");

  try {
    const url = new URL(business.bookingUrl || "");
    const host = url.hostname.toLowerCase();

    if (host.endsWith(".as.me")) {
      return `${url.protocol}//${url.host}`;
    }

    if (host.includes("squarespacescheduling.com")) {
      return "https://app.squarespacescheduling.com";
    }
  } catch {
    // Fall through to canonical Acuity host.
  }

  return "https://app.acuityscheduling.com";
}

function resolveAppointmentTypeId(business = {}) {
  return String(
    business.appointmentTypeId ||
      business.appointmentTypeID ||
      business.platformServiceId ||
      business.serviceId ||
      business.serviceButtonId ||
      business.serviceConfig?.appointmentTypeId ||
      business.serviceConfig?.appointmentTypeID ||
      ""
  ).trim();
}

function resolveCalendarId(business = {}) {
  return String(
    business.acuityCalendarId ||
      business.serviceConfig?.acuityCalendarId ||
      business.calendarId ||
      business.calendarID ||
      business.integrationConfig?.calendarId ||
      business.integrationConfig?.calendarID ||
      "any"
  ).trim() || "any";
}

function resolveTimezone(business = {}) {
  return String(
    business.timezone ||
      business.acuityTimezone ||
      business.integrationConfig?.timezone ||
      DEFAULT_TIMEZONE
  ).trim() || DEFAULT_TIMEZONE;
}

function resolveScrapeWindow(business = {}) {
  const timezone = resolveTimezone(business);
  const startDate = isDateKey(business.scrapeStartDate)
    ? business.scrapeStartDate
    : getTodayDateKey(timezone);

  let daysForward = Number(business.daysForward || 0);

  if (!daysForward && isDateKey(business.scrapeEndDate)) {
    daysForward = daysBetweenInclusive(startDate, business.scrapeEndDate) || 1;
  }

  if (!daysForward && business.lookaheadHours) {
    daysForward = Math.max(1, Math.ceil(Number(business.lookaheadHours) / 24));
  }

  if (!daysForward || !Number.isFinite(daysForward)) {
    daysForward = 7;
  }

  daysForward = Math.max(1, Math.min(MAX_DAYS_PER_REQUEST, Math.ceil(daysForward)));

  const endDate = isDateKey(business.scrapeEndDate)
    ? business.scrapeEndDate
    : addDaysToDateKey(startDate, daysForward - 1);

  return {
    scrapeStartDate: startDate,
    scrapeEndDate: endDate,
    daysForward,
    lookaheadHours: business.lookaheadHours
      ? Number(business.lookaheadHours)
      : daysForward * 24,
    scrapeWindowMode: business.scrapeWindowMode || "days_forward"
  };
}

function getLocalDateKey(rawTime = "", fallback = "") {
  const match = String(rawTime).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : fallback;
}

function getLocalTimeKey(rawTime = "") {
  const match = String(rawTime).match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function formatDisplayTime(rawTime = "") {
  const localTimeKey = getLocalTimeKey(rawTime);
  if (!localTimeKey) return rawTime;

  const [hourText, minute] = localTimeKey.split(":");
  let hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

function normalizeAvailabilityPayload(payload = {}, business = {}) {
  const openings = [];
  const seen = new Set();

  for (const [dateKey, slots] of Object.entries(payload || {})) {
    if (!Array.isArray(slots)) continue;

    for (const slot of slots) {
      const rawTime = String(slot?.time || "").trim();
      if (!rawTime) continue;

      const localDateKey = getLocalDateKey(rawTime, dateKey);
      const localTimeKey = getLocalTimeKey(rawTime);
      const key = `${localDateKey}|${localTimeKey}`;

      if (seen.has(key)) continue;
      seen.add(key);

      openings.push({
        date: localDateKey,
        time: formatDisplayTime(rawTime),
        startTime: rawTime,
        appointmentStart: rawTime,
        localDateKey,
        localTimeKey,
        slotsAvailable:
          slot?.slotsAvailable === undefined ? null : Number(slot.slotsAvailable),
        providerName: "Any Available",
        therapistName: "Any Available",
        serviceName: business.serviceName || business.service || "",
        serviceType: business.serviceType || "",
        durationMinutes: business.durationMinutes || null,
        bookingUrl: business.bookingUrl || "",
        platform: "acuity"
      });
    }
  }

  return openings.sort((a, b) =>
    String(a.startTime || "").localeCompare(String(b.startTime || ""))
  );
}

async function scrapeAcuityBusiness(business = {}) {
  const startedAt = Date.now();

  if (!business.bookingUrl) {
    throw new Error("Acuity bookingUrl is required.");
  }

  const appointmentTypeId = resolveAppointmentTypeId(business);
  if (!appointmentTypeId) {
    throw new Error(
      "Acuity appointmentTypeId/platformServiceId is required for each configured service."
    );
  }

  const ownerId = await resolveAcuityOwnerId(business);
  if (!ownerId) {
    throw new Error(
      "Could not resolve Acuity owner ID. Use a /schedule/{owner} booking URL or configure acuityOwnerId."
    );
  }

  const calendarId = resolveCalendarId(business);
  const timezone = resolveTimezone(business);
  const scrapeWindow = resolveScrapeWindow(business);
  const apiOrigin = resolveApiOrigin(business);

  const params = new URLSearchParams({
    owner: ownerId,
    appointmentTypeId,
    calendarId,
    startDate: scrapeWindow.scrapeStartDate,
    maxDays: String(scrapeWindow.daysForward),
    timezone
  });

  const availabilityUrl = `${apiOrigin}/api/scheduling/v1/availability/times?${params.toString()}`;

  const response = await fetch(availabilityUrl, {
    headers: {
      Accept: "application/json",
      Referer: business.bookingUrl,
      "User-Agent":
        "Mozilla/5.0 (compatible; NextAppt/1.0; +https://nextappt.ai)"
    }
  });

  const responseText = await response.text();
  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Acuity returned non-JSON availability response (${response.status}). Body starts with: ${responseText.slice(0, 180)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Acuity availability request failed (${response.status}): ${JSON.stringify(data).slice(0, 300)}`
    );
  }

  const openings = normalizeAvailabilityPayload(data, business);
  const times = openings.map((item) => item.startTime).filter(Boolean);

  return {
    businessName: business.businessName || business.name || "",
    bookingUrl: business.bookingUrl,
    platform: "acuity",
    service: business.serviceName || business.service || "",
    serviceName: business.serviceName || business.service || "",
    serviceType: business.serviceType || "",
    durationMinutes: business.durationMinutes || null,
    platformServiceId: appointmentTypeId,
    provider: calendarId === "any" ? "Any Available" : `Calendar ${calendarId}`,
    date: null,
    times,
    status: times.length ? "success" : "no_times_found",
    scrapeDurationMs: Date.now() - startedAt,
    lastChecked: new Date().toISOString(),
    openings,
    appointments: openings,
    ...scrapeWindow,
    rawAcuitySummary: {
      ownerId,
      appointmentTypeId,
      calendarId,
      timezone,
      apiOrigin,
      returnedDays: Object.keys(data || {}).length,
      returnedSlots: openings.length
    }
  };
}

module.exports = {
  scrapeAcuityBusiness,
  parseOwnerIdFromUrl,
  parseOwnerIdFromHtml,
  resolveAcuityOwnerId,
  resolveApiOrigin,
  resolveScrapeWindow,
  normalizeAvailabilityPayload
};