// scrapers/booker.js
//
// Supports both:
//   1. A general Booker service-menu URL stored at the business/integration level.
//   2. A legacy service-specific /availability/{date}/ URL.
//
// General-menu flow:
//   Booking URL -> configured service -> Just Me -> Continue
//   -> Any available staff -> availability dates/times

const DEFAULT_TIMEOUT_MS = 90000;
const SHORT_TIMEOUT_MS = 10000;
const DEFAULT_TIMEZONE = "America/Chicago";

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/minutes?/g, "min")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDateYYYYMMDD(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function parseDateKey(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ""))) {
    return null;
  }

  const [year, month, day] = String(dateText).split("-").map(Number);
  const parsed = new Date(year, month - 1, day, 12, 0, 0);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() + 1 !== month ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function getTodayLocalDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIMEZONE,
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

  return new Date(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    12,
    0,
    0
  );
}

function extractDateFromBookerUrl(url) {
  const match = String(url || "").match(
    /\/availability\/(\d{4}-\d{2}-\d{2})(?:\/|$)/i
  );

  return match ? match[1] : null;
}

function isPastDate(dateText) {
  if (!dateText) return false;
  return dateText < formatDateYYYYMMDD(getTodayLocalDate());
}

function isBookerAvailabilityUrl(url) {
  return /\/availability(?:\/|$)/i.test(String(url || ""));
}

function buildBookerDateUrl(url, date) {
  const raw = String(url || "");

  if (!raw) return "";

  if (raw.includes("{date}")) {
    return raw.replaceAll("{date}", date);
  }

  if (/\/availability\/\d{4}-\d{2}-\d{2}(?:\/|$)/i.test(raw)) {
    return raw.replace(
      /\/availability\/\d{4}-\d{2}-\d{2}(?=\/|$)/i,
      `/availability/${date}`
    );
  }

  return raw;
}

function getBookerLocationParts(...urls) {
  for (const candidate of urls) {
    if (!candidate) continue;

    try {
      const parsed = new URL(candidate);
      const match = parsed.pathname.match(/\/location\/([^/]+)/i);

      if (match) {
        return {
          origin: parsed.origin,
          locationSlug: match[1]
        };
      }
    } catch {
      // Try the next URL.
    }
  }

  return null;
}

function buildDynamicServiceUrl(business, currentUrl) {
  const location = getBookerLocationParts(currentUrl, business.bookingUrl);
  const serviceId = String(
    business.platformServiceId ||
      business.serviceId ||
      business.serviceButtonId ||
      ""
  ).trim();
  const serviceName = cleanText(business.serviceName);

  if (!location || !serviceId || !serviceName) {
    return "";
  }

  return (
    `${location.origin}/location/${location.locationSlug}` +
    `/service/${encodeURIComponent(serviceId)}` +
    `/${encodeURIComponent(serviceName)}`
  );
}

function urlContainsRequestedService(url, business = {}) {
  const serviceId = String(
    business.platformServiceId ||
      business.serviceId ||
      business.serviceButtonId ||
      ""
  ).trim();

  if (!serviceId) {
    return true;
  }

  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    return new RegExp(`/service/${serviceId}(?:/|$)`, "i").test(pathname);
  } catch {
    return new RegExp(`/service/${serviceId}(?:/|$)`, "i").test(
      decodeURIComponent(String(url || ""))
    );
  }
}

function buildDynamicAvailabilityFallbackUrl(business, currentUrl, date) {
  const location = getBookerLocationParts(currentUrl, business.bookingUrl);
  const serviceId = String(
    business.platformServiceId ||
      business.serviceId ||
      business.serviceButtonId ||
      ""
  ).trim();
  const serviceName = cleanText(business.serviceName);

  if (!location || !serviceId || !serviceName) {
    return "";
  }

  return (
    `${location.origin}/location/${location.locationSlug}` +
    `/service/${encodeURIComponent(serviceId)}` +
    `/${encodeURIComponent(serviceName)}` +
    `/availability/${date}/all-providers`
  );
}

