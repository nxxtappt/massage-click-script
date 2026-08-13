"use strict";

const DEFAULT_NAVIGATION_TIMEOUT_MS = 45000;
const DEFAULT_AVAILABILITY_TIMEOUT_MS = 12000;
const DEFAULT_RESPONSE_SETTLE_MS = 1200;
const DEFAULT_POST_CLICK_WAIT_MS = 350;
const MAX_CLICKABLE_CANDIDATES = 700;
const MAX_EXPAND_CONTROLS = 30;

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeJaneUrl(value = "") {
  let raw = String(value || "").trim();

  if (!raw) return "";

  raw = raw.replace(/\\_/g, "_");

  const markdownMatch = raw.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/i);
  if (markdownMatch) {
    raw = markdownMatch[1];
  }

  return raw.replace(/^<|>$/g, "").trim();
}

function isJaneHost(value = "") {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "janeapp.com" || host.endsWith(".janeapp.com");
  } catch {
    return false;
  }
}

function isJaneOpeningRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const hasStart = typeof value.start_at === "string" && value.start_at.includes("T");

  if (value._source === "dom_fallback") {
    return hasStart;
  }

  const hasTreatment = value.treatment_id !== undefined && value.treatment_id !== null;
  const hasLocation = value.location_id !== undefined && value.location_id !== null;

  return hasStart && hasTreatment && hasLocation;
}

function extractJaneOpenings(payload, options = {}) {
  const maxDepth = Number(options.maxDepth || 6);
  const openings = [];
  const seenObjects = new Set();

  function walk(value, depth) {
    if (depth > maxDepth || value === null || value === undefined) return;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (isJaneOpeningRecord(item)) {
          openings.push(item);
        } else if (item && typeof item === "object") {
          walk(item, depth + 1);
        }
      }
      return;
    }

    if (typeof value !== "object") return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);

    if (isJaneOpeningRecord(value)) {
      openings.push(value);
      return;
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") {
        walk(child, depth + 1);
      }
    }
  }

  walk(payload, 0);
  return openings;
}

function normalizeOpeningState(opening = {}) {
  return normalizeText(opening.status || opening.state || "");
}

function isBookableJaneOpening(opening = {}) {
  if (!isJaneOpeningRecord(opening)) return false;

  const state = normalizeOpeningState(opening);
  if (!state) return true;

  return ["opening", "open", "available"].includes(state);
}

function getDateKeyFromIso(value = "") {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})T/);
  return match ? match[1] : "";
}

