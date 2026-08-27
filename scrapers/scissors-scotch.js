// scrapers/scissors-scotch.js
// Direct API availability fetcher for Scissors & Scotch's public booking flow.

const API_URL = "https://scissorsscotch.com/new-book/api/availability/times";
const DEFAULT_TIMEZONE = "America/Chicago";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getTodayDateKey(timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateKey, daysToAdd) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(year, month - 1, day + Number(daysToAdd || 0), 12, 0, 0);

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getJobTimezone(job = {}) {
  return (
    job.timezone ||
    job.timeZone ||
    job.integrationConfig?.timezone ||
    job.integration?.config?.timezone ||
    DEFAULT_TIMEZONE
  );
}

function buildDateList(job = {}) {
  const timeZone = getJobTimezone(job);
  const startDate = job.scrapeStartDate || job.date || getTodayDateKey(timeZone);

  if (job.scrapeEndDate) {
    const dates = [];
    let current = startDate;
    let guard = 0;

    while (current <= job.scrapeEndDate && guard < 31) {
      dates.push(current);
      current = addDays(current, 1);
      guard += 1;
    }

    return dates;
  }

  const daysForward = Math.max(1, Number(job.daysForward || 1));
  return Array.from({ length: daysForward }, (_, index) => addDays(startDate, index));
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function getVariationIds(job = {}) {
  const direct = firstDefined(
    job.variationIds,
    job.variation_ids,
    job.serviceConfig?.variationIds,
    job.serviceConfig?.variation_ids
  );

  if (Array.isArray(direct)) {
    return direct.map(Number).filter(Number.isFinite);
  }

  const single = firstDefined(
    job.variationId,
    job.variation_id,
    job.platformServiceId,
    job.serviceId,
    job.serviceButtonId,
    job.serviceConfig?.variationId,
    job.serviceConfig?.variation_id,
    job.serviceConfig?.platformServiceId,
    job.serviceConfig?.serviceId
  );

  if (single === null) {
    return [];
  }

  const number = Number(single);
  return Number.isFinite(number) ? [number] : [];
}

function getLocationId(job = {}) {
  const value = firstDefined(
    job.locationId,
    job.location_id,
    job.bookingLocationId,
    job.platformLocationId,
    job.integrationConfig?.locationId,
    job.integrationConfig?.location_id,
    job.integration?.config?.locationId,
    job.integration?.config?.location_id
  );

  if (value === null) return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getOwner(job = {}) {
  return String(
    firstDefined(
      job.owner,
      job.ownerId,
      job.owner_id,
      job.bookingOwner,
      job.integrationConfig?.owner,
      job.integrationConfig?.ownerId,
      job.integration?.config?.owner,
      job.integration?.config?.ownerId
    ) || ""
  ).trim();
}

function findFirstArray(value, depth = 0) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object" || depth > 3) {
    return [];
  }

  const preferredKeys = [
    "times",
    "availability",
    "slots",
    "appointments",
    "results",
    "data"
  ];

  for (const key of preferredKeys) {
    if (!(key in value)) continue;

    const found = findFirstArray(value[key], depth + 1);
    if (found.length || Array.isArray(value[key])) {
      return found;
    }
  }

  for (const nested of Object.values(value)) {
    const found = findFirstArray(nested, depth + 1);
    if (found.length) {
      return found;
    }
  }

  return [];
}

function getRawStart(slot = {}) {
  return firstDefined(
    slot.begin_at,
    slot.beginAt,
    slot.start_at,
    slot.startAt,
    slot.start_time,
    slot.startTime,
    slot.datetime,
    slot.dateTime,
    slot.time
  );
}

function getEmployeeId(slot = {}) {
  return firstDefined(
    slot.employee_id,
    slot.employeeId,
    slot.staff_id,
    slot.staffId,
    slot.provider_id,
    slot.providerId,
    slot.employee?.id,
    slot.staff?.id,
    slot.provider?.id
  );
}

function getEmployeeName(slot = {}) {
  return String(
    firstDefined(
      slot.employee_name,
      slot.employeeName,
      slot.staff_name,
      slot.staffName,
      slot.provider_name,
      slot.providerName,
      slot.employee?.name,
      slot.staff?.name,
      slot.provider?.name
    ) || ""
  ).trim();
}