function getScrapeWindowDates(business = {}) {
  const today = formatDateYYYYMMDD(getTodayLocalDate());

  const explicitStartDate = parseDateKey(business.scrapeStartDate)
    ? business.scrapeStartDate
    : "";
  const explicitEndDate = parseDateKey(business.scrapeEndDate)
    ? business.scrapeEndDate
    : "";

  if (explicitStartDate || explicitEndDate) {
    const startDate = explicitStartDate || today;
    const endDate = explicitEndDate || startDate;

    return {
      startDate,
      endDate,
      source: business.scrapeWindowMode || "scrape_window"
    };
  }

  const originalDate = extractDateFromBookerUrl(business.bookingUrl);
  const safeOriginalDate = isPastDate(originalDate) ? "" : originalDate;
  const startDate = safeOriginalDate || today;
  const daysForward = Math.max(1, Number(business.daysForward || 7));
  const endDate = formatDateYYYYMMDD(
    addDays(parseDateKey(startDate), daysForward - 1)
  );

  return {
    startDate,
    endDate,
    source: "legacy_days_forward"
  };
}

function buildDateList(startDate, endDate) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);

  if (!start || !end || start.getTime() > end.getTime()) {
    return [];
  }

  const dates = [];
  let cursor = start;

  while (cursor.getTime() <= end.getTime()) {
    dates.push(formatDateYYYYMMDD(cursor));
    cursor = addDays(cursor, 1);
  }

  return dates;
}

async function createBookerPage(browser) {
  if (browser && typeof browser.newContext === "function") {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 1000 },
      locale: "en-US",
      timezoneId: DEFAULT_TIMEZONE
    });

    return {
      context,
      page: await context.newPage()
    };
  }

  if (browser && typeof browser.newPage === "function") {
    return {
      context: null,
      page: await browser.newPage({
        viewport: { width: 1400, height: 1000 }
      })
    };
  }

  throw new Error("Invalid Playwright browser object supplied to Booker scraper.");
}

async function closeBookerPage(page, context) {
  await page?.close?.().catch(() => null);
  await context?.close?.().catch(() => null);
}

async function waitForPageToSettle(page, extraDelayMs = 1200) {
  await page
    .waitForLoadState("domcontentloaded", { timeout: SHORT_TIMEOUT_MS })
    .catch(() => null);
  await page
    .waitForLoadState("networkidle", { timeout: 6000 })
    .catch(() => null);
  await page.waitForTimeout(extraDelayMs);
}

async function navigate(page, url) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: DEFAULT_TIMEOUT_MS
  });

  await waitForPageToSettle(page);
}

async function getBodyText(page) {
  return page.locator("body").innerText().catch(() => "");
}

async function dismissCommonOverlays(page) {
  const labels = [
    /^accept$/i,
    /^accept all$/i,
    /^allow all$/i,
    /^got it$/i,
    /^close$/i
  ];

  for (const label of labels) {
    const locator = page.getByRole("button", { name: label }).first();

    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout: 3000 }).catch(() => null);
      await page.waitForTimeout(400);
      break;
    }
  }
}

async function clickButtonOrLinkByNames(page, names = [], options = {}) {
  const exact = options.exact !== false;

  for (const name of names.map(cleanText).filter(Boolean)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = exact
      ? new RegExp(`^\\s*${escaped}\\s*$`, "i")
      : new RegExp(escaped, "i");

    const locators = [
      page.getByRole("button", { name: pattern }),
      page.getByRole("link", { name: pattern }),
      page.getByText(pattern)
    ];

    for (const locator of locators) {
      const count = Math.min(await locator.count().catch(() => 0), 12);

      for (let index = 0; index < count; index += 1) {
        const item = locator.nth(index);

        if (!(await item.isVisible().catch(() => false))) continue;
        if (await item.isDisabled().catch(() => false)) continue;

        const beforeUrl = page.url();
        const text = cleanText(await item.innerText().catch(() => name));

        const clicked = await item
          .click({ timeout: 5000 })
          .then(() => true)
          .catch(() => false);

        if (!clicked) continue;

        await waitForPageToSettle(page, 800);

        return {
          clicked: true,
          text,
          beforeUrl,
          afterUrl: page.url()
        };
      }
    }
  }

  return { clicked: false };
}