function getTimeKeyFromIso(value = "") {
  const match = String(value || "").match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function formatDisplayTimeFromIso(value = "") {
  const timeKey = getTimeKeyFromIso(value);
  if (!timeKey) return "";

  let [hour, minute] = timeKey.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;

  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function getJaneDurationMinutes(opening = {}, business = {}) {
  const seconds = Number(opening.duration);

  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(1, Math.round(seconds / 60));
  }

  const configured = Number(business.durationMinutes);
  return Number.isFinite(configured) && configured > 0 ? configured : null;
}

function normalizeJaneOpening(opening = {}, business = {}) {
  const startAt = String(opening.start_at || "");
  const endAt = String(opening.end_at || "");
  const localDateKey = getDateKeyFromIso(startAt);
  const localTimeKey = getTimeKeyFromIso(startAt);
  const treatmentId =
    opening.treatment_id !== undefined && opening.treatment_id !== null
      ? String(opening.treatment_id)
      : "";
  const locationId =
    opening.location_id !== undefined && opening.location_id !== null
      ? String(opening.location_id)
      : "";
  const staffMemberId =
    opening.staff_member_id !== undefined && opening.staff_member_id !== null
      ? String(opening.staff_member_id)
      : "";

  return {
    businessName: business.businessName || business.name || "",
    platform: "jane",
    bookingUrl: sanitizeJaneUrl(business.bookingUrl),

    serviceName: business.serviceName || business.service || "",
    service: business.serviceName || business.service || "",
    serviceType: business.serviceType || "",
    serviceCategory: business.serviceType || "",
    durationMinutes: getJaneDurationMinutes(opening, business),
    platformServiceId:
      business.platformServiceId ||
      business.serviceId ||
      treatmentId ||
      null,

    providerId: staffMemberId || null,
    providerName: "",
    therapistName: "",

    appointmentStart: startAt,
    startTime: startAt,
    appointmentEnd: endAt,
    endTime: endAt,

    localDate: localDateKey,
    localDateKey,
    localTime: localTimeKey,
    localTimeKey,
    date: localDateKey,
    time: formatDisplayTimeFromIso(startAt),

    sourceType: "confirmed",
    status: "active",
    inventoryStatus: "active",

    janeTreatmentId: treatmentId || null,
    janeLocationId: locationId || null,
    janeStaffMemberId: staffMemberId || null,
    janeRoomId:
      opening.room_id !== undefined && opening.room_id !== null
        ? String(opening.room_id)
        : null,
    callToBook: opening.call_to_book ?? null,
    janeState: opening.state || opening.status || "opening",

    rawJson: opening
  };
}

function openingIdentity(opening = {}) {
  return [
    opening.location_id ?? "",
    opening.treatment_id ?? "",
    opening.staff_member_id ?? "",
    opening.start_at ?? "",
    opening.end_at ?? ""
  ].join("|");
}

function dedupeJaneOpenings(openings = []) {
  const seen = new Set();
  const output = [];

  for (const opening of openings) {
    if (!isBookableJaneOpening(opening)) continue;

    const key = openingIdentity(opening);
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(opening);
  }

  return output.sort((a, b) =>
    String(a.start_at || "").localeCompare(String(b.start_at || ""))
  );
}

function getTreatmentIdCounts(openings = []) {
  const counts = new Map();

  for (const opening of openings) {
    if (opening.treatment_id === undefined || opening.treatment_id === null) continue;
    const key = String(opening.treatment_id);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return counts;
}

function chooseTreatmentId(openings = [], configuredId = "", discoveredId = "") {
  if (configuredId !== undefined && configuredId !== null && String(configuredId).trim()) {
    return String(configuredId).trim();
  }

  if (discoveredId !== undefined && discoveredId !== null && String(discoveredId).trim()) {
    return String(discoveredId).trim();
  }

  const counts = getTreatmentIdCounts(openings);
  let bestId = "";
  let bestCount = -1;

  for (const [id, count] of counts.entries()) {
    if (count > bestCount) {
      bestId = id;
      bestCount = count;
    }
  }

  return bestId;
}

function filterToTreatment(openings = [], treatmentId = "") {
  if (!treatmentId) return openings;

  return openings.filter(
    (opening) => String(opening.treatment_id ?? "") === String(treatmentId)
  );
}

function filterToConfiguredDateWindow(openings = [], business = {}) {
  const startDate = String(business.scrapeStartDate || "");
  const endDate = String(business.scrapeEndDate || "");

  if (!startDate && !endDate) return openings;

  return openings.filter((opening) => {
    const dateKey = getDateKeyFromIso(opening.start_at);
    if (!dateKey) return true;
    if (startDate && dateKey < startDate) return false;
    if (endDate && dateKey > endDate) return false;
    return true;
  });
}

function scoreServiceCandidate(candidateText = "", desiredText = "") {
  const candidate = normalizeText(candidateText);
  const desired = normalizeText(desiredText);

  if (!candidate || !desired) return -1;
  if (candidate === desired) return 100000;

  const lengthPenalty = Math.max(0, candidate.length - desired.length);

  if (candidate.startsWith(desired)) return 90000 - lengthPenalty;
  if (candidate.includes(desired)) return 80000 - lengthPenalty;
  if (desired.includes(candidate) && candidate.length >= Math.min(8, desired.length)) {
    return 65000 - (desired.length - candidate.length);
  }

  const desiredTokens = desired.split(" ").filter((token) => token.length >= 2);
  const candidateTokens = new Set(candidate.split(" "));
  const matchedTokens = desiredTokens.filter((token) => candidateTokens.has(token));

  if (desiredTokens.length && matchedTokens.length === desiredTokens.length) {
    return 50000 - lengthPenalty;
  }

  return -1;
}

async function dismissCommonOverlays(page) {
  const labels = [
    "Accept",
    "Accept All",
    "Accept all",
    "Allow all",
    "Got it",
    "Close"
  ];

  for (const label of labels) {
    try {
      const button = page.getByRole("button", { name: label, exact: true }).first();
      if (await button.isVisible({ timeout: 300 }).catch(() => false)) {
        await button.click({ timeout: 1000 }).catch(() => null);
      }
    } catch {
      // Optional overlay only.
    }
  }
}

function getJaneLocationPath(value = "") {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/\/locations\/([^/]+)\/book(?:\/|$)/i);
    return match ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

function scoreLocationCandidate(candidateText = "", href = "", business = {}) {
  const candidate = normalizeText(candidateText);
  const hrefText = normalizeText(href);

  if (!candidate) return -1;

  const configuredSlug = normalizeText(
    business.janeLocationSlug || business.locationSlug || business.locationName || ""
  );
  const address = normalizeText(business.address || "");
  const city = normalizeText(business.city || "");

  let score = 0;

  if (configuredSlug) {
    if (candidate === configuredSlug) score += 100000;
    if (candidate.includes(configuredSlug)) score += 80000;
    if (hrefText.includes(configuredSlug)) score += 75000;
  }

  if (address) {
    if (candidate.includes(address)) {
      score += 70000;
    } else {
      const addressTokens = address
        .split(" ")
        .filter((token) => token.length >= 3 || /^\d+$/.test(token));
      const candidateTokens = new Set(candidate.split(" "));
      const matches = addressTokens.filter((token) => candidateTokens.has(token));
      const streetNumber = addressTokens.find((token) => /^\d+$/.test(token));

      if (streetNumber && candidateTokens.has(streetNumber)) score += 30000;
      score += matches.length * 3000;
    }
  }

  if (city && candidate.includes(city)) score += 5000;

  return score || -1;
}

async function collectJaneLocationCandidates(page) {
  const links = page.locator('a[href*="/locations/"][href*="/book"]');
  const count = Math.min(await links.count(), 100);
  const byHref = new Map();

  for (let index = 0; index < count; index += 1) {
    const element = links.nth(index);
    if (!(await element.isVisible().catch(() => false))) continue;

    const href = await element.getAttribute("href").catch(() => "");
    if (!href || !/\/locations\/[^/]+\/book/i.test(href)) continue;

    const absoluteHref = await element.evaluate((node) => node.href || node.getAttribute("href") || "")
      .catch(() => href);
    if (byHref.has(absoluteHref)) continue;

    const text = await element.innerText({ timeout: 600 }).catch(() => "");
    byHref.set(absoluteHref, {
      element,
      href: absoluteHref,
      text: text.replace(/\s+/g, " ").trim()
    });
  }

  return [...byHref.values()];
}

async function ensureJaneBookingLocation(page, business = {}) {
  const currentUrl = page.url();

  if (getJaneLocationPath(currentUrl)) {
    return {
      selected: false,
      locationUrl: currentUrl,
      reason: "already_location_specific"
    };
  }

  const candidates = await collectJaneLocationCandidates(page);
  if (!candidates.length) {
    return {
      selected: false,
      locationUrl: currentUrl,
      reason: "no_location_selector"
    };
  }

  let selected = null;

  if (candidates.length === 1) {
    selected = candidates[0];
  } else {
    const scored = candidates
      .map((candidate) => ({
        ...candidate,
        score: scoreLocationCandidate(candidate.text, candidate.href, business)
      }))
      .sort((a, b) => b.score - a.score);

    if (scored[0] && scored[0].score >= 10000) {
      selected = scored[0];
    }
  }

  if (!selected) {
    const options = candidates
      .map((candidate) => `${candidate.text || getJaneLocationPath(candidate.href)} => ${candidate.href}`)
      .slice(0, 10)
      .join(" | ");

    throw new Error(
      `Jane booking URL has multiple locations and no safe location match was found for saved address/location. Use a location-specific Jane booking URL or save a matching business address/location name. Options: ${options}`
    );
  }

  console.log(`[JANE] Selecting location: ${selected.text || selected.href}`);

  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => null),
    selected.element.click({ timeout: 5000 })
  ]);

  await page.waitForTimeout(350);

  return {
    selected: true,
    locationUrl: page.url(),
    reason: candidates.length === 1 ? "single_location" : "matched_saved_location",
    matchedText: selected.text,
    matchedHref: selected.href
  };
}

