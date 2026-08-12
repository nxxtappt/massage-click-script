const DEFAULT_TIMEZONE = "America/Chicago";

const SQUARE_AVAILABILITY_URL =
  "https://app.squareup.com/appointments/api/buyer/availability";

const DEFAULT_HEADERS = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  "user-agent":
    "Mozilla/5.0 (compatible; NextAppt/1.0; +https://nextappt.ai)"
};


const NEXTAPPT_SQUARE_SCRAPER_VERSION = "5.0.0";

function sanitizeSquareUrl(value = "") {
  let raw = String(value || "").trim();

  if (!raw) return "";

  // Copying URLs from rendered chat/markdown can produce [url](url) or
  // escaped underscores. Normalize those before URL parsing/navigation.
  raw = raw.replace(/\\_/g, "_");

  const markdownMatch = raw.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/i);
  if (markdownMatch) {
    raw = markdownMatch[1];
  }

  raw = raw.replace(/^<|>$/g, "").trim();
  return raw;
}

function parseSquareBookingUrl(value = "") {
  const urlText = sanitizeSquareUrl(value);

  const result = {
    url: urlText,
    isDirectBooking: false,
    bookingBusinessId: "",
    locationId: "",
    routeType: ""
  };

  if (!urlText) return result;

  try {
    const parsed = new URL(urlText);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    const directMatch = pathname.match(
      /\/appointments\/([^/]+)\/location\/([^/]+)(?:\/|$)/i
    );

    if (
      directMatch &&
      (hostname === "book.squareup.com" ||
        hostname === "app.squareup.com" ||
        hostname.endsWith(".squareup.com"))
    ) {
      result.isDirectBooking = true;
      result.bookingBusinessId = decodeURIComponent(directMatch[1]);
      result.locationId = decodeURIComponent(directMatch[2]);
      result.routeType = "book_squareup_appointments";
      return result;
    }

    const buyerStartMatch = pathname.match(
      /\/appointments\/book\/([^/]+)\/start(?:\/|$)/i
    );

    if (
      buyerStartMatch &&
      (hostname === "app.squareup.com" ||
        hostname === "book.squareup.com")
    ) {
      result.isDirectBooking = true;
      result.locationId = decodeURIComponent(buyerStartMatch[1]);
      result.routeType = "square_buyer_start";
      return result;
    }

    const legacyBookMatch = pathname.match(/^\/book\/([^/]+)(?:\/|$)/i);

    if (
      legacyBookMatch &&
      (hostname === "square.site" || hostname.endsWith(".square.site"))
    ) {
      result.isDirectBooking = true;
      result.locationId = decodeURIComponent(legacyBookMatch[1]);
      result.routeType = "square_site_book";
      return result;
    }
  } catch {
    // Leave the default empty parse result.
  }

  return result;
}

function getSquareConfigSources(target = {}) {
  const integrations = Array.isArray(target.integrations)
    ? target.integrations
    : [];

  const matchingIntegrations = integrations.filter((integration) => {
    const text = normalizeText(
      [
        integration?.platform,
        integration?.provider,
        integration?.name,
        integration?.type,
        integration?.integrationType,
        integration?.integration_type
      ]
        .filter(Boolean)
        .join(" ")
    );

    return text.includes("square");
  });

  const primarySources = [
    target,
    target.integrationConfig,
    target.integration_config,
    target.primaryIntegration,
    target.primary_integration,
    target.square,
    target.squareConfig,
    target.square_config,
    target.integration,
    ...matchingIntegrations
  ].filter((value) => value && typeof value === "object");

  const nestedSources = [];

  for (const source of primarySources) {
    for (const key of [
      "config",
      "settings",
      "metadata",
      "rawJson",
      "raw_json",
      "square",
      "squareConfig",
      "square_config"
    ]) {
      const nested = source?.[key];

      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        nestedSources.push(nested);
      }
    }
  }

  return [...primarySources, ...nestedSources];
}

function getSquareField(target = {}, aliases = [], fallback = "") {
  const names = Array.isArray(aliases) ? aliases : [aliases];

  for (const source of getSquareConfigSources(target)) {
    for (const name of names) {
      if (
        source[name] !== undefined &&
        source[name] !== null &&
        source[name] !== ""
      ) {
        return source[name];
      }
    }
  }

  return fallback;
}

function normalizeSquareTarget(input = {}) {
  const target = { ...input };

  const bookingUrl = sanitizeSquareUrl(
    getSquareField(target, ["bookingUrl", "booking_url"], target.bookingUrl || "")
  );

  const parsedBookingUrl = parseSquareBookingUrl(bookingUrl);

  const squareSiteUrl = sanitizeSquareUrl(
    getSquareField(target, [
      "squareSiteUrl",
      "square_site_url",
      "squareWebsiteUrl",
      "square_website_url"
    ])
  );

  const squareSyncBase = sanitizeSquareUrl(
    getSquareField(target, ["squareSyncBase", "square_sync_base"])
  );

  const explicitLocationId = String(
    getSquareField(target, [
      "squareLocationId",
      "square_location_id",
      "locationId",
      "location_id",
      "unitToken",
      "unit_token"
    ], "")
  );

  const explicitBookingBusinessId = String(
    getSquareField(target, [
      "squareBookingBusinessId",
      "square_booking_business_id",
      "bookingBusinessId",
      "booking_business_id"
    ], "")
  );

  return {
    ...target,
    bookingUrl,
    squareSiteUrl,
    squareSyncBase,
    squareBookingBusinessId:
      explicitBookingBusinessId || parsedBookingUrl.bookingBusinessId || "",
    squarePublishedUserId: String(
      getSquareField(target, [
        "squarePublishedUserId",
        "square_published_user_id",
        "publishedUserId",
        "published_user_id"
      ], "")
    ),
    squareSiteId: String(
      getSquareField(target, [
        "squareSiteId",
        "square_site_id",
        "siteId",
        "site_id"
      ], "")
    ),
    squareLocationId:
      explicitLocationId || parsedBookingUrl.locationId || "",
    squareServiceVariationId: String(
      getSquareField(target, [
        "squareServiceVariationId",
        "square_service_variation_id",
        "serviceVariationId",
        "service_variation_id",
        "platformServiceVariationId",
        "platform_service_variation_id"
      ], target.squareServiceVariationId || "")
    )
  };
}

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function addDaysToDateKey(dateKey, daysToAdd = 0) {
  if (!isDateKey(dateKey)) {
    return "";
  }

  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + Number(daysToAdd || 0), 12));

  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate())
  ].join("-");
}