async function clickChoiceCard(page, choiceTexts = [], actionTexts = []) {
  return page
    .evaluate(
      ({ choiceTexts, actionTexts }) => {
        function normalize(value) {
          return String(value || "")
            .replace(/\u00a0/g, " ")
            .toLowerCase()
            .replace(/&/g, " and ")
            .replace(/minutes?/g, "min")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }

        function visible(element) {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            rect.width > 0 &&
            rect.height > 0
          );
        }

        function enabled(element) {
          return (
            !element.disabled &&
            element.getAttribute("aria-disabled") !== "true"
          );
        }

        const choices = choiceTexts.map(normalize).filter(Boolean);
        const actions = actionTexts.map(normalize).filter(Boolean);
        const containers = Array.from(
          document.querySelectorAll(
            "article, li, section, label, [role='option'], [role='radio'], [role='listitem'], [class*='card'], [class*='tile'], [class*='item']"
          )
        ).filter((element) => visible(element));

        const ranked = containers
          .map((container) => {
            const text = normalize(container.innerText || container.textContent);
            const matchingChoice = choices.find(
              (choice) => text === choice || text.includes(choice)
            );

            if (!matchingChoice) return null;

            let score = text === matchingChoice ? 100 : 40;
            score -= Math.min(text.length, 300) / 100;

            const clickableChildren = Array.from(
              container.querySelectorAll("button, a, input, [role='button']")
            ).filter((element) => visible(element) && enabled(element));

            const action =
              clickableChildren.find((element) => {
                const actionText = normalize(
                  element.innerText ||
                    element.value ||
                    element.getAttribute("aria-label") ||
                    ""
                );
                return actions.some(
                  (candidate) =>
                    actionText === candidate || actionText.includes(candidate)
                );
              }) ||
              clickableChildren.find((element) => {
                const href = element.getAttribute("href") || "";
                return href && href !== "#";
              }) ||
              clickableChildren[0] ||
              (container.matches("label, button, a, [role='button']")
                ? container
                : null);

            if (action) score += 25;

            return {
              container,
              action,
              text,
              matchingChoice,
              score
            };
          })
          .filter(Boolean)
          .sort((a, b) => b.score - a.score);

        const target = ranked[0];

        if (!target || !target.action) {
          return { clicked: false };
        }

        const actionText = String(
          target.action.innerText ||
            target.action.value ||
            target.action.getAttribute("aria-label") ||
            ""
        ).trim();

        target.action.click();

        return {
          clicked: true,
          choice: target.matchingChoice,
          containerText: String(target.container.innerText || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500),
          actionText,
          href: target.action.getAttribute("href") || ""
        };
      },
      {
        choiceTexts: choiceTexts.map(cleanText),
        actionTexts: actionTexts.map(cleanText)
      }
    )
    .catch(() => ({ clicked: false }));
}

async function clickBookerCategory(page, business) {
  const categoryChoices = [
    business.parentServiceText,
    business.categoryText,
    business.categoryName
  ]
    .map(cleanText)
    .filter(Boolean);

  if (!categoryChoices.length) {
    return { clicked: false };
  }

  const result = await clickButtonOrLinkByNames(page, categoryChoices, {
    exact: false
  });

  if (result.clicked) {
    await page.waitForTimeout(700);
  }

  return result;
}