async function collectServiceCandidates(page) {
  const locator = page.locator(
    'a, button, [role="button"], [role="link"], [data-treatment-id], [data-treatment], [data-testid*="treatment" i]'
  );
  const count = Math.min(await locator.count(), MAX_CLICKABLE_CANDIDATES);
  const candidates = [];

  for (let index = 0; index < count; index += 1) {
    const element = locator.nth(index);

    const visible = await element.isVisible().catch(() => false);
    if (!visible) continue;

    const text = await element.innerText({ timeout: 600 }).catch(() => "");
    if (!normalizeText(text)) continue;

    candidates.push({ element, text, index });
  }

  return candidates;
}

function parseTreatmentIdFromString(value = "") {
  const text = String(value || "");
  const patterns = [
    /[?&](?:treatment_id|treatmentId|treatment)=([0-9]+)/i,
    /\/(?:treatments?|treatment)\/([0-9]+)(?:\/|$|[?#])/i,
    /(?:treatment[-_])([0-9]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return "";
}

async function discoverTreatmentIdFromElement(element) {
  if (!element) return "";

  try {
    const attributes = await element.evaluate((node) => {
      const names = [
        "data-treatment-id",
        "data-treatment",
        "data-treatment_id",
        "href",
        "id"
      ];

      const output = {};
      for (const name of names) output[name] = node.getAttribute?.(name) || "";
      return output;
    });

    for (const [name, value] of Object.entries(attributes || {})) {
      if (!value) continue;

      if (/treatment.*id/i.test(name) && /^\d+$/.test(String(value))) {
        return String(value);
      }

      const parsed = parseTreatmentIdFromString(value);
      if (parsed) return parsed;
    }
  } catch {
    // Not required for clicking.
  }

  return "";
}

async function findBestServiceCandidate(page, desiredServiceName) {
  const candidates = await collectServiceCandidates(page);
  let best = null;

  for (const candidate of candidates) {
    const score = scoreServiceCandidate(candidate.text, desiredServiceName);
    if (score < 0) continue;

    if (!best || score > best.score) {
      best = { ...candidate, score };
    }
  }

  return best;
}

async function expandCollapsedControls(page, desiredServiceName) {
  const controls = page.locator(
    'button[aria-expanded="false"], [role="button"][aria-expanded="false"], details:not([open]) > summary'
  );
  const count = Math.min(await controls.count(), MAX_EXPAND_CONTROLS);

  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible().catch(() => false))) continue;

    await control.click({ timeout: 1500 }).catch(() => null);
    await page.waitForTimeout(100);

    const candidate = await findBestServiceCandidate(page, desiredServiceName);
    if (candidate && candidate.score >= 80000) {
      return candidate;
    }
  }

  return findBestServiceCandidate(page, desiredServiceName);
}

async function clickJaneService(page, desiredServiceName) {
  let candidate = await findBestServiceCandidate(page, desiredServiceName);

  if (!candidate || candidate.score < 50000) {
    candidate = await expandCollapsedControls(page, desiredServiceName);
  }

  if (!candidate || candidate.score < 50000) {
    // Final fallback: exact visible text can still be clickable through a parent listener.
    const exactText = page.getByText(desiredServiceName, { exact: true }).first();
    if (await exactText.isVisible({ timeout: 1000 }).catch(() => false)) {
      const treatmentId = await discoverTreatmentIdFromElement(exactText);
      await exactText.click({ timeout: 5000 });
      return {
        matchedText: desiredServiceName,
        score: 100000,
        treatmentId,
        fallback: "exact_text"
      };
    }

    const visibleSamples = (await collectServiceCandidates(page))
      .map((item) => item.text.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 20);

    throw new Error(
      `Jane service not found: "${desiredServiceName}". Visible clickable text sample: ${visibleSamples.join(" | ")}`
    );
  }

  const treatmentId = await discoverTreatmentIdFromElement(candidate.element);

  await candidate.element.scrollIntoViewIfNeeded().catch(() => null);
  await candidate.element.click({ timeout: 7000 });

  return {
    matchedText: candidate.text.replace(/\s+/g, " ").trim(),
    score: candidate.score,
    treatmentId,
    fallback: "clickable_candidate"
  };
}

function createJaneResponseCollector(page) {
  const state = {
    openings: [],
    responses: [],
    lastCaptureAt: 0,
    enabled: true
  };

  const handler = async (response) => {
    if (!state.enabled) return;

    try {
      const request = response.request();
      const resourceType = request.resourceType();
      if (!["xhr", "fetch"].includes(resourceType)) return;
      if (response.status() < 200 || response.status() >= 400) return;

      const contentType = String(response.headers()["content-type"] || "").toLowerCase();
      if (contentType && !contentType.includes("json")) return;

      const payload = await response.json().catch(() => null);
      if (payload === null) return;

      const extracted = extractJaneOpenings(payload);
      if (!extracted.length) return;

      state.openings.push(...extracted);
      state.lastCaptureAt = Date.now();
      state.responses.push({
        url: response.url(),
        method: request.method(),
        status: response.status(),
        openingCount: extracted.length
      });
    } catch {
      // Ignore unrelated/non-JSON responses.
    }
  };

  page.on("response", handler);

  return {
    state,
    reset() {
      state.openings = [];
      state.responses = [];
      state.lastCaptureAt = 0;
    },
    stop() {
      state.enabled = false;
      page.off("response", handler);
    }
  };
}

async function waitForCollectedOpenings(page, collector, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_AVAILABILITY_TIMEOUT_MS);
  const settleMs = Number(options.settleMs || DEFAULT_RESPONSE_SETTLE_MS);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (
      collector.state.openings.length > 0 &&
      collector.state.lastCaptureAt > 0 &&
      Date.now() - collector.state.lastCaptureAt >= settleMs
    ) {
      return collector.state.openings;
    }

    await page.waitForTimeout(150);
  }

  return collector.state.openings;
}

