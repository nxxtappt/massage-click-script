"use strict";

const DEFAULT_BOOKING_URL = "https://booking.austindeep.com/";
const DEFAULT_TIMEZONE = "America/Chicago";

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

function getTodayDateKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + Number(amount || 0));
  return copy;
}

function buildDateList(startDateKey, endDateKey) {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);

  if (!start || !end || start > end) return [];

  const dates = [];
  let cursor = start;

  while (formatDateKey(cursor) <= formatDateKey(end)) {
    dates.push(formatDateKey(cursor));
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function getScrapeWindow(business = {}) {
  const today = getTodayDateKey();
  const daysForward = Math.max(1, Number(business.daysForward || 2));

  const scrapeStartDate = isDateKey(business.scrapeStartDate)
    ? business.scrapeStartDate
    : today;

  const defaultEndDate = formatDateKey(
    addDays(parseDateKey(scrapeStartDate), daysForward - 1)
  );

  const scrapeEndDate = isDateKey(business.scrapeEndDate)
    ? business.scrapeEndDate
    : defaultEndDate;

  const dateList = buildDateList(scrapeStartDate, scrapeEndDate);

  return {
    scrapeStartDate,
    scrapeEndDate,
    lookaheadHours:
      business.lookaheadHours || dateList.length * 24 || daysForward * 24,
    daysForward: dateList.length || daysForward,
    scrapeWindowMode: business.scrapeWindowMode || "days_forward",
    dateList
  };
}

function getSessionTypeId(business = {}) {
  return (
    business.sessionTypeId ||
    business.platformServiceId ||
    business.serviceId ||
    business.serviceButtonId ||
    ""
  );
}

function getLocationId(business = {}) {
  return (
    business.locationId ||
    business.integrationConfig?.locationId ||
    ""
  );
}

function getSiteSlug(business = {}) {
  return (
    business.site ||
    business.siteSlug ||
    business.integrationConfig?.site ||
    business.integrationConfig?.siteSlug ||
    ""
  );
}

function getBookingBaseUrl(business = {}) {
  return business.bookingUrl || DEFAULT_BOOKING_URL;
}

function buildAvailabilityUrl(business = {}, date) {
  const sessionTypeId = getSessionTypeId(business);
  const locationId = getLocationId(business);
  const site = getSiteSlug(business);

  if (!site) {
    throw new Error("Austin Deep integration requires site (for example barton-creek or lake-austin).");
  }

  if (!locationId) {
    throw new Error("Austin Deep integration requires locationId.");
  }

  if (!sessionTypeId) {
    throw new Error(
      `Austin Deep service ${business.serviceName || ""} requires a Mindbody session type ID.`
    );
  }

  if (!isDateKey(date)) {
    throw new Error(`Invalid Austin Deep availability date: ${date}`);
  }

  const url = new URL("/api/availability", getBookingBaseUrl(business));
  url.searchParams.set("site", String(site));
  url.searchParams.set("locationId", String(locationId));
  url.searchParams.set("sessionTypeId", String(sessionTypeId));
  url.searchParams.set("date", String(date));

  return url;
}

async function fetchAvailability(business = {}, date) {
  const url = buildAvailabilityUrl(business, date);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Cache-Control": "no-cache",
      Referer: getBookingBaseUrl(business),
      "User-Agent": "Mozilla/5.0 (compatible; NextAppt/1.0)"
    }
  });

  // Browser requests can return 304 when Chrome supplies If-None-Match.
  // NextAppt does not send an ETag, but retry once with a harmless cache-buster
  // if an upstream/proxy ever produces a body-less 304 anyway.
  if (response.status === 304) {
    url.searchParams.set("_nextappt", String(Date.now()));

    const retry = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Cache-Control": "no-cache",
        Referer: getBookingBaseUrl(business),
        "User-Agent": "Mozilla/5.0 (compatible; NextAppt/1.0)"
      }
    });

    if (!retry.ok) {
      const text = await retry.text().catch(() => "");
      throw new Error(
        `Austin Deep availability request failed (${retry.status}) ${text.slice(0, 500)}`
      );
    }

    const data = await retry.json();
    return Array.isArray(data) ? data : [];
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Austin Deep availability request failed (${response.status}) ${text.slice(0, 500)}`
    );
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function addMinutesToLocalIso(localIso, minutes) {
  const match = String(localIso || "").match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/
  );

  if (!match) return "";

  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0)
    )
  );

  date.setUTCMinutes(date.getUTCMinutes() + Number(minutes || 0));

  return [
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
  ].join("T");
}

function formatDisplayTime(localTimeKey) {
  const match = String(localTimeKey || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return localTimeKey || "";

  const hour24 = Number(match[1]);
  const minute = match[2];
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return `${hour12}:${minute} ${suffix}`;
}

function getProviderName(staff = {}) {
  return (
    staff.DisplayName ||
    [staff.FirstName, staff.LastName].filter(Boolean).join(" ").trim() ||
    ""
  );
}

function normalizeAvailability(raw = {}, business = {}, scrapeWindow = {}) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.IsMasked === true || raw.ShowPublic === false) return null;

  const startTime = String(raw.StartDateTime || "").trim();
  const startMatch = startTime.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);

  if (!startMatch) return null;

  const sessionType = raw.SessionType || {};
  const staff = raw.Staff || {};
  const location = raw.Location || {};

  const requestedSessionTypeId = String(getSessionTypeId(business));
  const returnedSessionTypeId = String(sessionType.Id || "");

  // Do not accidentally ingest another service if the upstream endpoint ever
  // returns mixed session types.
  if (
    requestedSessionTypeId &&
    returnedSessionTypeId &&
    requestedSessionTypeId !== returnedSessionTypeId
  ) {
    return null;
  }

  const publicDurationMinutes = Number(business.durationMinutes || 0) || null;
  const localDateKey = startMatch[1];
  const localTimeKey = startMatch[2];
  const providerName = getProviderName(staff);
  const appointmentEnd = publicDurationMinutes
    ? addMinutesToLocalIso(startTime, publicDurationMinutes)
    : "";

  return {
    businessName: business.businessName || business.name || "Austin Deep",
    platform: "austindeep",
    bookingUrl: getBookingBaseUrl(business),

    serviceName:
      business.serviceName ||
      sessionType.Name ||
      "",
    service:
      business.serviceName ||
      sessionType.Name ||
      "",
    serviceType: business.serviceType || "deep_tissue",
    durationMinutes: publicDurationMinutes,
    platformServiceId:
      business.platformServiceId ||
      business.sessionTypeId ||
      sessionType.Id ||
      null,

    providerName,
    therapistName: providerName,
    providerId: staff.Id || null,

    appointmentStart: startTime,
    startTime,
    appointmentEnd,
    endTime: appointmentEnd,

    localDate: localDateKey,
    localDateKey,
    localTime: localTimeKey,
    localTimeKey,
    date: localDateKey,
    time: formatDisplayTime(localTimeKey),
    timezone: business.timezone || DEFAULT_TIMEZONE,

    sourceType: "confirmed",
    confidence: 1,
    inventoryStatus: "active",
    status: "active",

    locationId: location.Id || getLocationId(business) || null,
    locationName: location.Name || "",
    address:
      [location.Address, location.Address2].filter(Boolean).join(", ") ||
      business.address ||
      "",
    latitude:
      location.Latitude !== undefined && location.Latitude !== null
        ? Number(location.Latitude)
        : business.latitude ?? null,
    longitude:
      location.Longitude !== undefined && location.Longitude !== null
        ? Number(location.Longitude)
        : business.longitude ?? null,

    sourceAvailabilityId: raw.Id || null,
    mindbodySessionTypeId: sessionType.Id || null,
    mindbodyBlockMinutes:
      sessionType.StaffTimeLength || sessionType.DefaultTimeLength || null,

    // These are availability-window boundaries, NOT the appointment end.
    bookableWindowEnd: raw.BookableEndDateTime || null,
    availabilityWindowEnd: raw.EndDateTime || null,

    scrapeStartDate: scrapeWindow.scrapeStartDate,
    scrapeEndDate: scrapeWindow.scrapeEndDate,
    lookaheadHours: scrapeWindow.lookaheadHours,
    daysForward: scrapeWindow.daysForward,
    scrapeWindowMode: scrapeWindow.scrapeWindowMode
  };
}

function dedupeAppointments(appointments = []) {
  const seen = new Set();
  const deduped = [];

  for (const appointment of appointments) {
    const key = [
      appointment.localDateKey || "",
      appointment.localTimeKey || "",
      appointment.providerId || appointment.providerName || "",
      appointment.platformServiceId || ""
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(appointment);
  }

  return deduped;
}

async function scrapeAustinDeepBusiness(business = {}) {
  const startedAt = Date.now();
  const scrapeWindow = getScrapeWindow(business);

  if (!scrapeWindow.dateList.length) {
    throw new Error(
      `Invalid Austin Deep scrape window: ${scrapeWindow.scrapeStartDate} to ${scrapeWindow.scrapeEndDate}`
    );
  }

  console.log(`\n[AUSTINDEEP] ${business.businessName} | ${business.serviceName}`);
  console.log("[AUSTINDEEP] Config:", {
    site: getSiteSlug(business),
    locationId: getLocationId(business),
    sessionTypeId: getSessionTypeId(business),
    scrapeStartDate: scrapeWindow.scrapeStartDate,
    scrapeEndDate: scrapeWindow.scrapeEndDate
  });

  const appointments = [];

  // Keep requests sequential and predictable. At the normal 48-hour window,
  // this is only two lightweight JSON calls per configured service.
  for (const date of scrapeWindow.dateList) {
    console.log(`[AUSTINDEEP] Checking ${date}`);

    const rows = await fetchAvailability(business, date);

    for (const row of rows) {
      const appointment = normalizeAvailability(row, business, scrapeWindow);
      if (appointment) appointments.push(appointment);
    }
  }

  const dedupedAppointments = dedupeAppointments(appointments);
  const times = dedupedAppointments.map((item) => item.startTime).filter(Boolean);

  return {
    businessName: business.businessName,
    bookingUrl: getBookingBaseUrl(business),
    platform: "austindeep",
    service: business.serviceName,
    serviceName: business.serviceName,
    serviceType: business.serviceType || "deep_tissue",
    durationMinutes: business.durationMinutes || null,
    platformServiceId: getSessionTypeId(business) || null,
    provider: "Any Available Therapist",
    date: null,
    times,
    status: dedupedAppointments.length > 0 ? "success" : "no_times_found",
    lastChecked: new Date().toISOString(),
    scrapeDurationMs: Date.now() - startedAt,
    appointments: dedupedAppointments,
    openings: dedupedAppointments,
    rawWidgetText: null,
    scrapeStartDate: scrapeWindow.scrapeStartDate,
    scrapeEndDate: scrapeWindow.scrapeEndDate,
    lookaheadHours: scrapeWindow.lookaheadHours,
    daysForward: scrapeWindow.daysForward,
    scrapeWindowMode: scrapeWindow.scrapeWindowMode
  };
}

module.exports = {
  scrapeAustinDeepBusiness,
  fetchAvailability,
  normalizeAvailability,
  buildAvailabilityUrl,
  getScrapeWindow
};