async function clickMatchingBookerService(page, business) {
  const serviceName = cleanText(business.serviceName);
  const serviceId = String(
    business.platformServiceId ||
      business.serviceId ||
      business.serviceButtonId ||
      ""
  ).trim();
  const durationMinutes = Number(business.durationMinutes || 0) || null;

  if (!serviceName && !serviceId) {
    return {
      clicked: false,
      reason: "No serviceName or service ID was supplied."
    };
  }

  async function clickByServiceId() {
    if (!serviceId) {
      return {
        clicked: false,
        reason: "No Booker service ID was configured."
      };
    }

    return page
      .evaluate(
        ({ serviceId }) => {
          function visible(element) {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.visibility !== "hidden" &&
              style.display !== "none" &&
              rect.width > 0 &&
              rect.height > 0
            );
          }

          function enabled(element) {
            return (
              !element.disabled &&
              element.getAttribute("aria-disabled") !== "true"
            );
          }

          function clickable(element) {
            return (
              element &&
              visible(element) &&
              enabled(element) &&
              element.matches("a, button, input, [role='button']")
            );
          }

          function normalizeAttribute(value) {
            return String(value || "").trim();
          }

          function hrefHasExactServiceId(element) {
            const href = normalizeAttribute(element?.getAttribute?.("href"));
            if (!href) return false;

            try {
              const parsed = new URL(href, window.location.href);
              const decodedPath = decodeURIComponent(parsed.pathname);
              return new RegExp(`/service/${serviceId}(?:/|$)`, "i").test(
                decodedPath
              );
            } catch {
              return new RegExp(`/service/${serviceId}(?:/|$)`, "i").test(
                decodeURIComponent(href)
              );
            }
          }

          function elementHasExactServiceId(element) {
            if (!element) return false;

            const attributes = [
              "data-service-id",
              "data-serviceid",
              "data-service",
              "data-id",
              "value"
            ];

            if (
              attributes.some(
                (name) => normalizeAttribute(element.getAttribute(name)) === serviceId
              )
            ) {
              return true;
            }

            return hrefHasExactServiceId(element);
          }

          // First preference: a visible clickable element whose URL or data
          // attribute directly identifies the exact configured Booker service.
          const allClickable = Array.from(
            document.querySelectorAll("a, button, input, [role='button']")
          ).filter(clickable);

          const direct = allClickable.find(elementHasExactServiceId);

          if (direct) {
            const href = direct.getAttribute("href") || "";
            direct.click();
            return {
              clicked: true,
              method: "service_id_direct",
              requestedServiceId: serviceId,
              href,
              matchedText: String(
                direct.innerText ||
                  direct.value ||
                  direct.getAttribute("aria-label") ||
                  ""
              )
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 500)
            };
          }

          // Second preference: an exact ID-bearing metadata element inside a
          // small service card. The action must stay inside that same card.
          const idElements = Array.from(document.querySelectorAll("body *")).filter(
            (element) => elementHasExactServiceId(element)
          );

          for (const idElement of idElements) {
            const containers = [];
            let cursor = idElement;

            while (cursor && cursor !== document.body) {
              if (
                cursor.matches(
                  "article, li, [role='listitem'], [data-service-id], [data-serviceid], [class*='service-card'], [class*='serviceCard'], [class*='service-item'], [class*='serviceItem'], [class*='card']"
                )
              ) {
                containers.push(cursor);
              }
              cursor = cursor.parentElement;
            }

            for (const container of containers) {
              if (!visible(container)) continue;

              const actions = Array.from(
                container.querySelectorAll("a, button, input, [role='button']")
              ).filter(clickable);

              const exactIdAction = actions.find(elementHasExactServiceId);
              const action = exactIdAction || actions.find((candidate) => {
                const label = String(
                  candidate.innerText ||
                    candidate.value ||
                    candidate.getAttribute("aria-label") ||
                    ""
                )
                  .replace(/\s+/g, " ")
                  .trim()
                  .toLowerCase();

                return [
                  "book",
                  "book now",
                  "select",
                  "choose",
                  "schedule"
                ].includes(label);
              });

              if (!action) continue;

              const href = action.getAttribute("href") || "";
              action.click();
              return {
                clicked: true,
                method: "service_id_card",
                requestedServiceId: serviceId,
                href,
                matchedText: String(container.innerText || "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 500)
              };
            }
          }

          return {
            clicked: false,
            method: "service_id_not_found",
            requestedServiceId: serviceId,
            reason: `No visible Booker control matched service ID ${serviceId}.`
          };
        },
        { serviceId }
      )
      .catch((error) => ({
        clicked: false,
        method: "service_id_error",
        requestedServiceId: serviceId,
        reason: error.message
      }));
  }

  async function clickByServiceName() {
    if (!serviceName) {
      return {
        clicked: false,
        reason: "No Booker service name was configured."
      };
    }

    return page
      .evaluate(
        ({ serviceName, durationMinutes }) => {
          function normalize(value) {
            return String(value || "")
              .replace(/\u00a0/g, " ")
              .toLowerCase()
              .replace(/&/g, " and ")
              .replace(/minutes?/g, "min")
              .replace(/[^a-z0-9]+/g, " ")
              .replace(/\s+/g, " ")
              .trim();
          }

          function visible(element) {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.visibility !== "hidden" &&
              style.display !== "none" &&
              rect.width > 0 &&
              rect.height > 0
            );
          }

          function enabled(element) {
            return (
              !element.disabled &&
              element.getAttribute("aria-disabled") !== "true"
            );
          }

          function clickable(element) {
            return (
              element &&
              visible(element) &&
              enabled(element) &&
              element.matches("a, button, input, [role='button']")
            );
          }

          const normalizedServiceName = normalize(serviceName);

          // Text matching is intentionally available only when the business
          // has no configured Booker service ID.
          const containers = Array.from(
            document.querySelectorAll(
              "article, li, [role='listitem'], [class*='service-card'], [class*='serviceCard'], [class*='service-item'], [class*='serviceItem']"
            )
          ).filter(visible);

          const ranked = containers
            .map((container) => {
              const rawText = String(container.innerText || "");
              const text = normalize(rawText);

              if (!text) return null;

              const exactName = text === normalizedServiceName;
              const containsName = text.includes(normalizedServiceName);

              if (!exactName && !containsName) return null;

              const durationMatches =
                !durationMinutes ||
                new RegExp(
                  `(^|\\D)${durationMinutes}\\s*(min|minute|minutes)?($|\\D)`,
                  "i"
                ).test(rawText);

              const actions = Array.from(
                container.querySelectorAll("a, button, input, [role='button']")
              ).filter(clickable);

              const action =
                actions.find((candidate) => {
                  const label = normalize(
                    candidate.innerText ||
                      candidate.value ||
                      candidate.getAttribute("aria-label") ||
                      ""
                  );
                  return [
                    "book",
                    "book now",
                    "select",
                    "choose",
                    "schedule"
                  ].includes(label);
                }) ||
                actions.find((candidate) =>
                  /\/service\//i.test(candidate.getAttribute("href") || "")
                );

              if (!action) return null;

              let score = exactName ? 200 : 100;
              if (durationMatches) score += 50;
              score -= Math.min(text.length, 500) / 100;

              return {
                action,
                rawText,
                score
              };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score);

          const target = ranked[0];

          if (!target) {
            return {
              clicked: false,
              method: "service_name_not_found",
              reason: `No visible Booker service card matched ${serviceName}.`
            };
          }

          const href = target.action.getAttribute("href") || "";
          target.action.click();

          return {
            clicked: true,
            method: "service_name_card_no_id_configured",
            href,
            matchedText: target.rawText
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 500)
          };
        },
        { serviceName, durationMinutes }
      )
      .catch((error) => ({
        clicked: false,
        method: "service_name_error",
        reason: error.message
      }));
  }

  async function attemptServiceClick() {
    return serviceId ? clickByServiceId() : clickByServiceName();
  }

  let result = await attemptServiceClick();

  if (!result.clicked) {
    const categoryResult = await clickBookerCategory(page, business);

    if (categoryResult.clicked) {
      await waitForPageToSettle(page, 700);
      result = await attemptServiceClick();
    }
  }

  if (result.clicked) {
    await waitForPageToSettle(page, 1200);
  }

  return result;
}