function getDuration(slot = {}, job = {}) {
  const value = firstDefined(
    slot.duration,
    slot.duration_minutes,
    slot.durationMinutes,
    job.durationMinutes
  );

  if (value === null) return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getZonedDateTimeParts(rawStart, timeZone = DEFAULT_TIMEZONE) {
  if (!rawStart) return null;

  const parsed = new Date(rawStart);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(parsed);

  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  let hour = Number(map.hour);
  if (hour === 24) hour = 0;

  const minute = Number(map.minute);
  const localDateKey = `${map.year}-${map.month}-${map.day}`;
  const localTimeKey = `${pad2(hour)}:${pad2(minute)}`;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;

  return {
    localDateKey,
    localTimeKey,
    displayTime: `${displayHour}:${pad2(minute)} ${suffix}`
  };
}

function normalizeSlots(json, job = {}, requestedDate = "") {
  const timeZone = getJobTimezone(job);
  const rows = findFirstArray(json).filter((row) => row && typeof row === "object");
  const byStart = new Map();

  for (const slot of rows) {
    const rawStart = getRawStart(slot);
    if (!rawStart) continue;

    const zoned = getZonedDateTimeParts(rawStart, timeZone);
    const dateFallback = String(firstDefined(slot.date, requestedDate) || "");

    const localDateKey = zoned?.localDateKey || dateFallback;
    const localTimeKey = zoned?.localTimeKey || "";
    const displayTime = zoned?.displayTime || String(rawStart);
    const employeeId = getEmployeeId(slot);
    const employeeName = getEmployeeName(slot);
    const key = `${rawStart}|${getDuration(slot, job) || ""}`;

    if (!byStart.has(key)) {
      byStart.set(key, {
        date: localDateKey,
        time: displayTime,
        startTime: String(rawStart),
        appointmentStart: String(rawStart),
        localDateKey,
        localTimeKey,
        serviceName: job.serviceName || "",
        serviceType: job.serviceType || "hair",
        durationMinutes: getDuration(slot, job),
        providerName: employeeName || "Any Available Professional",
        therapistName: employeeName || "Any Available Professional",
        bookingUrl: job.bookingUrl || "https://scissorsscotch.com/new-book",
        platform: "scissors-scotch",
        platformProviderId: employeeId || null,
        employeeId: employeeId || null,
        availableEmployeeIds: employeeId ? [employeeId] : [],
        rawJson: slot
      });

      continue;
    }

    const existing = byStart.get(key);

    if (employeeId && !existing.availableEmployeeIds.includes(employeeId)) {
      existing.availableEmployeeIds.push(employeeId);
    }

    if (existing.availableEmployeeIds.length > 1) {
      existing.providerName = "Any Available Professional";
      existing.therapistName = "Any Available Professional";
      existing.platformProviderId = null;
      existing.employeeId = null;
    }
  }

  return [...byStart.values()].sort((a, b) => {
    return String(a.startTime).localeCompare(String(b.startTime));
  });
}

async function fetchScissorsScotchTimesForDate(job = {}, dateKey) {
  const locationId = getLocationId(job);
  const variationIds = getVariationIds(job);
  const owner = getOwner(job);

  if (!locationId) {
    throw new Error("Scissors & Scotch locationId is required.");
  }

  if (!variationIds.length) {
    throw new Error("Scissors & Scotch variationId/platformServiceId is required.");
  }

  if (!owner) {
    throw new Error(
      "Scissors & Scotch owner is required. Capture it from the availability/times request or make it discoverable before scraping."
    );
  }

  const payload = {
    location_id: locationId,
    variation_ids: variationIds,
    date: dateKey,
    owner
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: "https://scissorsscotch.com",
      Referer: job.bookingUrl || "https://scissorsscotch.com/new-book/service",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
      ...(job.cookie ? { Cookie: job.cookie } : {}),
      ...(job.headers && typeof job.headers === "object" ? job.headers : {})
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : [];
  } catch {
    throw new Error(
      `Scissors & Scotch API returned non-JSON (${response.status}): ${text.slice(0, 500)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Scissors & Scotch API failed ${response.status}: ${JSON.stringify(json).slice(0, 800)}`
    );
  }

  return {
    payload,
    json,
    appointments: normalizeSlots(json, job, dateKey)
  };
}

async function scrapeScissorsScotchBusiness(job = {}) {
  const startedAt = Date.now();
  const dates = buildDateList(job);
  const appointments = [];
  const requestPayloads = [];

  for (const dateKey of dates) {
    const result = await fetchScissorsScotchTimesForDate(job, dateKey);
    requestPayloads.push(result.payload);
    appointments.push(...result.appointments);
  }

  const deduped = [];
  const seen = new Set();

  for (const appointment of appointments) {
    const key = `${appointment.startTime}|${appointment.durationMinutes || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(appointment);
  }

  return {
    businessName: job.businessName || "Scissors & Scotch",
    bookingUrl: job.bookingUrl || "https://scissorsscotch.com/new-book",
    platform: "scissors-scotch",
    service: job.serviceName || "",
    serviceName: job.serviceName || "",
    serviceType: job.serviceType || "hair",
    durationMinutes: job.durationMinutes || null,
    platformServiceId:
      job.platformServiceId || job.serviceId || job.variationId || getVariationIds(job)[0] || null,
    provider: "Any Available Professional",
    date: null,
    times: deduped.map((appointment) => appointment.startTime),
    status: deduped.length > 0 ? "success" : "no_times_found",
    error: null,
    scrapeDurationMs: Date.now() - startedAt,
    lastChecked: new Date().toISOString(),
    appointments: deduped,
    requestPayloads,
    rawWidgetText: null
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const result = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;

    const [rawKey, ...rest] = arg.slice(2).split("=");
    const rawValue = rest.join("=");
    result[rawKey] = rawValue === "" ? true : rawValue;
  }

  if (result.locationId) result.locationId = Number(result.locationId);
  if (result.variationId) result.variationId = Number(result.variationId);
  if (result.durationMinutes) result.durationMinutes = Number(result.durationMinutes);
  if (result.daysForward) result.daysForward = Number(result.daysForward);

  return result;
}

async function runCli() {
  const args = parseCliArgs();

  const result = await scrapeScissorsScotchBusiness({
    businessName: args.businessName || "Scissors & Scotch",
    bookingUrl: args.bookingUrl || "https://scissorsscotch.com/new-book",
    serviceName: args.serviceName || "Test Service",
    serviceType: args.serviceType || "hair",
    durationMinutes: args.durationMinutes || null,
    locationId: args.locationId,
    variationId: args.variationId,
    owner: args.owner,
    scrapeStartDate: args.date || args.scrapeStartDate,
    daysForward: args.daysForward || 1,
    timezone: args.timezone || DEFAULT_TIMEZONE
  });

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error("\nSCISSORS & SCOTCH TEST FAILED:");
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  scrapeScissorsScotchBusiness,
  fetchScissorsScotchTimesForDate,
  normalizeSlots,
  buildDateList,
  getVariationIds,
  getLocationId,
  getOwner,
  getJobTimezone
};