function getDateKeyInTimeZone(timeZone = DEFAULT_TIMEZONE) {
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

function getTimeZoneOffsetMinutes(dateKey, timeZone = DEFAULT_TIMEZONE) {
  if (!isDateKey(dateKey)) {
    return 0;
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const utcProbe = Date.UTC(year, month - 1, day, 12, 0, 0);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(utcProbe));

  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  const representedAsUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  return Math.round((representedAsUtc - utcProbe) / 60000);
}

function formatOffset(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;

  return `${sign}${pad2(hours)}:${pad2(minutes)}`;
}

function buildSquareRangeTimestamp(
  dateKey,
  { timeZone = DEFAULT_TIMEZONE, endOfDay = false } = {}
) {
  const offset = formatOffset(getTimeZoneOffsetMinutes(dateKey, timeZone));

  return endOfDay
    ? `${dateKey}T23:59:59.999${offset}`
    : `${dateKey}T00:00:00.000${offset}`;
}

function getLocalPartsFromDate(date, timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return {
    localDateKey: `${map.year}-${map.month}-${map.day}`,
    localTimeKey: `${map.hour}:${map.minute}`
  };
}

function formatDisplayTime(date, timeZone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatDisplayDate(date, timeZone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function getDaysBetweenDateKeys(startDateKey, endDateKey) {
  if (!isDateKey(startDateKey) || !isDateKey(endDateKey)) {
    return null;
  }

  const [sy, sm, sd] = startDateKey.split("-").map(Number);
  const [ey, em, ed] = endDateKey.split("-").map(Number);

  const start = Date.UTC(sy, sm - 1, sd, 12, 0, 0);
  const end = Date.UTC(ey, em - 1, ed, 12, 0, 0);

  return Math.floor((end - start) / 86400000);
}

function resolveScrapeWindow(target = {}) {
  const timeZone = target.timezone || DEFAULT_TIMEZONE;
  const today = getDateKeyInTimeZone(timeZone);

  const startDate = target.scrapeStartDate || target.startDate || today;
  let endDate = target.scrapeEndDate || target.endDate || "";

  if (!isDateKey(endDate)) {
    const requestedDaysForward = Math.max(
      1,
      Number(
        target.daysForward ||
          (target.lookaheadHours
            ? Math.ceil(Number(target.lookaheadHours) / 24)
            : 2)
      )
    );

    const daysForward = Math.min(31, requestedDaysForward);
    endDate = addDaysToDateKey(startDate, daysForward - 1);
  }

  if (!isDateKey(startDate) || !isDateKey(endDate)) {
    throw new Error(
      `Invalid Square scrape date window: ${startDate || "(missing)"} to ${endDate || "(missing)"}`
    );
  }

  const inclusiveSpan = getDaysBetweenDateKeys(startDate, endDate);

  if (inclusiveSpan === null || inclusiveSpan < 0) {
    throw new Error(`Invalid Square scrape date order: ${startDate} to ${endDate}`);
  }

  // SearchAvailability uses an exclusive end. Cap the request to 31 days so
  // both the public buyer flow and Square's documented API constraints stay safe.
  if (inclusiveSpan + 1 > 31) {
    endDate = addDaysToDateKey(startDate, 30);
  }

  const exclusiveEndDate = addDaysToDateKey(endDate, 1);

  return {
    timeZone,
    startDate,
    endDate,
    startAt: buildSquareRangeTimestamp(startDate, {
      timeZone,
      endOfDay: false
    }),
    endAt: buildSquareRangeTimestamp(exclusiveEndDate, {
      timeZone,
      endOfDay: false
    })
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  if (typeof fetch !== "function") {
    throw new Error(
      "Global fetch() is unavailable. Square direct scraping requires Node 18+."
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: "follow"
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`Square request timed out after ${timeoutMs}ms: ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(
    url,
    {
      ...options,
      headers: cleanHeaders({
        ...DEFAULT_HEADERS,
        ...(options.headers || {})
      })
    },
    Number(options.timeoutMs || 20000)
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Square request failed ${response.status} ${response.statusText}: ${url}\n${text.slice(0, 500)}`
    );
  }

  return { response, text };
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(
    url,
    {
      ...options,
      headers: cleanHeaders({
        ...DEFAULT_HEADERS,
        ...(options.headers || {})
      })
    },
    Number(options.timeoutMs || 20000)
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Square request failed ${response.status} ${response.statusText}: ${url}\n${text.slice(0, 1000)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Square returned non-JSON data from ${url}: ${text.slice(0, 500)}`
    );
  }
}

function getSquareSiteOrigin(target = {}) {
  const candidates = [
    getSquareField(target, ["squareSiteOrigin", "square_site_origin"]),
    getSquareField(target, ["squareSiteUrl", "square_site_url"]),
    getSquareField(target, ["squareWebsiteUrl", "square_website_url"]),
    target.website,
    target.businessWebsite,
    target.bookingUrl,
    target.url
  ]
    .map(sanitizeSquareUrl)
    .filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);

      if (
        parsed.hostname === "square.site" ||
        parsed.hostname.endsWith(".square.site")
      ) {
        return parsed.origin;
      }
    } catch {
      // Ignore malformed candidate URLs.
    }
  }

  return "";
}

function normalizeHtmlForDiscovery(html = "") {
  return String(html || "")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function findPublishedIdsInText(text = "") {
  const normalized = normalizeHtmlForDiscovery(text);

  const directPatterns = [
    /\/app\/square-sync\/published\/users\/(\d+)\/site\/(\d+)\/appointments/i,
    /square-sync\/published\/users\/(\d+)\/site\/(\d+)/i,
    /published\/users\/(\d+)\/site\/(\d+)/i
  ];

  for (const pattern of directPatterns) {
    const match = normalized.match(pattern);

    if (match) {
      return {
        publishedUserId: match[1],
        siteId: match[2]
      };
    }
  }

  const userPatterns = [
    /["']publishedUserId["']\s*:\s*["']?(\d+)["']?/i,
    /["']published_user_id["']\s*:\s*["']?(\d+)["']?/i,
    /["']userId["']\s*:\s*["']?(\d{6,})["']?/i,
    /["']user_id["']\s*:\s*["']?(\d{6,})["']?/i
  ];

  const sitePatterns = [
    /["']siteId["']\s*:\s*["']?(\d{6,})["']?/i,
    /["']site_id["']\s*:\s*["']?(\d{6,})["']?/i
  ];

  let publishedUserId = "";
  let siteId = "";

  for (const pattern of userPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      publishedUserId = match[1];
      break;
    }
  }

  for (const pattern of sitePatterns) {
    const match = normalized.match(pattern);
    if (match) {
      siteId = match[1];
      break;
    }
  }

  if (publishedUserId && siteId) {
    return { publishedUserId, siteId };
  }

  return null;
}

async function discoverSquareContext(target = {}) {
  target = normalizeSquareTarget(target);

  const parsedBookingUrl = parseSquareBookingUrl(target.bookingUrl);

  const explicitSyncBase = sanitizeSquareUrl(
    getSquareField(
      target,
      ["squareSyncBase", "square_sync_base"],
      target.squareSyncBase
    )
  );

  if (explicitSyncBase) {
    const base = explicitSyncBase.replace(/\/+$/, "");

    return {
      squareSiteOrigin:
        getSquareField(target, ["squareSiteOrigin", "square_site_origin"]) ||
        getSquareSiteOrigin(target) ||
        "",
      publishedUserId: target.squarePublishedUserId || "",
      siteId: target.squareSiteId || "",
      syncBase: base,
      bookingBusinessId:
        target.squareBookingBusinessId || parsedBookingUrl.bookingBusinessId || "",
      locationId:
        target.squareLocationId || parsedBookingUrl.locationId || "",
      directBookingUrl: target.bookingUrl || "",
      discoveryMethod: "explicit_sync_base"
    };
  }

  const squareSiteOrigin =
    getSquareField(target, ["squareSiteOrigin", "square_site_origin"]) ||
    getSquareSiteOrigin(target);

  const explicitUserId = target.squarePublishedUserId || "";
  const explicitSiteId = target.squareSiteId || "";

  if (squareSiteOrigin && explicitUserId && explicitSiteId) {
    return {
      squareSiteOrigin,
      publishedUserId: String(explicitUserId),
      siteId: String(explicitSiteId),
      syncBase:
        `${squareSiteOrigin}/app/square-sync/published/users/` +
        `${explicitUserId}/site/${explicitSiteId}/appointments`,
      bookingBusinessId:
        target.squareBookingBusinessId || parsedBookingUrl.bookingBusinessId || "",
      locationId:
        target.squareLocationId || parsedBookingUrl.locationId || "",
      directBookingUrl: target.bookingUrl || "",
      discoveryMethod: "explicit_ids"
    };
  }

  if (parsedBookingUrl.isDirectBooking) {
    return {
      squareSiteOrigin: "",
      publishedUserId: "",
      siteId: "",
      syncBase: "",
      bookingBusinessId:
        target.squareBookingBusinessId || parsedBookingUrl.bookingBusinessId || "",
      locationId:
        target.squareLocationId || parsedBookingUrl.locationId || "",
      directBookingUrl: target.bookingUrl || parsedBookingUrl.url || "",
      directRouteType: parsedBookingUrl.routeType || "",
      discoveryMethod: "direct_booking"
    };
  }

  if (!squareSiteOrigin) {
    throw new Error(
      "Square scraper could not determine a usable booking discovery path. " +
        "Save a public Square Booking URL. For Square Online sites you may also " +
        "save squareSiteUrl plus squarePublishedUserId/squareSiteId."
    );
  }

  const { text } = await fetchText(`${squareSiteOrigin}/`, {
    headers: {
      accept: "text/html,application/xhtml+xml"
    }
  });

  const discovered = findPublishedIdsInText(text);

  if (!discovered) {
    throw new Error(
      "Square site loaded, but published user/site IDs were not discoverable from HTML. " +
        "If this merchant has a book.squareup.com appointment URL, save that as Booking URL. " +
        "Otherwise save squarePublishedUserId and squareSiteId on the business integration. " +
        `Square site: ${squareSiteOrigin}`
    );
  }

  return {
    squareSiteOrigin,
    ...discovered,
    syncBase:
      `${squareSiteOrigin}/app/square-sync/published/users/` +
      `${discovered.publishedUserId}/site/${discovered.siteId}/appointments`,
    bookingBusinessId: target.squareBookingBusinessId || "",
    locationId: target.squareLocationId || "",
    directBookingUrl: target.bookingUrl || "",
    discoveryMethod: "square_site_html"
  };
}

function collectCatalogItems(payload) {
  const items = [];
  const visited = new Set();

  function walk(value) {
    if (!value || typeof value !== "object") {
      return;
    }

    if (visited.has(value)) {
      return;
    }

    visited.add(value);

    if (
      value.type === "ITEM" &&
      value.item_data &&
      value.item_data.product_type === "APPOINTMENTS_SERVICE"
    ) {
      items.push(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }

    for (const child of Object.values(value)) {
      walk(child);
    }
  }

  walk(payload);

  const byId = new Map();

  for (const item of items) {
    if (item?.id && !byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }

  return [...byId.values()];
}

function normalizeSquareServices(payload) {
  const items = collectCatalogItems(payload);
  const services = [];

  for (const item of items) {
    const itemData = item.item_data || {};
    const variations = Array.isArray(itemData.variations)
      ? itemData.variations
      : [];

    for (const variation of variations) {
      const variationData = variation.item_variation_data || {};

      if (
        variation.is_deleted === true ||
        variationData.available_for_booking === false
      ) {
        continue;
      }

      const durationMs = toNumberOrNull(variationData.service_duration);
      const priceAmount = toNumberOrNull(variationData.price_money?.amount);
      const transitionMs = toNumberOrNull(variationData.transition_time);

      services.push({
        itemId: item.id || variationData.item_id || "",
        variationId: variation.id || "",
        serviceName: itemData.name || "",
        variationName: variationData.name || "",
        description:
          itemData.description_plaintext || itemData.description || "",
        durationMinutes:
          durationMs !== null ? Math.round(durationMs / 60000) : null,
        priceAmount:
          priceAmount !== null ? priceAmount / 100 : null,
        currency: variationData.price_money?.currency || "",
        priceDescription: variationData.price_description || "",
        teamMemberIds: unique(variationData.team_member_ids || []),
        transitionTimeMinutes:
          transitionMs !== null ? Math.round(transitionMs / 60000) : null,
        availableForBooking: variationData.available_for_booking !== false,
        rawItem: item,
        rawVariation: variation
      });
    }
  }

  return services;
}

function normalizeStaffProfiles(payload) {
  const profiles = Array.isArray(payload?.team_member_booking_profiles)
    ? payload.team_member_booking_profiles
    : [];

  return profiles
    .filter((profile) => profile && profile.is_bookable !== false)
    .map((profile) => ({
      teamMemberId: profile.team_member_id || "",
      displayName: String(profile.display_name || "").trim(),
      description: profile.description || "",
      profileImageUrl: profile.profile_image_url || "",
      isBookable: profile.is_bookable !== false
    }));
}

function resolveLocationId(locationsPayload, target = {}) {
  const explicit = getSquareField(target, [
    "squareLocationId",
    "square_location_id",
    "locationId",
    "location_id",
    "unitToken",
    "unit_token"
  ]);

  if (explicit) {
    return String(explicit);
  }

  const locations = Array.isArray(locationsPayload)
    ? locationsPayload
    : Array.isArray(locationsPayload?.locations)
      ? locationsPayload.locations
      : [];

  const first = locations.find(
    (location) =>
      location &&
      (location.square_id || location.location_id || location.id)
  );

  return String(first?.square_id || first?.location_id || first?.id || "");
}

function scoreServiceMatch(service, target = {}) {
  let score = 0;

  const targetIds = unique([
    target.squareServiceVariationId,
    target.serviceVariationId,
    target.platformServiceVariationId,
    target.platformServiceId,
    target.serviceButtonId,
    target.serviceId
  ]).map(String);

  if (targetIds.includes(String(service.variationId))) {
    score += 1000;
  }

  if (targetIds.includes(String(service.itemId))) {
    score += 700;
  }

  const targetName = normalizeText(target.serviceName || target.service || "");
  const serviceName = normalizeText(service.serviceName);
  const variationName = normalizeText(service.variationName);

  if (targetName && serviceName === targetName) {
    score += 500;
  } else if (
    targetName &&
    serviceName &&
    (serviceName.includes(targetName) || targetName.includes(serviceName))
  ) {
    score += 250;
  }

  if (
    targetName &&
    variationName &&
    (variationName === targetName || targetName.includes(variationName))
  ) {
    score += 100;
  }

  const targetDuration = toNumberOrNull(target.durationMinutes);

  if (
    targetDuration !== null &&
    service.durationMinutes === targetDuration
  ) {
    score += 180;
  }

  if (service.availableForBooking) {
    score += 10;
  }

  return score;
}

function selectSquareService(services = [], target = {}) {
  if (!Array.isArray(services) || services.length === 0) {
    return null;
  }

  const configuredIds = unique([
    getSquareField(target, [
      "squareServiceVariationId",
      "square_service_variation_id",
      "serviceVariationId",
      "service_variation_id",
      "platformServiceVariationId",
      "platform_service_variation_id"
    ]),
    target.platformServiceId,
    target.serviceButtonId,
    target.serviceId
  ])
    .filter(Boolean)
    .map(String);

  const exactVariation = services.filter((service) =>
    configuredIds.includes(String(service.variationId))
  );

  if (exactVariation.length === 1) {
    return exactVariation[0];
  }

  const exactItems = services.filter((service) =>
    configuredIds.includes(String(service.itemId))
  );

  if (exactItems.length === 1) {
    return exactItems[0];
  }

  const duration = toNumberOrNull(target.durationMinutes);

  if (exactItems.length > 1 && duration !== null) {
    const durationMatches = exactItems.filter(
      (service) => service.durationMinutes === duration
    );

    if (durationMatches.length === 1) {
      return durationMatches[0];
    }
  }

  const targetName = normalizeText(target.serviceName || target.service || "");

  if (targetName) {
    let nameMatches = services.filter(
      (service) => normalizeText(service.serviceName) === targetName
    );

    if (duration !== null) {
      const durationMatches = nameMatches.filter(
        (service) => service.durationMinutes === duration
      );

      if (durationMatches.length === 1) {
        return durationMatches[0];
      }
    }

    if (nameMatches.length === 1) {
      return nameMatches[0];
    }
  }

  const ranked = services
    .map((service) => ({
      service,
      score: scoreServiceMatch(service, target)
    }))
    .sort((a, b) => b.score - a.score);

  if (!ranked[0] || ranked[0].score <= 10) {
    return null;
  }

  // If two variations are essentially tied, do not silently scrape the wrong
  // service. Store the variation ID (preferred) or a unique duration in DB.
  if (
    ranked[1] &&
    ranked[0].score === ranked[1].score &&
    ranked[0].service.variationId !== ranked[1].service.variationId
  ) {
    const choices = ranked
      .slice(0, 5)
      .map(({ service }) =>
        `${service.serviceName} / ${service.variationName} ` +
        `(${service.durationMinutes || "?"} min, variation ${service.variationId})`
      )
      .join("; ");

    throw new Error(
      `Square service mapping is ambiguous. Save the exact variation ID or duration. Candidates: ${choices}`
    );
  }

  return ranked[0].service;
}

function buildPriceDisplay(service = {}) {
  if (service.priceAmount === null || service.priceAmount === undefined) {
    return null;
  }

  const currency = service.currency || "USD";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: Number.isInteger(service.priceAmount) ? 0 : 2
    }).format(service.priceAmount);
  } catch {
    return `$${service.priceAmount}`;
  }
}

async function fetchSquareDiscoveryData(context, target = {}) {
  const locationsUrl = `${context.syncBase}/locations`;
  const locations = await fetchJson(locationsUrl, {
    headers: {
      origin: context.squareSiteOrigin || undefined,
      referer: context.squareSiteOrigin
        ? `${context.squareSiteOrigin}/`
        : undefined
    }
  });

  const locationId = resolveLocationId(locations, target);

  if (!locationId) {
    throw new Error(
      "Square locations endpoint returned no usable Square location ID."
    );
  }

  const servicesUrl =
    `${context.syncBase}/services/${encodeURIComponent(locationId)}` +
    "?return_bookable=true";

  const staffUrl =
    `${context.syncBase}/staff-members/${encodeURIComponent(locationId)}`;

  const [servicesPayload, staffPayload] = await Promise.all([
    fetchJson(servicesUrl, {
      headers: {
        origin: context.squareSiteOrigin || undefined,
        referer: context.squareSiteOrigin
          ? `${context.squareSiteOrigin}/`
          : undefined
      }
    }),
    fetchJson(staffUrl, {
      headers: {
        origin: context.squareSiteOrigin || undefined,
        referer: context.squareSiteOrigin
          ? `${context.squareSiteOrigin}/`
          : undefined
      }
    }).catch((error) => {
      console.warn(
        "[SQUARE] Staff discovery failed; availability can still continue:",
        error.message
      );

      return { team_member_booking_profiles: [] };
    })
  ]);

  return {
    locationId,
    locations,
    servicesPayload,
    services: normalizeSquareServices(servicesPayload),
    staffPayload,
    staff: normalizeStaffProfiles(staffPayload),
    urls: {
      locationsUrl,
      servicesUrl,
      staffUrl
    }
  };
}

function resolveTeamMemberIds(service = {}, target = {}, staffProfiles = []) {
  const configured = getSquareField(target, [
    "squareTeamMemberIds",
    "square_team_member_ids",
    "teamMemberIds",
    "team_member_ids"
  ]);

  const explicit = unique([
    ...(Array.isArray(configured) ? configured : []),
    ...(Array.isArray(target.squareTeamMemberIds)
      ? target.squareTeamMemberIds
      : []),
    ...(Array.isArray(target.teamMemberIds) ? target.teamMemberIds : []),
    getSquareField(target, ["squareTeamMemberId", "square_team_member_id"]),
    target.teamMemberId
  ]);

  if (explicit.length > 0) {
    return explicit.map(String);
  }

  const serviceTeamIds = unique(service.teamMemberIds || []).map(String);

  if (serviceTeamIds.length > 0) {
    return serviceTeamIds;
  }

  // Some public Square service objects omit team_member_ids even though the
  // location has bookable staff. In that case let Square's availability engine
  // decide which of the location's bookable staff can fulfill the variation.
  return unique(
    (Array.isArray(staffProfiles) ? staffProfiles : [])
      .filter((profile) => profile && profile.isBookable !== false)
      .map((profile) => profile.teamMemberId)
  ).map(String);
}

function buildSquareBuyerStartUrl({ locationId, serviceItemId, target = {} }) {
  const explicit = sanitizeSquareUrl(
    getSquareField(target, [
      "squareBuyerStartUrl",
      "square_buyer_start_url",
      "squareStartUrl",
      "square_start_url"
    ])
  );

  if (explicit) {
    return explicit;
  }

  if (!locationId || !serviceItemId) {
    return sanitizeSquareUrl(target.bookingUrl || "");
  }

  const url = new URL(
    `https://app.squareup.com/appointments/book/${encodeURIComponent(locationId)}/start`
  );

  url.searchParams.set("service_id", serviceItemId);
  url.searchParams.set("locale", "en");
  url.searchParams.set("referrer", "so");

  const color = getSquareField(target, ["squareColor", "square_color"]);
  const buttonTextColor = getSquareField(target, [
    "squareButtonTextColor",
    "square_button_text_color"
  ]);

  if (color) url.searchParams.set("color", String(color));
  if (buttonTextColor) {
    url.searchParams.set("buttonTextColor", String(buttonTextColor));
  }

  return url.toString();
}

function buildSquareAvailabilityPayload({
  locationId,
  serviceVariationId,
  teamMemberIds,
  startAt,
  endAt
}) {
  return {
    search_availability_request: {
      query: {
        filter: {
          start_at_range: {
            start_at: startAt,
            end_at: endAt
          },
          location_id: locationId,
          segment_filters: [
            {
              service_variation_id: serviceVariationId,
              team_member_id_filter: {
                any: teamMemberIds
              }
            }
          ]
        }
      }
    }
  };
}

async function fetchSquareAvailabilityInBrowser({
  bookingUrl,
  buyerStartUrl,
  payload,
  serviceName = "",
  staffProfiles = [],
  timeoutMs = 35000
}) {
  const navigationUrl = sanitizeSquareUrl(buyerStartUrl || bookingUrl);

  if (!navigationUrl) {
    throw new Error(
      "Square browser availability fallback requires a buyer start URL or booking URL."
    );
  }

  let chromium;

  try {
    ({ chromium } = require("playwright"));
  } catch (error) {
    throw new Error(
      `Square availability requires Playwright for buyer-session fallback: ${error.message}`
    );
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();
  const capturedRequests = [];
  const capturedResponses = [];
  const actionLog = [];

  function isBuyerAvailabilityUrl(url = "") {
    return String(url).includes("/appointments/api/buyer/availability");
  }

  function getFilter(requestPayload = null) {
    return requestPayload?.search_availability_request?.query?.filter || null;
  }

  function requestMatchesTarget(requestPayload = null) {
    const wanted = getFilter(payload);
    const candidate = getFilter(requestPayload);

    if (!wanted || !candidate) return true;

    const wantedLocation = String(wanted.location_id || "");
    const candidateLocation = String(candidate.location_id || "");

    const wantedVariation = String(
      wanted.segment_filters?.[0]?.service_variation_id || ""
    );
    const candidateVariation = String(
      candidate.segment_filters?.[0]?.service_variation_id || ""
    );

    if (
      wantedLocation &&
      candidateLocation &&
      wantedLocation !== candidateLocation
    ) {
      return false;
    }

    if (
      wantedVariation &&
      candidateVariation &&
      wantedVariation !== candidateVariation
    ) {
      return false;
    }

    return true;
  }

  function parsePostData(request) {
    try {
      return request.postDataJSON();
    } catch {
      try {
        const raw = request.postData();
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }
  }

  page.on("request", async (request) => {
    if (!isBuyerAvailabilityUrl(request.url())) return;

    const postDataJson = parsePostData(request);

    capturedRequests.push({
      url: request.url(),
      method: request.method(),
      headers: await request.allHeaders().catch(() => request.headers()),
      postDataJson,
      matchesTarget: requestMatchesTarget(postDataJson)
    });
  });

  page.on("response", async (response) => {
    if (!isBuyerAvailabilityUrl(response.url())) return;

    const request = response.request();
    const postDataJson = parsePostData(request);
    let text = "";
    let json = null;

    try {
      text = await response.text();
    } catch {
      text = "";
    }

    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    capturedResponses.push({
      status: response.status(),
      url: response.url(),
      json,
      text,
      postDataJson,
      matchesTarget: requestMatchesTarget(postDataJson)
    });
  });

  async function waitForNative(waitMs = 5000) {
    const deadline = Date.now() + waitMs;

    while (Date.now() < deadline) {
      const exact = [...capturedResponses]
        .reverse()
        .find(
          (entry) =>
            entry.status === 200 &&
            entry.json &&
            entry.matchesTarget
        );

      if (exact) {
        return exact.json;
      }

      await page.waitForTimeout(200);
    }

    return null;
  }

  async function clickLocator(locator, label) {
    try {
      if ((await locator.count()) === 0) return false;
      const item = locator.first();
      if (!(await item.isVisible().catch(() => false))) return false;

      await item.click({ timeout: 4000 });
      actionLog.push(label);
      await page.waitForTimeout(750);
      return true;
    } catch {
      return false;
    }
  }

  async function clickText(pattern, label) {
    return clickLocator(
      page.getByText(pattern, { exact: false }),
      label
    );
  }

  async function clickButton(pattern, label) {
    return clickLocator(
      page.getByRole("button", { name: pattern }),
      label
    );
  }

  async function attemptNativeFlow() {
    let result = null;
    if (payload) {
      result = await waitForNative(8000);
    } else {
      await page.waitForTimeout(2000);
    }
    if (result) return result;

    if (serviceName) {
      const serviceCandidates = unique([
        String(serviceName).trim(),
        String(serviceName).split("|")[0].trim(),
        String(serviceName)
          .replace(/\b\d+\s*(?:hr|hrs|hour|hours|min|mins|minute|minutes)\b/gi, "")
          .replace(/[|\-–—]+\s*$/g, "")
          .trim()
      ]).filter(Boolean);

      for (const candidateName of serviceCandidates) {
        const escaped = candidateName.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );
        const servicePattern = new RegExp(escaped, "i");

        if (
          (await clickButton(
            servicePattern,
            `service-button:${candidateName}`
          )) ||
          (await clickText(
            servicePattern,
            `service-text:${candidateName}`
          ))
        ) {
          result = await waitForNative(3500);
          if (result) return result;
          break;
        }
      }
    }

    const genericSteps = [
      [/book/i, "book"],
      [/any available staff/i, "any-available-staff"],
      [/any staff/i, "any-staff"],
      [/no preference/i, "no-preference"],
      [/first available/i, "first-available"],
      [/continue/i, "continue"],
      [/next/i, "next"],
      [/show times/i, "show-times"],
      [/find a time/i, "find-time"],
      [/select time/i, "select-time"]
    ];

    for (const [pattern, label] of genericSteps) {
      const clicked =
        (await clickButton(pattern, `button:${label}`)) ||
        (await clickText(pattern, `text:${label}`));

      if (!clicked) continue;

      result = await waitForNative(3000);
      if (result) return result;
    }

    // Some businesses require choosing a named staff member before the calendar
    // appears. Try eligible staff names, but stop immediately once Square emits
    // its own availability request.
    for (const staff of Array.isArray(staffProfiles) ? staffProfiles : []) {
      const name = String(staff?.displayName || "").trim();
      if (!name) continue;

      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(escaped, "i");

      const clicked =
        (await clickButton(pattern, `staff-button:${name}`)) ||
        (await clickText(pattern, `staff-text:${name}`));

      if (!clicked) continue;

      result = await waitForNative(3500);
      if (result) return result;
    }

    return null;
  }

  async function replayInsidePage() {
    return page.evaluate(
      async ({ url, requestPayload }) => {
        const headers = {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json",
          "x-requested-with": "XMLHttpRequest"
        };

        const csrf =
          document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ||
          "";

        if (csrf) {
          headers["x-csrf-token"] = csrf;
        }

        try {
          const response = await fetch(url, {
            method: "POST",
            credentials: "include",
            mode: "cors",
            headers,
            body: JSON.stringify(requestPayload)
          });

          const text = await response.text();

          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get("content-type") || "",
            text
          };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            statusText: "fetch_error",
            contentType: "",
            text: String(error?.message || error)
          };
        }
      },
      {
        url: SQUARE_AVAILABILITY_URL,
        requestPayload: payload
      }
    );
  }

  async function replayWithCapturedHeaders() {
    const native = [...capturedRequests]
      .reverse()
      .find((entry) => entry.matchesTarget) ||
      capturedRequests[capturedRequests.length - 1] ||
      null;

    if (!native) return null;

    const allowedHeaderNames = new Set([
      "accept",
      "content-type",
      "origin",
      "referer",
      "x-csrf-token",
      "x-requested-with"
    ]);

    const headers = {};

    for (const [key, value] of Object.entries(native.headers || {})) {
      const lower = String(key).toLowerCase();

      if (allowedHeaderNames.has(lower) || lower.startsWith("x-square-")) {
        headers[lower] = value;
      }
    }

    headers.accept = headers.accept || "application/json, text/plain, */*";
    headers["content-type"] = "application/json";
    headers.origin = headers.origin || "https://book.squareup.com";
    headers.referer = headers.referer || page.url();

    const response = await context.request.post(SQUARE_AVAILABILITY_URL, {
      headers,
      data: payload,
      timeout: timeoutMs
    });

    const text = await response.text();

    if (!response.ok()) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  try {
    console.log(
      `[SQUARE v${NEXTAPPT_SQUARE_SCRAPER_VERSION}] Bootstrapping real Square buyer flow: ${navigationUrl}`
    );

    await page.goto(navigationUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });

    // The app.squareup.com /start route is intentional. Square uses it to
    // initialize the buyer flow before redirecting to book.squareup.com.
    await page.waitForTimeout(1200);

    const native = await attemptNativeFlow();

    if (native) {
      const captured = [...capturedResponses]
        .reverse()
        .find(
          (entry) =>
            entry.status === 200 &&
            entry.json === native
        ) || null;

      native.__nextapptSquareTransport = "native_browser_capture";
      native.__nextapptSquareCapturedRequest = captured?.postDataJson || null;
      native.__nextapptSquareFinalUrl = page.url();
      return native;
    }

    if (!payload) {
      const bodyText = await page
        .locator("body")
        .innerText({ timeout: 3000 })
        .catch(() => "");

      throw new Error(
        "Square direct booking flow did not emit a native availability request. " +
          `Final URL: ${page.url()}. ` +
          `Native requests: ${capturedRequests.length}; responses: ${capturedResponses.length}. ` +
          `Actions: ${actionLog.join(", ") || "none"}. ` +
          `Page text sample: ${String(bodyText).replace(/\s+/g, " ").slice(0, 500)}`
      );
    }

    // If the UI did not naturally trigger availability, the session is now
    // initialized. Retry the exact payload from inside that browser session.
    const replay = await replayInsidePage();

    if (replay?.ok) {
      try {
        const json = JSON.parse(replay.text);
        json.__nextapptSquareTransport = "browser_session_fetch";
        return json;
      } catch {
        // Continue to captured-header replay below.
      }
    }

    const headerReplay = await replayWithCapturedHeaders();

    if (headerReplay) {
      headerReplay.__nextapptSquareTransport = "captured_header_replay";
      return headerReplay;
    }

    const bodyText = await page
      .locator("body")
      .innerText({ timeout: 3000 })
      .catch(() => "");

    const lastResponse = capturedResponses[capturedResponses.length - 1] || null;

    throw new Error(
      "Square buyer flow did not yield availability. " +
        `Final URL: ${page.url()}. ` +
        `Native requests: ${capturedRequests.length}; responses: ${capturedResponses.length}. ` +
        `Actions: ${actionLog.join(", ") || "none"}. ` +
        (replay
          ? `Session replay status: ${replay.status} ${replay.statusText}. `
          : "") +
        (lastResponse
          ? `Last availability response status: ${lastResponse.status}. `
          : "") +
        `Page text sample: ${String(bodyText).replace(/\s+/g, " ").slice(0, 500)}`
    );
  } finally {
    await page.close().catch(() => null);
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

async function fetchSquareAvailability({
  locationId,
  serviceItemId,
  serviceVariationId,
  teamMemberIds,
  startAt,
  endAt,
  bookingUrl = "",
  buyerStartUrl = "",
  serviceName = "",
  staffProfiles = [],
  timeoutMs = 20000
}) {
  if (!locationId) {
    throw new Error("Square availability request is missing locationId.");
  }

  if (!serviceVariationId) {
    throw new Error(
      "Square availability request is missing serviceVariationId."
    );
  }

  if (!Array.isArray(teamMemberIds) || teamMemberIds.length === 0) {
    throw new Error(
      "Square service has no team members available for the availability query."
    );
  }

  const payload = buildSquareAvailabilityPayload({
    locationId,
    serviceVariationId,
    teamMemberIds,
    startAt,
    endAt
  });

  try {
    const direct = await fetchJson(SQUARE_AVAILABILITY_URL, {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        origin: "https://book.squareup.com",
        referer: "https://book.squareup.com/",
        "cache-control": "no-cache",
        pragma: "no-cache"
      },
      body: JSON.stringify(payload),
      timeoutMs
    });

    direct.__nextapptSquareTransport = "direct_http";
    return direct;
  } catch (error) {
    const message = String(error?.message || error);
    const shouldUseBrowserSession =
      /404 Not Found/i.test(message) ||
      /couldn.t find/i.test(message) ||
      /non-JSON/i.test(message) ||
      /403/i.test(message);

    if (!shouldUseBrowserSession) {
      throw error;
    }

    console.warn(
      `[SQUARE v${NEXTAPPT_SQUARE_SCRAPER_VERSION}] Direct buyer endpoint rejected the stateless request; using the real Square buyer session.`
    );

    return fetchSquareAvailabilityInBrowser({
      bookingUrl: sanitizeSquareUrl(bookingUrl),
      buyerStartUrl: sanitizeSquareUrl(buyerStartUrl),
      payload,
      serviceName,
      staffProfiles,
      timeoutMs: Math.max(timeoutMs, 35000)
    });
  }
}

function parseSquareEpoch(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(String(value))) {
    const number = Number(value);
    const milliseconds = number > 10_000_000_000 ? number : number * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function collectAvailabilitySlots(payload) {
  if (Array.isArray(payload?.availability)) {
    return payload.availability;
  }

  if (Array.isArray(payload?.availabilities)) {
    return payload.availabilities;
  }

  if (Array.isArray(payload?.search_availability_response?.availabilities)) {
    return payload.search_availability_response.availabilities;
  }

  if (Array.isArray(payload?.search_availability_response?.availability)) {
    return payload.search_availability_response.availability;
  }

  return [];
}

function normalizeSquareAppointments(
  availabilityPayload,
  { target, service, locationId, timeZone }
) {
  const rawSlots = collectAvailabilitySlots(availabilityPayload).filter(
    (slot) => slot && slot.available !== false
  );

  // NextAppt is showing "Any available staff" inventory. If multiple Square
  // staff members can take the same start time, expose one appointment button
  // and retain every booking staff id in squareBookingStaffIds.
  const groupedByStart = new Map();

  for (const slot of rawSlots) {
    const start = parseSquareEpoch(
      slot.start ?? slot.start_at ?? slot.startAt
    );

    const end = parseSquareEpoch(slot.end ?? slot.end_at ?? slot.endAt);

    if (!start) {
      continue;
    }

    const startIso = start.toISOString();

    if (!groupedByStart.has(startIso)) {
      groupedByStart.set(startIso, {
        start,
        end,
        rawSlots: [],
        bookingStaffIds: []
      });
    }

    const group = groupedByStart.get(startIso);
    group.rawSlots.push(slot);

    if (slot.staff_id) {
      group.bookingStaffIds.push(String(slot.staff_id));
    }

    if (!group.end && end) {
      group.end = end;
    }
  }

  const price = buildPriceDisplay(service);
  const appointments = [];

  for (const group of groupedByStart.values()) {
    const start = group.start;

    const end =
      group.end ||
      new Date(
        start.getTime() +
          Number(service.durationMinutes || target.durationMinutes || 0) * 60000
      );

    const local = getLocalPartsFromDate(start, timeZone);
    const provider = target.providerText || "Any available staff";

    appointments.push({
      businessName: target.businessName || target.name || "",
      platform: "square",
      bookingUrl: target.bookingUrl || "",

      serviceName:
        target.serviceName || target.service || service.serviceName || "",
      service:
        target.serviceName || target.service || service.serviceName || "",
      serviceType:
        target.serviceType || target.serviceCategory || "hair",
      serviceCategory:
        target.serviceType || target.serviceCategory || "hair",

      durationMinutes:
        service.durationMinutes || toNumberOrNull(target.durationMinutes),

      platformServiceId:
        target.platformServiceId ||
        target.serviceId ||
        service.itemId ||
        null,

      squareServiceItemId: service.itemId || null,
      squareServiceVariationId: service.variationId || null,
      squareLocationId: locationId,

      therapistName: provider,
      providerName: provider,
      provider,

      appointmentStart: start.toISOString(),
      startTime: start.toISOString(),
      appointmentEnd:
        end && !Number.isNaN(end.getTime()) ? end.toISOString() : "",
      endTime:
        end && !Number.isNaN(end.getTime()) ? end.toISOString() : "",

      localDateKey: local.localDateKey,
      localTimeKey: local.localTimeKey,

      date: formatDisplayDate(start, timeZone),
      time: formatDisplayTime(start, timeZone),
      timezone: timeZone,
      price,

      sourceType: "confirmed",
      confidence: 1,

      squareBookingStaffIds: unique(group.bookingStaffIds),

      rawJson: {
        source: "square_buyer_availability",
        slots: group.rawSlots
      }
    });
  }

  return appointments.sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

async function scrapeSquareDirectBookingBusiness(
  target = {},
  context = {},
  startedAt = Date.now()
) {
  const timeZone = target.timezone || DEFAULT_TIMEZONE;
  const window = resolveScrapeWindow({
    ...target,
    timezone: timeZone
  });

  const parsedBookingUrl = parseSquareBookingUrl(
    context.directBookingUrl || target.bookingUrl
  );

  const locationId =
    context.locationId ||
    target.squareLocationId ||
    parsedBookingUrl.locationId ||
    "";

  if (!locationId) {
    throw new Error(
      "Square direct booking flow is missing a location ID. " +
        "Use a booking URL containing /location/{LOCATION_ID}/ or save Square Location ID."
    );
  }

  const serviceItemId =
    target.platformServiceId ||
    target.serviceId ||
    target.serviceButtonId ||
    "";

  const serviceName = target.serviceName || target.service || "";

  console.log("[SQUARE] Direct booking discovery", {
    businessName: target.businessName || target.name,
    serviceName,
    bookingBusinessId:
      context.bookingBusinessId ||
      target.squareBookingBusinessId ||
      parsedBookingUrl.bookingBusinessId ||
      "",
    locationId,
    bookingUrl: context.directBookingUrl || target.bookingUrl
  });

  const directBuyerStartUrl = buildSquareBuyerStartUrl({
    locationId,
    serviceItemId,
    target
  });

  console.log("[SQUARE] Direct booking buyer start", {
    serviceItemId,
    buyerStartUrl: directBuyerStartUrl
  });

  const availabilityPayload = await fetchSquareAvailabilityInBrowser({
    bookingUrl: context.directBookingUrl || target.bookingUrl || "",
    buyerStartUrl:
      directBuyerStartUrl ||
      context.directBookingUrl ||
      target.bookingUrl ||
      "",
    payload: null,
    serviceName,
    staffProfiles: [],
    timeoutMs: Math.max(Number(target.squareTimeoutMs || 20000), 35000)
  });

  const capturedRequest =
    availabilityPayload.__nextapptSquareCapturedRequest || null;

  const capturedFilter =
    capturedRequest?.search_availability_request?.query?.filter || null;

  const capturedSegment = capturedFilter?.segment_filters?.[0] || null;

  const resolvedLocationId = String(
    capturedFilter?.location_id || locationId || ""
  );

  const capturedVariationId = String(
    capturedSegment?.service_variation_id || ""
  );

  const resolvedVariationId =
    capturedVariationId || target.squareServiceVariationId || "";

  const capturedTeamMemberIds = Array.isArray(
    capturedSegment?.team_member_id_filter?.any
  )
    ? capturedSegment.team_member_id_filter.any.map(String)
    : [];

  const selectedService = {
    itemId: serviceItemId || resolvedVariationId || "",
    variationId: resolvedVariationId || serviceItemId || "",
    serviceName,
    variationName: "",
    description: "",
    durationMinutes: toNumberOrNull(target.durationMinutes),
    priceAmount: null,
    currency: "USD",
    priceDescription: "",
    teamMemberIds: capturedTeamMemberIds,
    transitionTimeMinutes: null,
    availableForBooking: true
  };

  const appointments = normalizeSquareAppointments(
    availabilityPayload,
    {
      target,
      service: selectedService,
      locationId: resolvedLocationId,
      timeZone
    }
  ).filter((appointment) => {
    const dateKey = appointment.localDateKey || "";
    if (window.startDate && dateKey && dateKey < window.startDate) return false;
    if (window.endDate && dateKey && dateKey > window.endDate) return false;
    return true;
  });

  return {
    businessName: target.businessName || target.name || "",
    bookingUrl: target.bookingUrl || "",
    platform: "square",
    service: serviceName,
    serviceName,
    serviceType: target.serviceType || target.serviceCategory || "hair",
    durationMinutes: toNumberOrNull(target.durationMinutes),
    platformServiceId:
      target.platformServiceId || target.serviceId || selectedService.itemId || null,
    provider: target.providerText || "Any available staff",
    date: null,
    times: appointments.map((appointment) => appointment.startTime),
    status: appointments.length > 0 ? "success" : "no_times_found",
    error: null,
    scrapeDurationMs: Date.now() - startedAt,
    lastChecked: new Date().toISOString(),
    appointments,
    openings: appointments,
    price: null,
    distanceMiles:
      typeof target.distanceMiles === "number" ? target.distanceMiles : null,
    scrapeStartDate: window.startDate,
    scrapeEndDate: window.endDate,
    lookaheadHours: target.lookaheadHours ? Number(target.lookaheadHours) : null,
    daysForward: target.daysForward ? Number(target.daysForward) : null,
    scrapeWindowMode: target.scrapeWindowMode || "",
    rawWidgetText: null,
    squareMeta: {
      scraperVersion: NEXTAPPT_SQUARE_SCRAPER_VERSION,
      availabilityTransport:
        availabilityPayload.__nextapptSquareTransport || "native_browser_capture",
      squareSiteOrigin: "",
      publishedUserId: "",
      siteId: "",
      syncBase: "",
      discoveryMethod: "direct_booking",
      directRouteType: context.directRouteType || parsedBookingUrl.routeType || "",
      bookingBusinessId:
        context.bookingBusinessId ||
        target.squareBookingBusinessId ||
        parsedBookingUrl.bookingBusinessId ||
        "",
      locationId: resolvedLocationId,
      serviceItemId: selectedService.itemId || null,
      serviceVariationId: resolvedVariationId || null,
      discoveredServiceName: serviceName,
      variationName: "",
      durationMinutes: selectedService.durationMinutes,
      priceAmount: null,
      currency: selectedService.currency,
      eligibleTeamMemberIds: capturedTeamMemberIds,
      staffProfiles: [],
      discoveredServiceCount: null,
      rawAvailabilityCount: collectAvailabilitySlots(availabilityPayload).length,
      normalizedAppointmentCount: appointments.length,
      buyerStartUrl:
        availabilityPayload.__nextapptSquareFinalUrl ||
        context.directBookingUrl ||
        target.bookingUrl ||
        "",
      requestWindow: {
        startAt: window.startAt,
        endAt: window.endAt
      },
      capturedNativeRequest: capturedRequest
    }
  };
}

async function scrapeSquareBusiness(target = {}) {
  const startedAt = Date.now();
  target = normalizeSquareTarget(target);
  const timeZone = target.timezone || DEFAULT_TIMEZONE;

  console.log(
    `[SQUARE v${NEXTAPPT_SQUARE_SCRAPER_VERSION}] Starting ${target.businessName || target.name || "business"} | ${target.serviceName || target.service || "service"}`
  );

  if (!target.businessName && !target.name) {
    throw new Error("Square scrape target is missing businessName.");
  }

  const context = await discoverSquareContext(target);

  if (context.discoveryMethod === "direct_booking") {
    return scrapeSquareDirectBookingBusiness(target, context, startedAt);
  }

  const discovery = await fetchSquareDiscoveryData(context, target);

  const selectedService = selectSquareService(discovery.services, target);

  if (!selectedService) {
    const serviceLabel =
      target.serviceName ||
      target.service ||
      target.platformServiceId ||
      target.serviceId ||
      "(unknown service)";

    throw new Error(
      `Square could not match configured service "${serviceLabel}" against ` +
        `${discovery.services.length} bookable variation(s).`
    );
  }

  const teamMemberIds = resolveTeamMemberIds(
    selectedService,
    target,
    discovery.staff
  );

  if (teamMemberIds.length === 0) {
    throw new Error(
      `Square service "${selectedService.serviceName}" has no eligible team members.`
    );
  }

  const window = resolveScrapeWindow({
    ...target,
    timezone: timeZone
  });

  console.log("[SQUARE] Availability request", {
    businessName: target.businessName || target.name,
    serviceName: target.serviceName || selectedService.serviceName,
    itemId: selectedService.itemId,
    variationId: selectedService.variationId,
    locationId: discovery.locationId,
    teamMemberCount: teamMemberIds.length,
    startAt: window.startAt,
    endAt: window.endAt
  });

  const buyerStartUrl = buildSquareBuyerStartUrl({
    locationId: discovery.locationId,
    serviceItemId: selectedService.itemId,
    target
  });

  const availabilityPayload = await fetchSquareAvailability({
    locationId: discovery.locationId,
    serviceItemId: selectedService.itemId,
    serviceVariationId: selectedService.variationId,
    teamMemberIds,
    startAt: window.startAt,
    endAt: window.endAt,
    bookingUrl: target.bookingUrl || "",
    buyerStartUrl,
    serviceName:
      target.serviceName || target.service || selectedService.serviceName || "",
    staffProfiles: discovery.staff,
    timeoutMs: Number(target.squareTimeoutMs || 20000)
  });

  const appointments = normalizeSquareAppointments(availabilityPayload, {
    target,
    service: selectedService,
    locationId: discovery.locationId,
    timeZone
  });

  const price = buildPriceDisplay(selectedService);

  return {
    businessName: target.businessName || target.name || "",
    bookingUrl: target.bookingUrl || "",
    platform: "square",

    service:
      target.serviceName || target.service || selectedService.serviceName,
    serviceName:
      target.serviceName || target.service || selectedService.serviceName,
    serviceType: target.serviceType || target.serviceCategory || "hair",

    durationMinutes:
      selectedService.durationMinutes || toNumberOrNull(target.durationMinutes),

    platformServiceId:
      target.platformServiceId ||
      target.serviceId ||
      selectedService.itemId ||
      null,

    provider: target.providerText || "Any available staff",
    date: null,
    times: appointments.map((appointment) => appointment.startTime),

    status: appointments.length > 0 ? "success" : "no_times_found",
    error: null,
    scrapeDurationMs: Date.now() - startedAt,
    lastChecked: new Date().toISOString(),

    appointments,
    openings: appointments,
    price,

    distanceMiles:
      typeof target.distanceMiles === "number" ? target.distanceMiles : null,

    scrapeStartDate: window.startDate,
    scrapeEndDate: window.endDate,
    lookaheadHours: target.lookaheadHours
      ? Number(target.lookaheadHours)
      : null,
    daysForward: target.daysForward ? Number(target.daysForward) : null,
    scrapeWindowMode: target.scrapeWindowMode || "",

    rawWidgetText: null,

    squareMeta: {
      scraperVersion: NEXTAPPT_SQUARE_SCRAPER_VERSION,
      availabilityTransport:
        availabilityPayload.__nextapptSquareTransport || "unknown",
      squareSiteOrigin: context.squareSiteOrigin,
      publishedUserId: context.publishedUserId,
      siteId: context.siteId,
      syncBase: context.syncBase,
      discoveryMethod: context.discoveryMethod,

      locationId: discovery.locationId,

      serviceItemId: selectedService.itemId,
      serviceVariationId: selectedService.variationId,
      discoveredServiceName: selectedService.serviceName,
      variationName: selectedService.variationName,

      durationMinutes: selectedService.durationMinutes,
      priceAmount: selectedService.priceAmount,
      currency: selectedService.currency,

      eligibleTeamMemberIds: teamMemberIds,
      staffProfiles: discovery.staff,

      discoveredServiceCount: discovery.services.length,
      rawAvailabilityCount: collectAvailabilitySlots(availabilityPayload).length,
      normalizedAppointmentCount: appointments.length,

      buyerStartUrl,
      requestWindow: {
        startAt: window.startAt,
        endAt: window.endAt
      }
    }
  };
}

module.exports = {
  NEXTAPPT_SQUARE_SCRAPER_VERSION,
  scrapeSquareBusiness,
  scrapeSquareDirectBookingBusiness,
  fetchSquareAvailability,
  fetchSquareAvailabilityInBrowser,
  buildSquareAvailabilityPayload,
  buildSquareBuyerStartUrl,
  sanitizeSquareUrl,
  parseSquareBookingUrl,
  normalizeSquareTarget,
  discoverSquareContext,
  fetchSquareDiscoveryData,
  normalizeSquareServices,
  normalizeStaffProfiles,
  normalizeSquareAppointments,
  selectSquareService,
  resolveScrapeWindow
};