function getProviderChoices(business = {}) {
  const configured = cleanText(business.providerText);
  const genericProvider = /^(first available|all providers|anyone|any staff|any available staff|no preference)$/i.test(
    configured
  );

  const choices = genericProvider || !configured
    ? [
        "Any available staff",
        "Any Available Staff",
        "Any staff member",
        "Any Staff",
        "First Available",
        "All Providers",
        "No Preference",
        "Anyone"
      ]
    : [
        configured,
        "Any available staff",
        "Any Staff",
        "First Available",
        "All Providers"
      ];

  return [...new Set(choices.map(cleanText).filter(Boolean))];
}

async function clickJustMeStep(page) {
  const directResult = await clickButtonOrLinkByNames(
    page,
    ["Just Me", "Just me", "Book for myself", "Myself", "One person"],
    { exact: false }
  );

  if (directResult.clicked) {
    return directResult;
  }

  return clickChoiceCard(
    page,
    ["Just Me", "Book for myself", "Myself", "One person", "1 person"],
    ["Select", "Choose", "Continue", "Next"]
  );
}

async function clickContinue(page) {
  return clickButtonOrLinkByNames(
    page,
    ["Continue", "Next", "View Availability", "Find a time"],
    { exact: true }
  );
}

async function clickAnyAvailableStaff(page, business) {
  const providerChoices = getProviderChoices(business);

  const directResult = await clickButtonOrLinkByNames(page, providerChoices, {
    exact: false
  });

  if (directResult.clicked) {
    return {
      ...directResult,
      provider: directResult.text || providerChoices[0]
    };
  }

  const cardResult = await clickChoiceCard(page, providerChoices, [
    "Select",
    "Choose",
    "Book",
    "Continue",
    "Next"
  ]);

  return {
    ...cardResult,
    provider: cardResult.choice || providerChoices[0]
  };
}

