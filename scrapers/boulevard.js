"use strict";

const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_DAYS_FORWARD = 7;
const MAX_DAYS_FORWARD = 31;
const EMAIL_ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_START_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const DISPLAY_TIME_PATTERN = /\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/i;

function clean(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function stripServicePrefix(value) {
  return clean(value).replace(/^s_/i, "");
}

function isVerifiedBusiness(business = {}) {
  const status = normalize(
    business.verificationStatus ||
      business.verification_status ||
      business.claimStatus ||
      ""
  );

  return (
    business.claimed === true ||
    business.verified === true ||
    status === "verified" ||
    status === "claimed verified" ||
    status === "claimed_verified"
  );
}

function validateBoulevardAuthorization(business = {}) {
  if (business.boulevardOptIn !== true) {
    throw new Error(
      "Boulevard scraping is disabled: boulevardOptIn must be true after the business explicitly authorizes availability checks."
    );
  }

  if (!isVerifiedBusiness(business)) {
    throw new Error(
      "Boulevard scraping is limited to verified/claimed businesses that explicitly opt in."
    );
  }
}

function resolveAuthorizedEmail(business = {}, env = process.env) {
  const envName = clean(
    business.boulevardAuthorizedEmailEnv || business.boulevardEmailEnv
  );

  if (!envName) {
    throw new Error(
      "Boulevard authorized email is not configured. Set boulevardAuthorizedEmailEnv on the business and add that environment variable to Render."
    );
  }

  if (!EMAIL_ENV_NAME_PATTERN.test(envName)) {
    throw new Error(
      "boulevardAuthorizedEmailEnv must be an uppercase environment-variable name containing only letters, digits, and underscores."
    );
  }

  const email = clean(env[envName]);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(
      `Boulevard authorized email environment variable ${envName} is missing or invalid.`
    );
  }

  return { email, envName };
}

function normalizeWidgetUrl(business = {}) {
  const explicitUrl = clean(
    business.boulevardWidgetUrl ||
      business.boulevardBookingUrl ||
      business.bookingUrl
  );

  if (explicitUrl) {
    let parsed;

    try {
      parsed = new URL(explicitUrl);
    } catch {
      throw new Error("Boulevard widget URL is not a valid absolute URL.");
    }

    if (parsed.protocol !== "https:") {
      throw new Error("Boulevard widget URL must use HTTPS.");
    }

    const allowedHost =
      parsed.hostname === "www.joinblvd.com" ||
      parsed.hostname === "joinblvd.com";

    if (allowedHost && /^\/b\/[^/]+\/widget\/?$/i.test(parsed.pathname)) {
      parsed.hash = "";
      return parsed.toString();
    }

    if (
      business.boulevardAllowCustomBookingHost === true &&
      parsed.hostname &&
      !parsed.username &&
      !parsed.password
    ) {
      parsed.hash = "";
      return parsed.toString();
    }

    if (business.boulevardBusinessId) {
      return `https://www.joinblvd.com/b/${encodeURIComponent(
        clean(business.boulevardBusinessId)
      )}/widget`;
    }

    throw new Error(
      "Use the direct Boulevard widget URL (https://www.joinblvd.com/b/.../widget) or configure boulevardBusinessId."
    );
  }

  if (business.boulevardBusinessId) {
    return `https://www.joinblvd.com/b/${encodeURIComponent(
      clean(business.boulevardBusinessId)
    )}/widget`;
  }

  throw new Error(
    "Boulevard widget URL is missing. Configure boulevardWidgetUrl or boulevardBusinessId."
  );
}

function addDays(dateKey, numberOfDays) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + numberOfDays, 12));
  return date.toISOString().slice(0, 10);
}