async function extractSemanticDomOpenings(page, business = {}) {
  const records = await page.evaluate(() => {
    const output = [];
    const selectors = [
      "time[datetime]",
      "[data-start-at]",
      "[data-start_at]",
      "[data-start-time]",
      "[data-datetime]"
    ];

    const nodes = Array.from(document.querySelectorAll(selectors.join(",")));

    for (const node of nodes) {
      const values = [
        node.getAttribute("datetime"),
        node.getAttribute("data-start-at"),
        node.getAttribute("data-start_at"),
        node.getAttribute("data-start-time"),
        node.getAttribute("data-datetime")
      ].filter(Boolean);

      const startAt = values.find((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value));
      if (!startAt) continue;

      output.push({ start_at: startAt });
    }

    return output;
  }).catch(() => []);

  const configuredTreatmentId =
    business.platformServiceId || business.serviceId || business.treatmentId || null;
  const configuredLocationId = business.janeLocationId || business.locationId || null;
  const durationMinutes = Number(business.durationMinutes || 0);

  return records.map((record) => ({
    ...record,
    end_at: "",
    duration: durationMinutes > 0 ? durationMinutes * 60 : null,
    treatment_id: configuredTreatmentId,
    location_id: configuredLocationId,
    staff_member_id: null,
    state: "opening",
    status: "opening",
    call_to_book: null,
    _source: "dom_fallback"
  }));
}