async function extractBookerTimesFromPage(page) {
  const candidates = await page
    .locator(
      "button, a, [role='button'], [role='option'], [data-testid*='time'], [class*='time']"
    )
    .evaluateAll((elements) =>
      elements.map((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return {
          text: String(
            element.innerText ||
              element.textContent ||
              element.getAttribute("aria-label") ||
              ""
          )
            .replace(/\s+/g, " ")
            .trim(),
          disabled:
            Boolean(element.disabled) ||
            element.getAttribute("aria-disabled") === "true",
          visible:
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            rect.width > 0 &&
            rect.height > 0
        };
      })
    )
    .catch(() => []);

  const timePattern = /\b(1[0-2]|[1-9]):[0-5][0-9]\s*(AM|PM)\b/i;
  const times = [];

  for (const candidate of candidates) {
    if (candidate.disabled || !candidate.visible || !candidate.text) continue;

    const match = candidate.text.match(timePattern);
    if (!match) continue;

    times.push(match[0].toUpperCase().replace(/\s+/g, " "));
  }

  return [...new Set(times)];
}

async function pageLooksLikeAvailability(page) {
  if (isBookerAvailabilityUrl(page.url())) {
    return true;
  }

  const bodyText = normalizeText(await getBodyText(page));

  return (
    bodyText.includes("select a time") ||
    bodyText.includes("available times") ||
    bodyText.includes("no availability") ||
    bodyText.includes("no times available")
  );
}

async function advanceFromServiceToAvailability(page, business, debug) {
  if (await pageLooksLikeAvailability(page)) {
    return {
      success: true,
      selectedProvider: business.providerText || "Any available staff"
    };
  }

  const justMeResult = await clickJustMeStep(page);
  debug.flowSteps.push({ step: "just_me", ...justMeResult, url: page.url() });

  if (justMeResult.clicked) {
    await waitForPageToSettle(page, 700);
  }

  if (!(await pageLooksLikeAvailability(page))) {
    const continueAfterParty = await clickContinue(page);
    debug.flowSteps.push({
      step: "continue_after_party",
      ...continueAfterParty,
      url: page.url()
    });

    if (continueAfterParty.clicked) {
      await waitForPageToSettle(page, 900);
    }
  }

  if (await pageLooksLikeAvailability(page)) {
    return {
      success: true,
      selectedProvider: business.providerText || "Any available staff"
    };
  }

  const providerResult = await clickAnyAvailableStaff(page, business);
  debug.flowSteps.push({
    step: "any_available_staff",
    ...providerResult,
    url: page.url()
  });

  if (providerResult.clicked) {
    await waitForPageToSettle(page, 900);
  }

  if (!(await pageLooksLikeAvailability(page))) {
    const continueAfterProvider = await clickContinue(page);
    debug.flowSteps.push({
      step: "continue_after_provider",
      ...continueAfterProvider,
      url: page.url()
    });

    if (continueAfterProvider.clicked) {
      await waitForPageToSettle(page, 1200);
    }
  }

  return {
    success: await pageLooksLikeAvailability(page),
    selectedProvider:
      providerResult.provider || business.providerText || "Any available staff"
  };
}

