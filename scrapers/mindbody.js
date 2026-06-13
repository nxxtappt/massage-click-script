function extractAppointmentTimes(text) {
  const timeRegex = /\b(1[0-2]|[1-9]):[0-5][0-9]\s?(AM|PM)\b/g;
  const matches = text.match(timeRegex) || [];
  return [...new Set(matches)];
}

function extractAvailabilityDate(text) {
  let dateMatch = text.match(/Availability for ([A-Za-z]+ \d{1,2}, \d{4})/);
  if (dateMatch) return dateMatch[1];

  dateMatch = text.match(/Go to ([A-Za-z]+ \d{1,2}, \d{4})/);
  if (dateMatch) return dateMatch[1];

  dateMatch = text.match(/fully booked for today, ([A-Za-z]+ \d{1,2}, \d{4})/);
  if (dateMatch) return dateMatch[1];

  dateMatch = text.match(/Next available appointment[\s\S]*?([A-Za-z]+ \d{1,2}, \d{4})/);
  if (dateMatch) return dateMatch[1];

  return null;
}

function determineStatus(text, times) {
  const lower = String(text || "").toLowerCase();

  if (times.length > 0) return "success";
  if (lower.includes("fully booked")) return "fully_booked";
  if (lower.includes("no appointments available")) return "no_times_found";
  if (lower.includes("your selection is fully booked")) return "fully_booked";

  if (
    lower.includes("select") &&
    !lower.includes("availability for") &&
    !lower.includes("select date & time") &&
    !lower.match(/\b(1[0-2]|[1-9]):[0-5][0-9]\s?(am|pm)\b/)
  ) {
    return "service_selection_failed";
  }

  return "unknown";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function formatDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateKey(value) {
  if (!isDateKey(value)) {
    return null;
  }

  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function parseMindbodyDisplayDate(value) {
  if (!value) {
    return "";
  }

  const parsed = new Date(`${value} 12:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return formatDateKey(parsed);
}

function getScrapeWindowPayload(business = {}) {
  return {
    scrapeStartDate: business.scrapeStartDate || "",
    scrapeEndDate: business.scrapeEndDate || "",
    lookaheadHours: business.lookaheadHours ? Number(business.lookaheadHours) : null,
    daysForward: business.daysForward ? Number(business.daysForward) : null,
    scrapeWindowMode: business.scrapeWindowMode || ""
  };
}

function dateIsInsideScrapeWindow(dateText, business = {}) {
  const dateKey = isDateKey(dateText)
    ? dateText
    : parseMindbodyDisplayDate(dateText);

  if (!dateKey) {
    return true;
  }

  const startDate = business.scrapeStartDate || "";
  const endDate = business.scrapeEndDate || "";

  if (isDateKey(startDate) && dateKey < startDate) {
    return false;
  }

  if (isDateKey(endDate) && dateKey > endDate) {
    return false;
  }

  return true;
}

function maybeApplyScrapeWindowToResult(result = {}, business = {}) {
  const windowPayload = getScrapeWindowPayload(business);

  const resultDateKey = result.date
    ? parseMindbodyDisplayDate(result.date)
    : "";

  if (result.date && !dateIsInsideScrapeWindow(result.date, business)) {
    return {
      ...result,
      ...windowPayload,
      times: [],
      status: "outside_scrape_window",
      originalStatus: result.status,
      scrapeWindowFiltered: true,
      scrapeWindowFilterReason:
        `Mindbody result date ${resultDateKey || result.date} is outside ${windowPayload.scrapeStartDate} to ${windowPayload.scrapeEndDate}.`
    };
  }

  return {
    ...result,
    ...windowPayload,
    scrapeWindowFiltered: false
  };
}

async function wait(page, ms = 1500) {
  await page.waitForTimeout(ms);
}

async function getBodyText(frame) {
  return await frame.locator("body").innerText().catch(() => "");
}

async function removeBlockingPageOverlays(page) {
  await page.evaluate(() => {
    const selectors = [
      ".newsletter__popup-overlay",
      ".js-popup-overlay",
      "#shopify-section-popup",
      "#shopify-chat",
      "#ShopifyChat",
      "inbox-online-store-chat",
      ".modal-overlay",
      ".popup-overlay",
      ".needsclick"
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        el.remove();
      });
    });

    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "auto";
  }).catch(() => null);
}

async function clickTextWithFallback(frame, text, options = {}) {
  const { exact = true, timeout = 5000, required = true } = options;

  if (!text) {
    if (required) throw new Error("Missing text to click.");
    return false;
  }

  const locator = frame.getByText(text, { exact });

  try {
    await locator.first().click({ timeout });
    return true;
  } catch {
    console.log(`Normal click failed for "${text}", trying JS click fallback...`);

    const clicked = await frame.evaluate(
      ({ targetText, exactMatch }) => {
        const normalize = (value) =>
          String(value || "").replace(/\s+/g, " ").trim();

        const wanted = normalize(targetText);
        const elements = Array.from(
          document.querySelectorAll("button, a, div, span, p, [role='button']")
        );

        const match = elements.find((el) => {
          const text = normalize(el.textContent);
          if (!text) return false;
          return exactMatch ? text === wanted : text.includes(wanted);
        });

        if (!match) return false;

        match.scrollIntoView({ block: "center", inline: "center" });
        match.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        match.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        match.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      },
      { targetText: text, exactMatch: exact }
    );

    if (!clicked && required) {
      throw new Error(`Could not click text: ${text}`);
    }

    return clicked;
  }
}

async function clickFirstMatchingText(frame, page, texts = [], options = {}) {
  for (const text of texts) {
    const clicked = await clickTextWithFallback(frame, text, {
      required: false,
      exact: options.exact !== false,
      timeout: options.timeout || 3500
    });

    if (clicked) {
      console.log(`Clicked optional step: ${text}`);
      await wait(page, options.waitAfter || 2500);
      return text;
    }
  }

  return null;
}

async function expandCategoryIfNeeded(frame, page, categoryText) {
  const wantedCategory = String(categoryText || "").toLowerCase().trim();
  if (!wantedCategory) return;

  const clicked = await frame.evaluate((wantedCategory) => {
    const normalize = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

    const bodyText = normalize(document.body.textContent);

    if (bodyText.includes(wantedCategory) && bodyText.includes("collapse")) {
      return true;
    }

    const elements = Array.from(document.querySelectorAll("*"));

    const expandElement = elements.find((el) => {
      const text = normalize(el.textContent);
      if (text !== "expand") return false;

      let parent = el.parentElement;
      let depth = 0;

      while (parent && depth < 8) {
        const parentText = normalize(parent.textContent);

        if (
          parentText.includes(wantedCategory) &&
          parentText.includes("expand")
        ) {
          return true;
        }

        parent = parent.parentElement;
        depth++;
      }

      return false;
    });

    if (!expandElement) return false;

    expandElement.scrollIntoView({ block: "center", inline: "center" });
    expandElement.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expandElement.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expandElement.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    return true;
  }, wantedCategory);

  if (clicked) {
    console.log(`Expanded category by JS event: ${categoryText}`);
    await wait(page, 4000);
  } else {
    console.log(`Could not find expandable category: ${categoryText}`);
  }
}

async function clickServiceButton(frame, page, business) {
  const serviceId =
    business.serviceButtonId ||
    business.platformServiceId ||
    business.serviceId ||
    "";

  if (!serviceId) {
    throw new Error(`Missing serviceButtonId/platformServiceId for ${business.serviceName}`);
  }

  console.log(`Clicking service: ${business.serviceName}`);
  console.log(`Service ID: ${serviceId}`);

  const clicked = await frame.evaluate((serviceId) => {
    const selectors = [
      `button[data-service-id="${serviceId}"]`,
      `[data-service-id="${serviceId}"] button`,
      `[data-service-id="${serviceId}"]`,
      `button[id="${serviceId}"]`,
      `#${serviceId}`
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;

      el.scrollIntoView({ block: "center", inline: "center" });
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      return true;
    }

    return false;
  }, serviceId);

  if (clicked) {
    await wait(page, 5000);
    return true;
  }

  const clickedByText = await clickTextWithFallback(frame, business.serviceName, {
    required: false,
    exact: true,
    timeout: 5000
  });

  if (clickedByText) {
    await wait(page, 5000);
    return true;
  }

  throw new Error(`Service button not found for ${business.serviceName} (${serviceId})`);
}

