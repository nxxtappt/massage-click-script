const { buildSearchIntent } = require("./searchIntentEngine");
const { getMarketplaceTimeZone } = require("./marketplaceMetros");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function localDateKey(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${map.year}-${map.month}-${map.day}`;
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(
    Date.UTC(year, month - 1, day + Number(days || 0), 12, 0, 0)
  );

  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate()
  )}`;
}

function toMinutes(hour, minute, ampm) {
  let value = Number(hour);
  const mins = Number(minute || 0);
  const suffix = String(ampm || "").toLowerCase();

  if (suffix === "pm" && value !== 12) value += 12;
  if (suffix === "am" && value === 12) value = 0;
  if (!Number.isFinite(value) || value < 0 || value > 23) return null;
  if (!Number.isFinite(mins) || mins < 0 || mins > 59) return null;

  return value * 60 + mins;
}

function minutesToKey(value) {
  const clamped = Math.max(
    0,
    Math.min(23 * 60 + 59, Number(value || 0))
  );

  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

function inferFriendlyTimeWindow(searchText = "") {
  const text = String(searchText || "").toLowerCase();

  const around = text.match(
    /\b(?:around|about|near|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
  );

  if (around) {
    const center = toMinutes(around[1], around[2], around[3]);

    if (center !== null) {
      return {
        startTimeKey: minutesToKey(center - 90),
        endTimeKey: minutesToKey(center + 90)
      };
    }
  }

  if (/\bmorning\b/.test(text)) {
    return { startTimeKey: "08:00", endTimeKey: "12:00" };
  }

  if (/\bafternoon\b/.test(text)) {
    return { startTimeKey: "12:00", endTimeKey: "17:00" };
  }

  if (/\bevening\b/.test(text)) {
    return { startTimeKey: "17:00", endTimeKey: "21:00" };
  }

  if (/\btonight\b/.test(text)) {
    return { startTimeKey: "17:00", endTimeKey: "23:59" };
  }

  return { startTimeKey: "", endTimeKey: "" };
}

function buildDefaultLabel({
  search,
  categorySlug,
  durationMinutes,
  metro
}) {
  const explicit = cleanText(search, 160);
  if (explicit) return explicit;

  const pieces = [];

  if (durationMinutes) pieces.push(`${durationMinutes} min`);
  if (categorySlug) pieces.push(categorySlug.replace(/-/g, " "));

  pieces.push("appointment");

  if (metro) {
    pieces.push(`in ${metro.replace(/-/g, " ")}`);
  }

  return pieces.join(" ");
}

function buildAlertFromSearch(body = {}) {
  const search = cleanText(body.search, 500);
  const metro = cleanText(body.metro, 120).toLowerCase();
  const categorySlug = cleanText(
    body.categorySlug || body.category,
    120
  ).toLowerCase();

  const timezone = getMarketplaceTimeZone(metro);

  const intent = buildSearchIntent({
    search,
    serviceCategory:
      body.serviceType ||
      body.serviceCategory ||
      "",
    durationMinutes: body.durationMinutes || ""
  });

  const friendlyTime = inferFriendlyTimeWindow(search);
  let targetDate = intent.targetDateKey || null;

  const normalizedSearch = search.toLowerCase();

  if (/\btomorrow\b/.test(normalizedSearch)) {
    targetDate = addDaysToDateKey(
      localDateKey(timezone),
      1
    );
  } else if (/\b(today|tonight)\b/.test(normalizedSearch)) {
    targetDate = localDateKey(timezone);
  }

  const startTime =
    intent.startTimeKey ||
    friendlyTime.startTimeKey ||
    null;

  const endTime =
    intent.endTimeKey ||
    friendlyTime.endTimeKey ||
    null;

  const durationMinutes =
    Number.isFinite(Number(intent.durationMinutes)) &&
    Number(intent.durationMinutes) > 0
      ? Number(intent.durationMinutes)
      : null;

  const serviceType =
    cleanText(
      body.serviceType ||
      intent.serviceCategory ||
      "",
      180
    ) || null;

  const radiusMiles = Number(body.radiusMiles);
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);

  return {
    label:
      cleanText(body.label, 180) ||
      buildDefaultLabel({
        search,
        categorySlug,
        durationMinutes,
        metro
      }),
    metro: metro || null,
    categorySlug: categorySlug || null,
    serviceType,
    durationMinutes,
    businessId: body.businessId || null,
    providerName:
      cleanText(body.providerName, 180) || null,
    targetDate,
    targetDateEnd:
      body.targetDateEnd ||
      targetDate,
    startTime,
    endTime,
    radiusMiles:
      Number.isFinite(radiusMiles) &&
      radiusMiles > 0
        ? radiusMiles
        : null,
    latitude:
      Number.isFinite(latitude)
        ? latitude
        : null,
    longitude:
      Number.isFinite(longitude)
        ? longitude
        : null,
    filters: {
      search,
      includeInferred:
        body.includeInferred !== false,
      createdFrom: "search"
    }
  };
}

module.exports = {
  buildAlertFromSearch,
  inferFriendlyTimeWindow
};