async function resolveAvailabilityPage(page, business, date, debug) {
  const startingUrl = buildBookerDateUrl(business.bookingUrl, date);

  await navigate(page, startingUrl);
  await dismissCommonOverlays(page);

  debug.flowSteps.push({
    step: "open_booking_url",
    url: page.url(),
    configuredUrl: business.bookingUrl
  });

  if (await pageLooksLikeAvailability(page)) {
    return {
      success: true,
      availabilityUrl: page.url(),
      selectedProvider: business.providerText || "All providers"
    };
  }

  const serviceResult = await clickMatchingBookerService(page, business);
  debug.flowSteps.push({
    step: "select_service",
    ...serviceResult,
    url: page.url()
  });

  if (!serviceResult.clicked) {
    const fallbackUrl = buildDynamicAvailabilityFallbackUrl(
      business,
      page.url(),
      date
    );

    if (fallbackUrl) {
      debug.flowSteps.push({
        step: "dynamic_service_url_fallback",
        url: fallbackUrl
      });

      await navigate(page, fallbackUrl);

      if (await pageLooksLikeAvailability(page)) {
        return {
          success: true,
          availabilityUrl: page.url(),
          selectedProvider: "All providers"
        };
      }
    }

    return {
      success: false,
      error: `Could not find Booker service "${business.serviceName || "unknown"}".`
    };
  }

  if (!urlContainsRequestedService(page.url(), business)) {
    const correctedServiceUrl = buildDynamicServiceUrl(
      business,
      page.url()
    );

    debug.flowSteps.push({
      step: "correct_wrong_service_selection",
      requestedServiceId:
        business.platformServiceId ||
        business.serviceId ||
        business.serviceButtonId ||
        null,
      wrongUrl: page.url(),
      correctedUrl: correctedServiceUrl || null
    });

    if (!correctedServiceUrl) {
      return {
        success: false,
        error:
          "Booker selected a different service and a deterministic service URL could not be built."
      };
    }

    await navigate(page, correctedServiceUrl);
    await dismissCommonOverlays(page);

    if (!urlContainsRequestedService(page.url(), business)) {
      return {
        success: false,
        error:
          `Booker opened the wrong service. Expected service ID ${
            business.platformServiceId ||
            business.serviceId ||
            business.serviceButtonId ||
            "unknown"
          }, but reached ${page.url()}.`
      };
    }
  }

  const advanced = await advanceFromServiceToAvailability(
    page,
    business,
    debug
  );

  if (advanced.success) {
    return {
      success: true,
      availabilityUrl: page.url(),
      selectedProvider: advanced.selectedProvider
    };
  }

  const fallbackUrl = buildDynamicAvailabilityFallbackUrl(
    business,
    page.url(),
    date
  );

  if (fallbackUrl) {
    debug.flowSteps.push({
      step: "dynamic_availability_fallback",
      url: fallbackUrl
    });

    await navigate(page, fallbackUrl);

    if (await pageLooksLikeAvailability(page)) {
      return {
        success: true,
        availabilityUrl: page.url(),
        selectedProvider: advanced.selectedProvider || "All providers"
      };
    }
  }

  return {
    success: false,
    error:
      "Booker service was selected, but the scraper did not reach an availability page."
  };
}

function buildAppointments(date, times, business, bookingUrl, providerName) {
  return times.map((time) => ({
    businessName: business.businessName,
    platform: "booker",
    bookingUrl,
    service: business.serviceName,
    serviceName: business.serviceName,
    serviceType: business.serviceType || "",
    durationMinutes: business.durationMinutes || null,
    platformServiceId:
      business.platformServiceId ||
      business.serviceId ||
      business.serviceButtonId ||
      null,
    provider: providerName,
    providerName,
    therapistName: providerName,
    date,
    time,
    startTime: `${date} ${time}`
  }));
}