async function handleAddOnsIfPresent(frame, page) {
  const text = await getBodyText(frame);
  const lower = text.toLowerCase();

  const addOnLikely =
    lower.includes("add-on") ||
    lower.includes("addon") ||
    lower.includes("enhancement") ||
    lower.includes("upgrade") ||
    lower.includes("extras") ||
    lower.includes("no thanks");

  if (!addOnLikely) return false;

  const clicked = await clickFirstMatchingText(
    frame,
    page,
    [
      "No Thanks",
      "No thanks",
      "Skip",
      "Skip Add-ons",
      "Skip Add-Ons",
      "Continue without add-ons",
      "Continue Without Add-ons",
      "Continue"
    ],
    { waitAfter: 3500 }
  );

  return Boolean(clicked);
}

async function handleProviderIfPresent(frame, page, business) {
  if (business.skipProvider) {
    console.log("Skipping provider selection by config...");
    return false;
  }

  const text = await getBodyText(frame);
  const lower = text.toLowerCase();
  const providerText = business.providerText || "First Available";

  const providerLikely =
    lower.includes("select employee") ||
    lower.includes("select staff") ||
    lower.includes("select provider") ||
    lower.includes("choose employee") ||
    lower.includes("choose provider") ||
    lower.includes(String(providerText).toLowerCase());

  if (!providerLikely) {
    console.log("Provider step not detected. Continuing...");
    return false;
  }

  console.log(`Trying provider selection: ${providerText}`);

  const clicked = await clickFirstMatchingText(
    frame,
    page,
    [
      providerText,
      "First Available",
      "Any Staff",
      "Any Therapist",
      "No preference",
      "No Preference"
    ],
    { waitAfter: 3000 }
  );

  if (!clicked) {
    console.log("Provider option was not clickable. Continuing without provider click...");
    return false;
  }

  return true;
}