function summarizeResponseEndpoints(responses = []) {
  const map = new Map();

  for (const response of responses) {
    const key = `${response.method} ${response.url}`;
    const existing = map.get(key) || {
      method: response.method,
      url: response.url,
      responses: 0,
      openings: 0
    };

    existing.responses += 1;
    existing.openings += Number(response.openingCount || 0);
    map.set(key, existing);
  }

  return [...map.values()];
}

async function scrapeJaneBusiness(page, business = {}, attemptNumber = 1) {
  if (!page || typeof page.goto !== "function") {
    throw new Error("Jane scraper requires a Playwright page.");
  }

  const startedAt = Date.now();
  const bookingUrl = sanitizeJaneUrl(business.bookingUrl);
  const serviceName = String(
    business.janeServiceName ||
    business.serviceMatchText ||
    business.serviceName ||
    business.service ||
    ""
  ).trim();

  if (!bookingUrl) {
    throw new Error("Jane bookingUrl is required.");
  }

  if (!isJaneHost(bookingUrl)) {
    throw new Error(`Jane bookingUrl must use janeapp.com. Received: ${bookingUrl}`);
  }

  if (!serviceName) {
    throw new Error("Jane serviceName is required.");
  }

  const navigationTimeoutMs = Number(
    business.janeNavigationTimeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS
  );
  const availabilityTimeoutMs = Number(
    business.janeAvailabilityTimeoutMs || DEFAULT_AVAILABILITY_TIMEOUT_MS
  );

  page.setDefaultTimeout(Math.min(navigationTimeoutMs, 15000));

  const collector = createJaneResponseCollector(page);

  let initialOpenings = [];
  let clickInfo = null;
  let locationInfo = null;
  let finalOpenings = [];

  try {
    console.log(`[JANE] Opening ${bookingUrl}`);

    await page.goto(bookingUrl, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs
    });

    await dismissCommonOverlays(page);
    await page.waitForTimeout(500);

    initialOpenings = dedupeJaneOpenings(collector.state.openings);

    let candidate = await findBestServiceCandidate(page, serviceName);

    if ((!candidate || candidate.score < 50000) && initialOpenings.length === 0) {
      locationInfo = await ensureJaneBookingLocation(page, business);
      await dismissCommonOverlays(page);
      await page.waitForTimeout(250);
      candidate = await findBestServiceCandidate(page, serviceName);
    }

    collector.reset();

    if (!candidate || candidate.score < 50000) {
      candidate = await expandCollapsedControls(page, serviceName);
    }

    if (candidate && candidate.score >= 50000) {
      collector.reset();
      clickInfo = await clickJaneService(page, serviceName);

      console.log(
        `[JANE] Selected service "${clickInfo.matchedText}"` +
        (clickInfo.treatmentId ? ` (treatment ${clickInfo.treatmentId})` : "")
      );

      await page.waitForTimeout(DEFAULT_POST_CLICK_WAIT_MS);

      finalOpenings = await waitForCollectedOpenings(page, collector, {
        timeoutMs: availabilityTimeoutMs
      });
    } else if (initialOpenings.length > 0) {
      console.log(
        "[JANE] Booking URL loaded availability directly; using initial Jane opening response."
      );
      finalOpenings = initialOpenings;
    } else {
      // clickJaneService gives the more useful diagnostic message.
      collector.reset();
      clickInfo = await clickJaneService(page, serviceName);
      finalOpenings = await waitForCollectedOpenings(page, collector, {
        timeoutMs: availabilityTimeoutMs
      });
    }

    if (!finalOpenings.length && initialOpenings.length) {
      const discoveredId = clickInfo?.treatmentId || "";
      const matchingInitial = discoveredId
        ? filterToTreatment(initialOpenings, discoveredId)
        : [];

      if (matchingInitial.length) {
        console.log("[JANE] Reusing matching availability prefetched during page load.");
        finalOpenings = matchingInitial;
      }
    }

    if (!finalOpenings.length) {
      const domFallback = await extractSemanticDomOpenings(page, business);
      if (domFallback.length) {
        console.log(`[JANE] Network capture empty; DOM fallback found ${domFallback.length} opening(s).`);
        finalOpenings = domFallback;
      }
    }

    finalOpenings = dedupeJaneOpenings(finalOpenings);

    const configuredTreatmentId =
      business.platformServiceId ||
      business.serviceId ||
      business.treatmentId ||
      "";

    const selectedTreatmentId = chooseTreatmentId(
      finalOpenings,
      configuredTreatmentId,
      clickInfo?.treatmentId || ""
    );

    finalOpenings = filterToTreatment(finalOpenings, selectedTreatmentId);
    finalOpenings = filterToConfiguredDateWindow(finalOpenings, business);
    finalOpenings = dedupeJaneOpenings(finalOpenings);

    const appointments = finalOpenings.map((opening) =>
      normalizeJaneOpening(opening, {
        ...business,
        bookingUrl,
        serviceName: business.serviceName || business.service || serviceName,
        platformServiceId:
          configuredTreatmentId || selectedTreatmentId || business.platformServiceId
      })
    );

    const times = appointments.map((appointment) => appointment.startTime).filter(Boolean);
    const uniqueLocationIds = [
      ...new Set(finalOpenings.map((opening) => String(opening.location_id ?? "")).filter(Boolean))
    ];
    const uniqueStaffIds = [
      ...new Set(finalOpenings.map((opening) => String(opening.staff_member_id ?? "")).filter(Boolean))
    ];

    console.log(
      `[JANE] ${business.businessName || "Business"} | ${business.serviceName || serviceName}: ${appointments.length} opening(s)`
    );

    return {
      businessName: business.businessName || business.name || "",
      bookingUrl,
      platform: "jane",
      service: business.serviceName || business.service || serviceName,
      serviceName: business.serviceName || business.service || serviceName,
      serviceType: business.serviceType || "",
      durationMinutes:
        Number(business.durationMinutes) || appointments[0]?.durationMinutes || null,
      platformServiceId: selectedTreatmentId || configuredTreatmentId || null,
      provider: "Any Available Practitioner",
      date: null,
      times,
      appointments,
      openings: appointments,
      status: appointments.length > 0 ? "success" : "no_times_found",
      attemptNumber,
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      scrapeStartDate: business.scrapeStartDate || "",
      scrapeEndDate: business.scrapeEndDate || "",
      lookaheadHours: business.lookaheadHours || 168,
      daysForward: business.daysForward || 7,
      scrapeWindowMode: business.scrapeWindowMode || "jane_default_7_days",
      janeDiagnostics: {
        matchedServiceText: clickInfo?.matchedText || "",
        discoveredTreatmentId: selectedTreatmentId || null,
        locationIds: uniqueLocationIds,
        staffMemberCount: uniqueStaffIds.length,
        responseEndpoints: summarizeResponseEndpoints(collector.state.responses),
        usedInitialAvailability: Boolean(!clickInfo && initialOpenings.length),
        locationSelection: locationInfo,
        finalBookingUrl: page.url(),
        openingCount: appointments.length
      }
    };
  } finally {
    collector.stop();
  }
}

module.exports = {
  scrapeJaneBusiness,

  // Exported for lightweight parser/unit testing without a live Jane site.
  extractJaneOpenings,
  isJaneOpeningRecord,
  isBookableJaneOpening,
  normalizeJaneOpening,
  dedupeJaneOpenings,
  chooseTreatmentId,
  filterToTreatment,
  filterToConfiguredDateWindow,
  scoreServiceCandidate,
  scoreLocationCandidate,
  sanitizeJaneUrl,
  getJaneLocationPath
};