function todayInTimezone(timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function getScrapeWindow(business = {}) {
  const timezone = clean(business.timezone) || DEFAULT_TIMEZONE;
  const startDate = DATE_KEY_PATTERN.test(clean(business.scrapeStartDate))
    ? clean(business.scrapeStartDate)
    : todayInTimezone(timezone);

  let daysForward = Number(business.daysForward || DEFAULT_DAYS_FORWARD);
  if (!Number.isFinite(daysForward) || daysForward < 1) {
    daysForward = DEFAULT_DAYS_FORWARD;
  }
  daysForward = Math.min(MAX_DAYS_FORWARD, Math.ceil(daysForward));

  const requestedEnd = clean(business.scrapeEndDate);
  const endDate = DATE_KEY_PATTERN.test(requestedEnd)
    ? requestedEnd
    : addDays(startDate, daysForward - 1);

  return { startDate, endDate, daysForward, timezone };
}

function formatWallTime(hour24, minute) {
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function parseIsoWallTime(value, timezone = DEFAULT_TIMEZONE) {
  const match = clean(value).match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$/
  );
  if (!match) return null;

  if (match[4]) {
    const instant = new Date(clean(value));
    if (!Number.isNaN(instant.getTime())) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).formatToParts(instant);
      const values = Object.fromEntries(
        parts
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, part.value])
      );
      const hour24 = Number(values.hour) % 24;
      return {
        localDateKey: `${values.year}-${values.month}-${values.day}`,
        time: formatWallTime(hour24, Number(values.minute)),
        startTime: clean(value)
      };
    }
  }

  return {
    localDateKey: match[1],
    time: formatWallTime(Number(match[2]), Number(match[3])),
    startTime: clean(value)
  };
}

function extractBookableStartTimes(payload) {
  const found = new Set();

  function visit(value, key = "") {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }

    if (!value || typeof value !== "object") return;

    Object.entries(value).forEach(([childKey, childValue]) => {
      if (
        typeof childValue === "string" &&
        /^(startTime|startAt|startDateTime)$/i.test(childKey) &&
        ISO_START_PATTERN.test(childValue)
      ) {
        found.add(childValue);
      }

      visit(childValue, childKey);
    });
  }

  visit(payload);
  return [...found].sort();
}

function extractBookableDateKeys(payload) {
  const found = new Set();

  function visit(value, parentKey = "") {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, parentKey));
      return;
    }

    if (!value || typeof value !== "object") return;

    Object.entries(value).forEach(([childKey, childValue]) => {
      if (
        typeof childValue === "string" &&
        DATE_KEY_PATTERN.test(childValue) &&
        /date/i.test(childKey + parentKey)
      ) {
        found.add(childValue);
      }
      visit(childValue, childKey);
    });
  }

  visit(payload);
  return [...found].sort();
}

function attachGraphQlCollector(page) {
  const state = {
    dates: new Set(),
    starts: new Set(),
    operations: new Set()
  };

  const handler = async (response) => {
    try {
      const request = response.request();
      if (request.method() !== "POST") return;

      let requestBody = null;
      try {
        requestBody = request.postDataJSON();
      } catch {
        requestBody = null;
      }

      const operationName = clean(requestBody && requestBody.operationName);
      const query = clean(requestBody && requestBody.query);
      const isBookableResponse = /cartBookable(Dates|Times)/i.test(
        `${operationName} ${query}`
      );

      if (!isBookableResponse) return;
      if (operationName) state.operations.add(operationName);

      const payload = await response.json();
      extractBookableDateKeys(payload).forEach((date) => state.dates.add(date));
      extractBookableStartTimes(payload).forEach((start) => state.starts.add(start));
    } catch {
      // Network-response collection is supplemental; visible UI extraction remains available.
    }
  };

  page.on("response", handler);

  return {
    state,
    detach() {
      page.off("response", handler);
    }
  };
}

async function isVisible(locator) {
  try {
    return (await locator.count()) > 0 && (await locator.first().isVisible());
  } catch {
    return false;
  }
}

async function clickIfVisible(locator, timeout = 7000) {
  if (!(await isVisible(locator))) return false;
  await locator.first().click({ timeout });
  return true;
}

async function fillIfVisible(locator, value, timeout = 7000) {
  if (!(await isVisible(locator))) return false;
  await locator.first().fill(value, { timeout });
  return true;
}

async function clickInitialBookingOption(page) {
  const candidates = [
    page.getByRole("button", { name: /Individual Appointment/i }),
    page.getByRole("button", { name: /^Appointment$/i }),
    page.getByText("Individual Appointment", { exact: true })
  ];

  for (const candidate of candidates) {
    if (await clickIfVisible(candidate)) return true;
  }
  return false;
}

async function selectLocationIfNeeded(page, business = {}) {
  const locationName = clean(
    business.boulevardLocationName || business.locationName
  );
  if (!locationName) return false;

  const candidates = [
    page.getByRole("button", { name: new RegExp(locationName, "i") }),
    page.getByRole("link", { name: new RegExp(locationName, "i") }),
    page.getByText(locationName, { exact: true })
  ];

  for (const candidate of candidates) {
    if (await clickIfVisible(candidate)) return true;
  }
  return false;
}