async function clickContinueIfPresent(frame, page) {
  const clicked = await clickFirstMatchingText(
    frame,
    page,
    ["Continue", "Next", "Select Date & Time", "View Availability"],
    { waitAfter: 7000 }
  );

  return Boolean(clicked);
}

async function clickNextAvailableIfNeeded(frame, page, business = {}) {
  let text = await getBodyText(frame);
  const nextAvailableMatch = text.match(/Go to ([A-Za-z]+ \d{1,2}, \d{4})/);

  if (!nextAvailableMatch) return text;

  const suggestedDate = nextAvailableMatch[1];

  if (!dateIsInsideScrapeWindow(suggestedDate, business)) {
    console.log(
      `[MINDBODY] Suggested next available date ${suggestedDate} is outside scrape window. Not clicking.`
    );

    return text;
  }

  const goToText = `Go to ${suggestedDate}`;

  console.log(`Clicking next available date: ${goToText}`);

  await clickTextWithFallback(frame, goToText, {
    required: false,
    exact: true,
    timeout: 6000
  });

  await wait(page, 10000);

  return await getBodyText(frame);
}

async function waitForProgressAfterService(frame, page) {
  for (let i = 0; i < 10; i++) {
    const text = await getBodyText(frame);
    const lower = text.toLowerCase();

    if (
      lower.includes("continue") ||
      lower.includes("select employee") ||
      lower.includes("select staff") ||
      lower.includes("select provider") ||
      lower.includes("add-on") ||
      lower.includes("addon") ||
      lower.includes("no thanks") ||
      lower.includes("select date & time") ||
      lower.includes("availability for") ||
      lower.includes("next available appointment") ||
      lower.includes("no appointments available") ||
      lower.includes("fully booked")
    ) {
      return text;
    }

    await wait(page, 1000);
  }

  return await getBodyText(frame);
}

