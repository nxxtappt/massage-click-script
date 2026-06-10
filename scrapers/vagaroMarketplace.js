// scrapers/vagaroMarketplace.js

const { chromium } = require("playwright");

const DEFAULT_CITY = "austin";
const DEFAULT_STATE = "tx";
const DEFAULT_SERVICE = "Swedish Massage - 60 Minute";
const DEFAULT_LIMIT = 10;

const TODAY = new Date();

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildMarketplaceUrl({
  city = DEFAULT_CITY,
  state = DEFAULT_STATE,
  service = DEFAULT_SERVICE
} = {}) {
  const cleanCity = String(city).toLowerCase().replace(/\s+/g, "-");
  const cleanState = String(state).toLowerCase();

  return `https://www.vagaro.com/listings/massage/${cleanCity}--${cleanState}?service=${encodeURIComponent(
    service
  )}`;
}

function uniqueByUrl(items) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    if (!item.bookingUrl) continue;

    const key = item.bookingUrl.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(item);
  }

  return output;
}

function isBlockedVagaroUrl(href) {
  const lower = String(href || "").toLowerCase();

  const blocked = [
    "/pro",
    "/login",
    "/gallery",
    "/photos",
    "/deals",
    "/professionals",
    "/listings",
    "/search",
    "/about",
    "/contact",
    "/terms",
    "/privacy",
    "/careers",
    "/support",
    "/shop",
    "/customers",
    "/download",
    "/pricing",
    "/features",
    "/blog",
    "/help"
  ];

  return blocked.some((blockedPath) => lower.includes(blockedPath));
}

function isBlockedBusinessText(text) {
  const lower = normalizeSpace(text).toLowerCase();

  const blockedText = [
    "for business",
    "daily deals",
    "professionals",
    "gallery",
    "login",
    "search",
    "filters",
    "more",
    "book now",
    "services",
    "massage",
    "best massage",
    "related searches",
    "keyboard shortcuts",
    "terms",
    "report a map error"
  ];

  return blockedText.includes(lower);
}

function isLikelyBusinessUrl(href) {
  if (!href) return false;

  let url;

  try {
    url = new URL(href);
  } catch {
    return false;
  }

  const host = url.hostname.toLowerCase();

  if (host !== "www.vagaro.com" && host !== "vagaro.com") {
    return false;
  }

  if (isBlockedVagaroUrl(url.href)) {
    return false;
  }

  const path = url.pathname.replace(/^\/+|\/+$/g, "");

  if (!path) return false;
  if (path.includes("/")) return false;

  const blockedSlugs = new Set([
    "pro",
    "login",
    "photos",
    "deals",
    "professionals",
    "listings",
    "search",
    "support",
    "about",
    "contact",
    "terms",
    "privacy"
  ]);

  if (blockedSlugs.has(path.toLowerCase())) return false;

  return true;
}

function parseDateCandidate(value) {
  if (!value) return null;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function isPastDateText(value) {
  const parsed = parseDateCandidate(value);

  if (!parsed) return false;

  const todayOnly = new Date(
    TODAY.getFullYear(),
    TODAY.getMonth(),
    TODAY.getDate()
  );

  const parsedOnly = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate()
  );

  return parsedOnly < todayOnly;
}