async function scrapeBookerBusiness(browser, business) {
  const startedAt = Date.now();
  const { page, context } = await createBookerPage(browser);
  let rawWidgetText = "";

  const debug = {
    originalBookingUrl: business.bookingUrl || "",
    serviceName: business.serviceName || "",
    platformServiceId:
      business.platformServiceId ||
      business.serviceId ||
      business.serviceButtonId ||
      null,
    flowSteps: [],
    triedDates: []
  };

  try {
    if (!business.bookingUrl) {
      throw new Error("Missing bookingUrl for Booker business.");
    }

    if (!business.serviceName && !business.platformServiceId && !business.serviceId) {
      throw new Error(
        "Booker requires service-level data: serviceName and/or platformServiceId."
      );
    }

    const originalDate = extractDateFromBookerUrl(business.bookingUrl);
    const scrapeWindow = getScrapeWindowDates(business);
    const startDate = scrapeWindow.startDate;
    const endDate = scrapeWindow.endDate;
    const datesToTry = buildDateList(startDate, endDate);
    const daysForward =
      datesToTry.length || Math.max(1, Number(business.daysForward || 7));

    debug.originalDate = originalDate;
    debug.startDate = startDate;
    debug.endDate = endDate;
    debug.scrapeWindowSource = scrapeWindow.source;

    if (!datesToTry.length) {
      throw new Error(
        `Invalid Booker scrape date window: ${startDate} to ${endDate}`
      );
    }

    console.log(`\n[BOOKER] Opening ${business.businessName}`);
    console.log(`[BOOKER] Business booking URL: ${business.bookingUrl}`);
    console.log(`[BOOKER] Service: ${business.serviceName}`);
    console.log(
      `[BOOKER] Service ID: ${
        business.platformServiceId || business.serviceId || "not supplied"
      }`
    );
    console.log(`[BOOKER] Search start date: ${startDate}`);
    console.log(`[BOOKER] Search end date: ${endDate}`);

    const resolved = await resolveAvailabilityPage(
      page,
      business,
      startDate,
      debug
    );

    if (!resolved.success) {
      throw new Error(resolved.error || "Could not resolve Booker availability page.");
    }

    let availabilityTemplateUrl = resolved.availabilityUrl || page.url();
    let selectedProvider =
      resolved.selectedProvider || business.providerText || "Any available staff";
    let finalDate = startDate;
    let finalUrl = availabilityTemplateUrl;
    let finalTimes = [];

    for (const date of datesToTry) {
      debug.triedDates.push(date);
      finalDate = date;

      const dateUrl = buildBookerDateUrl(availabilityTemplateUrl, date);

      if (dateUrl && page.url() !== dateUrl) {
        console.log(`[BOOKER] Checking ${date}`);
        console.log(`[BOOKER] URL: ${dateUrl}`);

        await navigate(page, dateUrl);
      }

      if (!(await pageLooksLikeAvailability(page))) {
        const recovered = await resolveAvailabilityPage(
          page,
          business,
          date,
          debug
        );

        if (!recovered.success) {
          console.log(
            `[BOOKER] Could not recover availability flow for ${date}: ${
              recovered.error || "unknown error"
            }`
          );
          continue;
        }

        availabilityTemplateUrl = recovered.availabilityUrl || page.url();
        selectedProvider = recovered.selectedProvider || selectedProvider;
      }

      finalUrl = page.url();
      rawWidgetText = await getBodyText(page);
      const times = await extractBookerTimesFromPage(page);

      if (times.length > 0) {
        finalTimes = times;
        console.log(`[BOOKER] Times found on ${date}: ${times.length}`);
        break;
      }

      const suggestedMatch = cleanText(rawWidgetText).match(
        /Suggested dates?:\s*([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2})/i
      );

      if (suggestedMatch) {
        console.log(`[BOOKER] Widget suggested: ${suggestedMatch[1]}`);
      }
    }

    const appointments = buildAppointments(
      finalDate,
      finalTimes,
      business,
      finalUrl,
      selectedProvider
    );

    console.log(`[BOOKER] Times found: ${finalTimes.length}`);

    return {
      businessName: business.businessName,
      bookingUrl: finalUrl || business.bookingUrl,
      platform: "booker",
      service: business.serviceName,
      serviceName: business.serviceName,
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      platformServiceId:
        business.platformServiceId ||
        business.serviceId ||
        business.serviceButtonId ||
        null,
      provider: selectedProvider,
      date: finalDate,
      times: finalTimes,
      appointments,
      status: finalTimes.length > 0 ? "success" : "no_times_found",
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      rawWidgetText: cleanText(rawWidgetText).slice(0, 5000),

      scrapeStartDate: business.scrapeStartDate || startDate,
      scrapeEndDate: business.scrapeEndDate || endDate,
      lookaheadHours: business.lookaheadHours || daysForward * 24,
      daysForward,
      scrapeWindowMode: business.scrapeWindowMode || scrapeWindow.source,

      debug: {
        ...debug,
        resolvedAvailabilityUrl: availabilityTemplateUrl,
        selectedProvider,
        finalDate,
        finalUrl
      }
    };
  } catch (error) {
    console.error(
      `[BOOKER ERROR] ${business.businessName || "Unknown business"}: ${
        error.message
      }`
    );

    rawWidgetText = rawWidgetText || (await getBodyText(page));

    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "booker",
      service: business.serviceName,
      serviceName: business.serviceName,
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      platformServiceId:
        business.platformServiceId ||
        business.serviceId ||
        business.serviceButtonId ||
        null,
      provider: business.providerText || "Any available staff",
      date: null,
      times: [],
      appointments: [],
      status: "error",
      error: error.message,
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      rawWidgetText: rawWidgetText
        ? cleanText(rawWidgetText).slice(0, 5000)
        : null,

      scrapeStartDate: business.scrapeStartDate || "",
      scrapeEndDate: business.scrapeEndDate || "",
      lookaheadHours: business.lookaheadHours || null,
      daysForward: business.daysForward || null,
      scrapeWindowMode: business.scrapeWindowMode || "",
      debug
    };
  } finally {
    await closeBookerPage(page, context);
  }
}

module.exports = {
  scrapeBookerBusiness
};