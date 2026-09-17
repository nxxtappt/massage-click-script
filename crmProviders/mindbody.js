"use strict";

const BASE_URL = "https://api.mindbodyonline.com/public/v6";
const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive ID.`);
  return number;
}

function normalizeInput(input = {}) {
  const siteId = String(input.siteId || "").trim();
  const apiKey = String(input.apiKey || "").trim();
  if (!/^-?\d+$/.test(siteId)) throw new Error("A numeric Mindbody Site ID is required.");
  if (!apiKey || apiKey.length > 4096) throw new Error("A valid Mindbody API key is required.");
  return {
    apiKey,
    siteId,
    locationId: positiveId(input.locationId, "Mindbody Location ID")
  };
}

function createRequestUrl(path, query = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) url.searchParams.append(key, String(item));
  }
  return url;
}

async function request(credentials, path, query = {}) {
  const url = createRequestUrl(path, query);
  const response = await fetch(url, {
    headers: { "Accept": "application/json", "Api-Key": credentials.apiKey,
      "SiteId": credentials.siteId },
    signal: AbortSignal.timeout(20000)
  });
  let data;
  try { data = await response.json(); } catch {
    throw new Error(`Mindbody ${path} returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    // Don't log upstream bodies: they may contain identifying or sensitive data.
    throw new Error(`Mindbody ${path} returned HTTP ${response.status}. Check key, Site ID, access and service mapping.`);
  }
  return data || {};
}

function availabilityList(data) {
  const items = data.Availabilities ?? data.availabilities;
  if (!Array.isArray(items)) throw new Error("Mindbody returned an invalid availability response.");
  return items;
}

function localDateTime(date, clock, timeZone) {
  const wall = Date.parse(`${date}T${clock}Z`);
  if (!Number.isFinite(wall)) throw new Error("Invalid Mindbody local date/time.");
  let instant = wall, suffix = "Z";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, timeZoneName: "shortOffset", hour: "numeric"
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    const offset = formatter.formatToParts(new Date(instant))
      .find((part) => part.type === "timeZoneName")?.value || "";
    const match = offset.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
    if (!match && offset !== "GMT") throw new Error("Business timezone must be a valid IANA timezone.");
    suffix = !match ? "Z" : `${match[1]}${String(match[2]).padStart(2, "0")}:${match[3] || "00"}`;
    const minutes = match ? (Number(match[2]) * 60 + Number(match[3] || 0)) * (match[1] === "+" ? 1 : -1) : 0;
    const next = wall - minutes * 60000;
    if (next === instant) return `${date}T${clock}${suffix}`;
    instant = next;
  }
  throw new Error("Mindbody local time falls in a timezone transition gap.");
}

function bookableQuery({ sessionTypeId, locationId, startDate, endDate, limit, offset,
  timeZone = "America/Chicago" }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("Availability dates must be YYYY-MM-DD.");
  }
  if (endDate < startDate) throw new Error("End date precedes start date.");
  return {
    "request.sessionTypeIds": [positiveId(sessionTypeId, "Mindbody Session Type ID")],
    "request.locationIds": [positiveId(locationId, "Mindbody Location ID")],
    "request.startDate": localDateTime(startDate, "00:00:00", timeZone),
    "request.endDate": localDateTime(endDate, "23:59:59", timeZone),
    "request.limit": limit,
    "request.offset": offset
  };
}

async function getBookableItems(credentials, options) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_LIMIT;
    const data = await request(credentials, "/appointment/bookableitems", bookableQuery({
      ...options, limit: PAGE_LIMIT, offset
    }));
    const items = availabilityList(data);
    all.push(...items);
    const total = Number(data.PaginationResponse?.TotalResults);
    if (!items.length || (Number.isFinite(total) && total >= 0 && offset + PAGE_LIMIT >= total)
      || (!Number.isFinite(total) && items.length < PAGE_LIMIT)) return all;
  }
  throw new Error("Mindbody returned more availability pages than the configured safe limit; narrow the sync window.");
}

async function verifyCredentials(credentials, { sessionTypeId, timeZone } = {}) {
  const data = await request(credentials, "/site/locations");
  const locations = data.Locations || data.locations || [];
  if (!Array.isArray(locations) || !locations.some((item) =>
    Number(item.Id ?? item.id) === credentials.locationId)) {
    throw new Error("The selected Mindbody Location ID is not visible to this key and Site ID.");
  }
  if (!sessionTypeId) {
    throw new Error("A mapped Mindbody session type is required before activating appointment inventory.");
  }
  const today = new Date().toISOString().slice(0, 10);
  const items = await request(credentials, "/appointment/bookableitems", bookableQuery({
    sessionTypeId, locationId: credentials.locationId,
    startDate: today, endDate: today, limit: 1, offset: 0, timeZone
  }));
  const availabilities = availabilityList(items);
  return { success: true, noOpenTimes: !availabilities.length,
    message: "Mindbody key, site, location and appointment endpoint verified. Zero slots can be normal for this date." };
}

module.exports = {
  provider: "mindbody",
  label: "Mindbody",
  fields: [
    { key: "apiKey", label: "API Key", type: "password", placeholder: "Paste API key" },
    { key: "siteId", label: "Site ID", type: "text", placeholder: "Example: 527423" },
    { key: "locationId", label: "Location ID", type: "text", placeholder: "Example: 1" }
  ],
  normalizeInput,
  verifyCredentials,
  getBookableItems,
  syncAppointments(options) {
    return require("../syncMindbodyBusiness").syncMindbodyBusiness(options);
  },
  bookableQuery,
  localDateTime,
  createRequestUrl
};