async function selectCategory(page, business = {}) {
  const categoryName = clean(
    business.categoryName || business.categoryText || business.boulevardCategoryName
  );
  if (!categoryName) return;

  const candidates = [
    page.getByRole("link", { name: categoryName, exact: true }),
    page.getByRole("button", { name: categoryName, exact: true }),
    page.getByText(categoryName, { exact: true })
  ];

  for (const candidate of candidates) {
    if (await clickIfVisible(candidate)) return;
  }

  throw new Error(`Boulevard category not found: ${categoryName}`);
}

async function selectService(page, business = {}) {
  const serviceName = clean(business.serviceName || business.service);
  const serviceId = stripServicePrefix(
    business.platformServiceId || business.serviceId || business.serviceButtonId
  );

  if (serviceId) {
    const byHref = page.locator(
      `a[href*="s_${serviceId}"], a[href*="${serviceId}"]`
    );
    if (await clickIfVisible(byHref)) return;
  }

  if (serviceName) {
    const candidates = [
      page.getByRole("link", { name: serviceName, exact: true }),
      page.getByRole("button", { name: serviceName, exact: true }),
      page.getByText(serviceName, { exact: true })
    ];

    for (const candidate of candidates) {
      if (await clickIfVisible(candidate)) return;
    }
  }

  throw new Error(
    `Boulevard service not found: ${serviceName || serviceId || "missing service configuration"}`
  );
}

async function chooseFirstAvailableAndAdd(page) {
  const selectButton = page.getByRole("button", {
    name: /Select a professional|Select professional/i
  });
  if (await clickIfVisible(selectButton)) {
    await page.waitForTimeout(250);
  }

  const firstAvailable = page.getByRole("radio", { name: /First Available/i });
  if (await isVisible(firstAvailable)) {
    if (!(await firstAvailable.first().isChecked())) {
      await firstAvailable.first().check();
    }
  } else {
    const firstAvailableText = page.getByText("First Available", { exact: true });
    if (await isVisible(firstAvailableText)) {
      await firstAvailableText.first().click();
    }
  }

  const addButton = page.getByRole("button", { name: /^Add$/i });
  if (!(await clickIfVisible(addButton))) {
    throw new Error("Boulevard Add button was not available after selecting First Available.");
  }

  await page.waitForTimeout(300);

  const nextButton = page.getByRole("button", { name: /^Next$/i });
  if (!(await clickIfVisible(nextButton))) {
    throw new Error("Boulevard cart Next button was not found.");
  }
}

async function submitAuthorizedEmail(page, email) {
  const candidates = [
    page.locator('input[type="email"]'),
    page.locator('input[autocomplete="email"]'),
    page.getByPlaceholder(/phone number or email|email/i),
    page.getByRole("textbox", { name: /phone number or email|email/i })
  ];

  let input = null;
  for (const candidate of candidates) {
    if (await isVisible(candidate)) {
      input = candidate.first();
      break;
    }
  }

  if (!input) {
    throw new Error("Boulevard email field was not found after opening the cart.");
  }

  await input.fill(email);
  await page.waitForTimeout(200);

  const submitCandidates = [
    page.getByRole("button", { name: /Continue|View Times|Find Times|Submit/i }),
    page.locator('button[type="submit"]')
  ];

  for (const candidate of submitCandidates) {
    if (await clickIfVisible(candidate)) return;
  }

  await input.press("Enter");
}

async function assertNoAuthenticationChallenge(page) {
  const bodyText = clean(await page.locator("body").innerText().catch(() => ""));
  if (
    /verification code|enter (the )?code|one[- ]time code|enter your password|check your email/i.test(
      bodyText
    )
  ) {
    throw new Error(
      "Boulevard requested authentication for the authorized email. Use a dedicated opt-in email that is not linked to an online-booking account, or use Boulevard Client API credentials."
    );
  }
}