function formatDate(dateValue) {
  const parsed = parseDateCandidate(dateValue);

  if (!parsed) return null;

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatTime(dateValue) {
  const parsed = parseDateCandidate(dateValue);

  if (!parsed) return null;

  const minutes = parsed.getMinutes();

  if (![0, 15, 30, 45].includes(minutes)) {
    return null;
  }

  return parsed.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function extractDateCandidatesFromText(text) {
  const clean = String(text || "");

  const patterns = [
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g
  ];

  const found = [];

  for (const pattern of patterns) {
    const matches = clean.match(pattern) || [];
    found.push(...matches);
  }

  return [...new Set(found.map(normalizeSpace))];
}

function chooseBestFutureDate(textBlocks) {
  const candidates = [];

  for (const block of textBlocks) {
    candidates.push(...extractDateCandidatesFromText(block));
  }

  for (const candidate of candidates) {
    if (!isPastDateText(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractTimesFromText(text) {
  const clean = String(text || "");

  const timeMatches =
    clean.match(/\b(1[0-2]|0?[1-9]):[0-5][0-9]\s?(AM|PM|am|pm)\b/g) || [];

  const normalized = timeMatches
    .map((time) => normalizeSpace(time).toUpperCase())
    .filter((time) => {
      const minuteMatch = time.match(/:(\d{2})/);
      if (!minuteMatch) return false;

      const minute = minuteMatch[1];
      return ["00", "15", "30", "45"].includes(minute);
    });

  return [...new Set(normalized)];
}

function getRelevantTimeWindows(text) {
  const clean = String(text || "");
  const lower = clean.toLowerCase();

  const keywords = [
    "select date",
    "select date & time",
    "date & time",
    "availability",
    "available",
    "appointment",
    "appointment details",
    "book",
    "calendar",
    "morning",
    "afternoon",
    "evening",
    "first available",
    "choose a time",
    "select a time"
  ];

  const windows = [];

  for (const keyword of keywords) {
    let index = lower.indexOf(keyword);

    while (index !== -1) {
      const start = Math.max(0, index - 500);
      const end = Math.min(clean.length, index + 2500);
      windows.push(clean.slice(start, end));
      index = lower.indexOf(keyword, index + keyword.length);
    }
  }

  return windows;
}

function extractLikelyAppointmentTimes(text) {
  const windows = getRelevantTimeWindows(text);

  if (windows.length) {
    const fromWindows = windows.flatMap(extractTimesFromText);

    if (fromWindows.length) {
      return [...new Set(fromWindows)];
    }
  }

  return extractTimesFromText(text);
}

function isLikelyAppointmentKey(combinedKey) {
  const key = String(combinedKey || "").toLowerCase();

  const positive = [
    "appointment",
    "availability",
    "available",
    "slot",
    "slots",
    "bookable",
    "starttime",
    "start_time",
    "startdatetime",
    "start_date_time",
    "timeslot",
    "time_slot",
    "sessiontime",
    "session_time"
  ];

  const negative = [
    "businesshour",
    "business_hour",
    "openhour",
    "open_hour",
    "closehour",
    "close_hour",
    "hours",
    "operation",
    "operating",
    "created",
    "updated",
    "modified",
    "timestamp",
    "review",
    "rating",
    "timezone"
  ];

  if (negative.some((x) => key.includes(x))) {
    return false;
  }

  return positive.some((x) => key.includes(x));
}

function cleanAppointmentTimes(times) {
  const suspiciousTimes = new Set([
    "9:00 AM",
    "5:00 PM",
    "6:00 PM",
    "7:00 PM",
    "8:00 PM",
    "9:00 PM"
  ]);

  return [...new Set(times)]
    .map((time) => normalizeSpace(time).toUpperCase())
    .filter((time) => {
      const minuteMatch = time.match(/:(\d{2})/);

      if (!minuteMatch) {
        return false;
      }

      const minutes = minuteMatch[1];

      if (!["00", "15", "30", "45"].includes(minutes)) {
        return false;
      }

      if (suspiciousTimes.has(time)) {
        return false;
      }

      return true;
    });
}

function extractAvailabilityFromJson(responseBody) {
  const foundTimes = [];
  const foundDates = [];

  let parsed;

  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return {
      dates: [],
      times: []
    };
  }

  function scan(value, parentKey = "") {
    if (!value) return;

    if (Array.isArray(value)) {
      for (const item of value) {
        scan(item, parentKey);
      }
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    for (const [key, val] of Object.entries(value)) {
      const lowerKey = String(key || "").toLowerCase();
      const combinedKey = `${parentKey}.${lowerKey}`;

      if (typeof val === "string") {
        if (isLikelyAppointmentKey(combinedKey)) {
          const parsedDate = parseDateCandidate(val);

          if (parsedDate && !isPastDateText(val)) {
            const formattedDate = formatDate(val);
            const formattedTime = formatTime(val);

            if (formattedDate) foundDates.push(formattedDate);
            if (formattedTime) foundTimes.push(formattedTime);
          }

          const textTimes = extractLikelyAppointmentTimes(val);
          if (textTimes.length) {
            foundTimes.push(...textTimes);
          }

          const textDates = extractDateCandidatesFromText(val).filter(
            (dateText) => !isPastDateText(dateText)
          );

          if (textDates.length) {
            foundDates.push(...textDates);
          }
        }
      }

      if (typeof val === "number") {
        if (isLikelyAppointmentKey(combinedKey)) {
          const asMilliseconds = val > 9999999999 ? val : val * 1000;
          const parsedDate = new Date(asMilliseconds);

          if (
            !Number.isNaN(parsedDate.getTime()) &&
            parsedDate.getFullYear() >= TODAY.getFullYear()
          ) {
            const formattedDate = formatDate(parsedDate);
            const formattedTime = formatTime(parsedDate);

            if (formattedDate && !isPastDateText(formattedDate)) {
              foundDates.push(formattedDate);
            }

            if (formattedTime) {
              foundTimes.push(formattedTime);
            }
          }
        }
      }

      scan(val, combinedKey);
    }
  }

  scan(parsed);

  return {
    dates: [...new Set(foundDates)],
    times: cleanAppointmentTimes(foundTimes)
  };
}

function looksLikeVagaroBookingRequest(url) {
  const lower = String(url || "").toLowerCase();

  return (
    lower.includes("vagaro") &&
    (
      lower.includes("appointment") ||
      lower.includes("booking") ||
      lower.includes("calendar") ||
      lower.includes("service") ||
      lower.includes("employee") ||
      lower.includes("availability") ||
      lower.includes("business") ||
      lower.includes("timeslot") ||
      lower.includes("schedule") ||
      lower.includes("pagemethodsproxyjson") ||
      lower.includes("asmx") ||
      lower.includes("api")
    )
  );
}

function isHighValueBookingResponse(responseRecord) {
  const lowerUrl = String(responseRecord.url || "").toLowerCase();
  const lowerBody = String(responseRecord.body || "").toLowerCase();

  const importantUrlPatterns = [
    "appointment",
    "booking",
    "calendar",
    "availability",
    "timeslot",
    "timeslots",
    "schedule",
    "service",
    "employee",
    "api",
    "asmx",
    "pagemethodsproxyjson"
  ];

  const importantBodyPatterns = [
    "starttime",
    "start time",
    "appointment",
    "availability",
    "timeslot",
    "time slot",
    "bookable",
    "calendar",
    "serviceid",
    "employeeid",
    "startdate",
    "start date",
    "appointmentdate",
    "appointmenttime"
  ];

  return (
    importantUrlPatterns.some((x) => lowerUrl.includes(x)) ||
    importantBodyPatterns.some((x) => lowerBody.includes(x))
  );
}

function isLikelyBookingPageText(text) {
  const lower = String(text || "").toLowerCase();

  return (
    lower.includes("select date") ||
    lower.includes("select date & time") ||
    lower.includes("select time") ||
    lower.includes("choose a time") ||
    lower.includes("availability") ||
    lower.includes("appointment details") ||
    lower.includes("first available")
  );
}

function isInsideVagaroUrl(url) {
  const lower = String(url || "").toLowerCase();

  return lower.includes("vagaro.com") || lower.includes("vagaro");
}

async function getBodyText(page) {
  try {
    return await page.locator("body").innerText({ timeout: 8000 });
  } catch {
    return "";
  }
}

async function safeClickText(page, text) {
  try {
    const locator = page.getByText(text, { exact: false }).first();

    if (!(await locator.count())) {
      return false;
    }

    await locator.click({ timeout: 5000 });
    await page.waitForTimeout(2500);
    return true;
  } catch {
    return false;
  }
}

function buildBaseResult({
  businessName,
  bookingUrl,
  service,
  rawWidgetText,
  marketplaceUrl,
  rating = null,
  ratingCount = null,
  address = null,
  phone = null,
  image = null,
  priceRange = null
}) {
  return {
    businessName: normalizeSpace(businessName),
    bookingUrl,
    platform: "vagaro",
    service,
    provider: "Vagaro Marketplace",
    date: null,
    times: [],
    status: "marketplace_business_found",
    attemptNumber: 1,
    scrapeDurationMs: null,
    lastChecked: new Date().toISOString(),
    rawWidgetText,
    marketplaceUrl,
    rating,
    ratingCount,
    address,
    phone,
    image,
    priceRange
  };
}

async function extractMarketplaceBusinesses(page, marketplaceUrl, service) {
  await page.goto(marketplaceUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(6000);

  const rawWidgetText = await getBodyText(page);

  const jsonLdBusinesses = await page.$$eval(
    'script[type="application/ld+json"]',
    (scripts) => {
      const businesses = [];

      function scanItem(item) {
        if (!item || typeof item !== "object") return;

        if (item["@type"] === "LocalBusiness") {
          businesses.push(item);
        }

        if (Array.isArray(item["@graph"])) {
          for (const graphItem of item["@graph"]) {
            scanItem(graphItem);
          }
        }

        if (Array.isArray(item.itemListElement)) {
          for (const listItem of item.itemListElement) {
            if (listItem && listItem.item) {
              scanItem(listItem.item);
            } else {
              scanItem(listItem);
            }
          }
        }
      }

      for (const script of scripts) {
        try {
          const parsed = JSON.parse(script.textContent || "");
          const items = Array.isArray(parsed) ? parsed : [parsed];

          for (const item of items) {
            scanItem(item);
          }
        } catch {
          // ignore malformed JSON-LD
        }
      }

      return businesses;
    }
  );

  const fromJsonLd = jsonLdBusinesses
    .map((item) => {
      const aggregateRating = item.aggregateRating || {};
      const address = item.address || {};

      return buildBaseResult({
        businessName: item.name || null,
        bookingUrl: item.url || null,
        service,
        rawWidgetText,
        marketplaceUrl,
        rating: aggregateRating.ratingValue
          ? String(aggregateRating.ratingValue)
          : null,
        ratingCount: aggregateRating.reviewCount
          ? String(aggregateRating.reviewCount)
          : null,
        address: [
          address.streetAddress,
          address.addressLocality,
          address.addressRegion,
          address.postalCode
        ]
          .filter(Boolean)
          .join(", "),
        phone: item.telephone || null,
        image: Array.isArray(item.image) ? item.image[0] : item.image || null,
        priceRange: item.priceRange || null
      });
    })
    .filter((item) => {
      if (!item.businessName || !item.bookingUrl) return false;
      if (!isLikelyBusinessUrl(item.bookingUrl)) return false;
      if (isBlockedBusinessText(item.businessName)) return false;
      return true;
    });

  const fallbackLinks = await page.$$eval("a", (links) =>
    links.map((a) => ({
      text: (a.innerText || "").trim(),
      href: a.href
    }))
  );

  const fromLinks = fallbackLinks
    .filter((link) => {
      if (!link.href) return false;

      const text = (link.text || "").trim();

      if (!text || text.length < 3) return false;
      if (text.length > 90) return false;
      if (isBlockedBusinessText(text)) return false;

      let url;

      try {
        url = new URL(link.href);
      } catch {
        return false;
      }

      const host = url.hostname.toLowerCase();

      if (host !== "www.vagaro.com" && host !== "vagaro.com") {
        return false;
      }

      if (isBlockedVagaroUrl(url.href)) {
        return false;
      }

      const path = url.pathname.replace(/^\/+|\/+$/g, "");

      if (!path) return false;
      if (path.includes("/")) return false;

      const blockedSlugs = [
        "pro",
        "login",
        "photos",
        "deals",
        "professionals",
        "listings",
        "search",
        "support",
        "about",
        "contact",
        "terms",
        "privacy"
      ];

      if (blockedSlugs.includes(path.toLowerCase())) return false;

      return true;
    })
    .map((link) =>
      buildBaseResult({
        businessName: link.text,
        bookingUrl: link.href,
        service,
        rawWidgetText,
        marketplaceUrl
      })
    );

  return uniqueByUrl([...fromJsonLd, ...fromLinks]).filter(
    (item) => item.businessName && item.bookingUrl
  );
}

async function inspectBusinessForAvailability(context, business, options = {}) {
  const { service = DEFAULT_SERVICE, maxClickAttempts = 16 } = options;

  const page = await context.newPage();
  const usefulResponses = [];
  const started = Date.now();

  page.on("response", async (response) => {
    const url = response.url();

    if (!looksLikeVagaroBookingRequest(url)) return;

    try {
      const contentType = response.headers()["content-type"] || "";

      if (
        contentType.includes("json") ||
        contentType.includes("text") ||
        url.toLowerCase().includes("asmx")
      ) {
        const text = await response.text();

        usefulResponses.push({
          url,
          status: response.status(),
          body: text.slice(0, 30000)
        });
      }
    } catch {
      // ignore unreadable response bodies
    }
  });

  try {
    await page.goto(business.bookingUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(6000);

    let bodyText = await getBodyText(page);

    const servicePieces = normalizeSpace(service)
      .split(/[-–—]/)
      .map((part) => normalizeSpace(part))
      .filter(Boolean);

    const clickTargets = [
      "Book Now",
      "Book",
      "Schedule",
      "Book Appointment",
      "Book Service",
      "Services",
      "Service",

      ...servicePieces,

      "Swedish Massage",
      "Swedish",
      "Deep Tissue",
      "Massage",

      "60 Minute",
      "60 min",
      "60 Minutes",
      "60",

      "Select Date & Time",
      "Select Time",
      "Choose Time",

      "Continue",
      "Next",

      "First Available",
      "Any Professional",
      "Any Provider",

      "Select",
      "Book Session"
    ];

    let clicks = 0;
    const clickedTargets = [];

    for (const target of clickTargets) {
      if (clicks >= maxClickAttempts) break;

      const currentUrl = page.url();

      if (!isInsideVagaroUrl(currentUrl)) {
        break;
      }

      const clicked = await safeClickText(page, target);

      if (clicked) {
        clicks += 1;
        clickedTargets.push(target);

        await page.waitForTimeout(2500);

        bodyText = await getBodyText(page);

        const updatedUrl = page.url();

        if (!isInsideVagaroUrl(updatedUrl)) {
          break;
        }

        if (isLikelyBookingPageText(bodyText)) {
          break;
        }
      }
    }

    bodyText = await getBodyText(page);

    const finalUrl = page.url();
    const stayedInsideVagaro = isInsideVagaroUrl(finalUrl);
    const likelyBookingPage =
      stayedInsideVagaro && isLikelyBookingPageText(bodyText);

    const highValueResponses = usefulResponses.filter(isHighValueBookingResponse);

    let times = [];
    let date = null;

    if (stayedInsideVagaro) {
      for (const response of highValueResponses) {
        const jsonAvailability = extractAvailabilityFromJson(response.body);

        if (jsonAvailability.times.length) {
          times = [...new Set([...times, ...jsonAvailability.times])];
        }

        if (!date && jsonAvailability.dates.length) {
          date = jsonAvailability.dates[0];
        }

        if (likelyBookingPage) {
          const responseTimes = extractLikelyAppointmentTimes(response.body);

          if (responseTimes.length) {
            times = [...new Set([...times, ...responseTimes])];
          }
        }
      }
    }

    if (!date && likelyBookingPage) {
      date = chooseBestFutureDate(highValueResponses.map((r) => r.body));
    }

    if (!times.length && likelyBookingPage) {
      times = extractLikelyAppointmentTimes(bodyText);
    }

    if (!date && likelyBookingPage) {
      date = chooseBestFutureDate([bodyText]);
    }

    times = cleanAppointmentTimes(times);

    const status =
      times.length > 0
        ? "available_times_found"
        : stayedInsideVagaro
        ? "marketplace_business_found_no_times_yet"
        : "redirected_outside_vagaro";

    await page.close();

    return {
      ...business,
      service,
      date,
      times,
      status,
      scrapeDurationMs: Date.now() - started,
      lastChecked: new Date().toISOString(),
      vagaroDebug: {
        inspectedBusinessPage: true,
        usefulResponseCount: usefulResponses.length,
        highValueResponseCount: highValueResponses.length,
        clickedBookingFlow: clicks > 0 && likelyBookingPage,
        likelyBookingPage,
        stayedInsideVagaro,
        clickedTargets,
        finalUrl
      }
    };
  } catch (error) {
    try {
      await page.close();
    } catch {
      // ignore close failure
    }

    return {
      ...business,
      service,
      date: null,
      times: [],
      status: "vagaro_business_inspection_failed",
      scrapeDurationMs: Date.now() - started,
      lastChecked: new Date().toISOString(),
      error: error.message
    };
  }
}

async function scrapeVagaroMarketplace(options = {}) {
  const {
    city = DEFAULT_CITY,
    state = DEFAULT_STATE,
    service = DEFAULT_SERVICE,
    limit = DEFAULT_LIMIT,
    inspectBusinessPages = true
  } = options;

  const marketplaceUrl = buildMarketplaceUrl({ city, state, service });

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 1200 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  });

  const page = await context.newPage();

  try {
    console.log(`Searching Vagaro marketplace: ${marketplaceUrl}`);

    const businesses = await extractMarketplaceBusinesses(
      page,
      marketplaceUrl,
      service
    );

    const limitedBusinesses = businesses.slice(0, limit);

    console.log(
      `Vagaro marketplace businesses found: ${businesses.length}. Inspecting: ${limitedBusinesses.length}`
    );

    console.log(
      "BUSINESSES:",
      limitedBusinesses.map((business) => ({
        businessName: business.businessName,
        bookingUrl: business.bookingUrl
      }))
    );

    if (!inspectBusinessPages) {
      await browser.close();
      return limitedBusinesses;
    }

    const results = [];

    for (const business of limitedBusinesses) {
      console.log(`Inspecting Vagaro business: ${business.businessName}`);

      const result = await inspectBusinessForAvailability(context, business, {
        service
      });

      results.push(result);
    }

    await browser.close();
    return results;
  } catch (error) {
    try {
      await browser.close();
    } catch {
      // ignore close failure
    }

    return [
      {
        businessName: "Vagaro Marketplace",
        bookingUrl: marketplaceUrl,
        platform: "vagaro",
        service,
        provider: "Vagaro Marketplace",
        date: null,
        times: [],
        status: "vagaro_marketplace_failed",
        attemptNumber: 1,
        scrapeDurationMs: null,
        lastChecked: new Date().toISOString(),
        error: error.message
      }
    ];
  }
}

module.exports = scrapeVagaroMarketplace;
module.exports.scrapeVagaroMarketplace = scrapeVagaroMarketplace;
module.exports.buildMarketplaceUrl = buildMarketplaceUrl;