async function runModernMindbodyFlow(frame, page, business) {
  await waitForProgressAfterService(frame, page);

  for (let step = 0; step < 6; step++) {
    const text = await getBodyText(frame);
    const lower = text.toLowerCase();

    if (
      lower.includes("availability for") ||
      lower.includes("select date & time") ||
      lower.includes("next available appointment") ||
      lower.includes("no appointments available") ||
      lower.includes("fully booked")
    ) {
      return text;
    }

    if (await handleAddOnsIfPresent(frame, page)) continue;

    if (await handleProviderIfPresent(frame, page, business)) {
      await clickContinueIfPresent(frame, page);
      continue;
    }

    if (await clickContinueIfPresent(frame, page)) continue;

    await wait(page, 1500);
  }

  return await getBodyText(frame);
}

async function scrapeMindbodyBusiness(page, business, attemptNumber) {
  const startedAt = Date.now();
  const scrapeWindow = getScrapeWindowPayload(business);

  console.log(
    `\n===== Scraping ${business.businessName} | ${business.serviceName} | Attempt ${attemptNumber} =====`
  );

  console.log("[MINDBODY] Scrape window:", {
    scrapeStartDate: scrapeWindow.scrapeStartDate,
    scrapeEndDate: scrapeWindow.scrapeEndDate,
    lookaheadHours: scrapeWindow.lookaheadHours,
    daysForward: scrapeWindow.daysForward,
    scrapeWindowMode: scrapeWindow.scrapeWindowMode
  });

  await page.goto(business.bookingUrl, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });

  await wait(page, 10000);

  await removeBlockingPageOverlays(page);
  await wait(page, 2000);

  const frame = page.frames().find((frame) =>
    frame.url().includes("go.mindbodyonline.com/book/widgets/appointments")
  );

  if (!frame) {
    throw new Error("Mindbody iframe not found.");
  }

  console.log(`Opening category: ${business.categoryText}`);

  await clickTextWithFallback(frame, business.categoryText, {
    required: false,
    exact: true,
    timeout: 5000
  }).catch(() => null);

  await wait(page, 3000);

  await expandCategoryIfNeeded(frame, page, business.categoryText);

  await clickServiceButton(frame, page, business);

  let text = await runModernMindbodyFlow(frame, page, business);

  text = await clickNextAvailableIfNeeded(frame, page, business);

  const times = extractAppointmentTimes(text);
  const date = extractAvailabilityDate(text);
  const status = determineStatus(text, times);

  console.log("----- FINAL WIDGET TEXT -----");
  console.log(text);

  const result = {
    businessName: business.businessName,
    bookingUrl: business.bookingUrl,
    platform: business.platform,
    service: business.serviceName,
    serviceName: business.serviceName,
    serviceType: business.serviceType || "",
    durationMinutes: business.durationMinutes || null,
    platformServiceId:
      business.platformServiceId ||
      business.serviceButtonId ||
      business.serviceId ||
      null,
    provider: business.skipProvider
      ? "Auto-selected"
      : business.providerText || "First Available",
    date,
    times,
    status,
    attemptNumber,
    scrapeDurationMs: Date.now() - startedAt,
    lastChecked: new Date().toISOString(),
    rawWidgetText: text,
    ...scrapeWindow
  };

  return maybeApplyScrapeWindowToResult(result, business);
}

module.exports = {
  scrapeMindbodyBusiness
};