function parseDateCandidate(rawCandidate, todayKey) {
  const direct = clean(rawCandidate.dateValue);
  if (DATE_KEY_PATTERN.test(direct)) return direct;

  const label = clean(rawCandidate.label);
  const isoMatch = label.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  if (!/[A-Za-z]{3,9}/.test(label) || !/\b\d{1,2}\b/.test(label)) {
    return "";
  }

  const currentYear = Number(todayKey.slice(0, 4));

  if (/\b20\d{2}\b/.test(label)) {
    const parsedWithYear = new Date(`${label} 12:00:00`);
    if (!Number.isNaN(parsedWithYear.getTime())) {
      return [
        parsedWithYear.getFullYear(),
        String(parsedWithYear.getMonth() + 1).padStart(2, "0"),
        String(parsedWithYear.getDate()).padStart(2, "0")
      ].join("-");
    }
  }

  for (const year of [currentYear, currentYear + 1]) {
    const parsed = new Date(`${label} ${year} 12:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      const dateKey = [
        parsed.getFullYear(),
        String(parsed.getMonth() + 1).padStart(2, "0"),
        String(parsed.getDate()).padStart(2, "0")
      ].join("-");

      if (dateKey >= addDays(todayKey, -14)) return dateKey;
    }
  }

  return "";
}

async function getDateCandidates(page, todayKey) {
  const rawCandidates = await page
    .locator('button, [role="button"], [role="tab"]')
    .evaluateAll((elements) =>
      elements.map((element, index) => ({
        index,
        label:
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.textContent ||
          "",
        dateValue:
          element.getAttribute("data-date") ||
          element.getAttribute("datetime") ||
          element.getAttribute("data-value") ||
          "",
        disabled:
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true"
      }))
    );

  return rawCandidates
    .map((candidate) => ({
      ...candidate,
      label: clean(candidate.label),
      dateKey: parseDateCandidate(candidate, todayKey)
    }))
    .filter((candidate) => candidate.dateKey && !candidate.disabled)
    .filter((candidate) => !DISPLAY_TIME_PATTERN.test(candidate.label));
}

async function getSelectedDateKey(page, todayKey) {
  const selected = page.locator(
    '[aria-selected="true"], [aria-current="date"], [data-selected="true"]'
  );

  if ((await selected.count()) === 0) return "";

  const value = await selected.first().evaluate((element) => ({
    label:
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.textContent ||
      "",
    dateValue:
      element.getAttribute("data-date") ||
      element.getAttribute("datetime") ||
      element.getAttribute("data-value") ||
      ""
  }));

  return parseDateCandidate(value, todayKey);
}

async function getVisibleTimes(page) {
  const texts = await page
    .locator('button, [role="button"], [role="option"]')
    .allTextContents();

  const found = new Set();
  texts.forEach((text) => {
    const match = clean(text).match(DISPLAY_TIME_PATTERN);
    if (match) {
      found.add(`${Number(match[1])}:${match[2]} ${match[3].toUpperCase()}`);
    }
  });
  return [...found];
}

function buildAppointment(business, localDateKey, time, startTime = "") {
  return {
    businessName: business.businessName || business.name || "",
    platform: "boulevard",
    bookingUrl: business.bookingUrl || business.boulevardWidgetUrl || "",
    service: business.serviceName || business.service || "",
    serviceName: business.serviceName || business.service || "",
    serviceType: business.serviceType || "",
    durationMinutes: business.durationMinutes || null,
    platformServiceId:
      business.platformServiceId || business.serviceId || business.serviceButtonId || null,
    provider: "First Available",
    therapistName: "First Available",
    localDateKey,
    date: localDateKey,
    time,
    rawTime: time,
    startTime: startTime || undefined,
    sourceType: "confirmed"
  };
}

function appointmentsFromCapturedStarts(starts, business, window) {
  return starts
    .map((start) => parseIsoWallTime(start, window.timezone || business.timezone))
    .filter(Boolean)
    .filter(
      (item) =>
        item.localDateKey >= window.startDate && item.localDateKey <= window.endDate
    )
    .map((item) =>
      buildAppointment(
        business,
        item.localDateKey,
        item.time,
        item.startTime
      )
    );
}

function dedupeAppointments(appointments) {
  const seen = new Set();
  return appointments.filter((appointment) => {
    const key = [
      appointment.localDateKey,
      normalize(appointment.time),
      normalize(appointment.serviceName),
      normalize(appointment.provider)
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function collectAvailabilityFromUi(page, business, window, collector) {
  const appointments = [];
  const clickedDates = new Set();
  const maxPages = Math.min(8, Math.ceil(window.daysForward / 5) + 2);

  await page.waitForTimeout(600);

  for (let readinessAttempt = 0; readinessAttempt < 16; readinessAttempt += 1) {
    await assertNoAuthenticationChallenge(page);
    const candidates = await getDateCandidates(page, window.startDate);
    const visibleTimes = await getVisibleTimes(page);
    if (
      candidates.length ||
      visibleTimes.length ||
      collector.state.dates.size ||
      collector.state.starts.size
    ) {
      break;
    }
    await page.waitForTimeout(400);
  }

  await assertNoAuthenticationChallenge(page);

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const candidates = await getDateCandidates(page, window.startDate);

    for (const candidate of candidates) {
      if (
        candidate.dateKey < window.startDate ||
        candidate.dateKey > window.endDate ||
        clickedDates.has(candidate.dateKey)
      ) {
        continue;
      }

      const buttons = page.locator('button, [role="button"], [role="tab"]');
      const target = buttons.nth(candidate.index);
      if (!(await isVisible(target))) continue;

      await target.click({ timeout: 7000 });
      clickedDates.add(candidate.dateKey);
      await page.waitForTimeout(350);

      const visibleTimes = await getVisibleTimes(page);
      visibleTimes.forEach((time) => {
        appointments.push(buildAppointment(business, candidate.dateKey, time));
      });
    }

    const graphAppointments = appointmentsFromCapturedStarts(
      [...collector.state.starts],
      business,
      window
    );
    appointments.push(...graphAppointments);

    const latestCandidate = candidates
      .map((candidate) => candidate.dateKey)
      .sort()
      .pop();

    if (latestCandidate && latestCandidate >= window.endDate) break;

    const nextDateControl = page.getByRole("button", {
      name: /next (week|dates|date range|month)/i
    });

    if (!(await clickIfVisible(nextDateControl, 4000))) break;
    await page.waitForTimeout(350);
  }

  if (!appointments.length) {
    const selectedDate = await getSelectedDateKey(page, window.startDate);
    if (selectedDate) {
      const visibleTimes = await getVisibleTimes(page);
      visibleTimes.forEach((time) => {
        appointments.push(buildAppointment(business, selectedDate, time));
      });
    }
  }

  appointments.push(
    ...appointmentsFromCapturedStarts([...collector.state.starts], business, window)
  );

  return dedupeAppointments(appointments);
}

async function scrapeBoulevardBusiness(page, business = {}) {
  const startedAt = Date.now();
  validateBoulevardAuthorization(business);
  const { email } = resolveAuthorizedEmail(business);
  const widgetUrl = normalizeWidgetUrl(business);
  const window = getScrapeWindow(business);
  const collector = attachGraphQlCollector(page);

  try {
    await page.goto(widgetUrl, {
      waitUntil: "domcontentloaded",
      timeout: Number(business.boulevardNavigationTimeoutMs || 30000)
    });

    await page.waitForTimeout(500);
    const selectedLocation = await selectLocationIfNeeded(page, business);
    if (selectedLocation) await page.waitForTimeout(500);
    await clickInitialBookingOption(page);
    await page.waitForTimeout(250);

    await selectCategory(page, business);
    await page.waitForTimeout(250);
    await selectService(page, business);
    await page.waitForTimeout(250);
    await chooseFirstAvailableAndAdd(page);
    await page.waitForTimeout(250);
    await submitAuthorizedEmail(page, email);

    const appointments = await collectAvailabilityFromUi(
      page,
      business,
      window,
      collector
    );

    return {
      businessName: business.businessName || business.name || "",
      bookingUrl: business.bookingUrl || widgetUrl,
      platform: "boulevard",
      service: business.serviceName || business.service || "",
      serviceName: business.serviceName || business.service || "",
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      platformServiceId:
        business.platformServiceId || business.serviceId || business.serviceButtonId || null,
      provider: "First Available",
      date: null,
      times: appointments.map((appointment) => appointment.startTime || appointment.time),
      appointments,
      openings: appointments,
      status: appointments.length ? "success" : "no_times_found",
      error: null,
      lastChecked: new Date().toISOString(),
      scrapeDurationMs: Date.now() - startedAt,
      scrapeStartDate: window.startDate,
      scrapeEndDate: window.endDate,
      daysForward: window.daysForward,
      boulevardMode: "authorized_widget",
      boulevardAvailabilityOperations: [...collector.state.operations]
    };
  } finally {
    collector.detach();
  }
}

module.exports = {
  scrapeBoulevardBusiness,
  validateBoulevardAuthorization,
  resolveAuthorizedEmail,
  normalizeWidgetUrl,
  getScrapeWindow,
  parseIsoWallTime,
  extractBookableStartTimes,
  extractBookableDateKeys,
  appointmentsFromCapturedStarts,
  dedupeAppointments
};