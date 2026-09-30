function extractAppointmentTimes(text) {
  // NEXTAPPT MINDBODY MULTI-DAY FIX V7
  const source = String(text || "");
  const regex = /\b(1[0-2]|0?[1-9])(?::([0-5][0-9]))?\s*(AM|PM)\b/gi;
  const times = [];
  let match;

  while ((match = regex.exec(source)) !== null) {
    const hour = String(Number(match[1]));
    const minute = match[2] || "00";
    const ampm = String(match[3]).toUpperCase();
    times.push(`${hour}:${minute} ${ampm}`);
  }

  return [...new Set(times)];
}

function extractAvailabilityDate(text) {
  // NEXTAPPT MINDBODY MULTI-DAY FIX V7
  const source = String(text || "");

  const patterns = [
    /Availability for ([A-Za-z]+ \d{1,2}, \d{4})/i,
    /Available on ([A-Za-z]+ \d{1,2}, \d{4})/i,
    /Appointments for ([A-Za-z]+ \d{1,2}, \d{4})/i,
    /Go to ([A-Za-z]+ \d{1,2}, \d{4})/i,
    /fully booked for today,\s*([A-Za-z]+ \d{1,2}, \d{4})/i,
    /Next available appointment[\s\S]*?([A-Za-z]+ \d{1,2}, \d{4})/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return match[1];
  }

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
      ".needsclick",
      ".yui-popup-container-node",
      ".sqs-popup-overlay",
      ".sqs-popup-container",
      ".sqs-slide-layer",
      "[data-testid='popup-overlay']",
      "[data-testid='popup-container']"
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
  // NEXTAPPT MINDBODY INTERACTIVE-TEXT-CLICK FIX V5
  const { exact = true, timeout = 5000, required = true } = options;

  if (!text) {
    if (required) {
      throw new Error("Missing text to click.");
    }
    return false;
  }

  const result = await frame.evaluate(
    ({ targetText, exactMatch }) => {
      const normalize = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim();

      const wanted = normalize(targetText);

      const isVisible = (element) => {
        if (!element) return false;

        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          box.width > 0 &&
          box.height > 0
        );
      };

      const isDisabled = (element) => {
        if (!element) return true;

        if ("disabled" in element && element.disabled) {
          return true;
        }

        if (element.getAttribute("aria-disabled") === "true") {
          return true;
        }

        return false;
      };

      const textMatches = (candidateText) => {
        const normalized = normalize(candidateText);

        if (!normalized) return false;

        return exactMatch
          ? normalized === wanted
          : normalized.includes(wanted);
      };

      const interactiveSelector = [
        "button",
        "a",
        "label",
        "[role='button']",
        "[role='radio']",
        "[role='option']",
        "input[type='radio']",
        "input[type='checkbox']"
      ].join(", ");

      const clickInteractive = (element) => {
        if (!element) return null;
        if (!isVisible(element)) return null;
        if (isDisabled(element)) return null;

        element.scrollIntoView({
          block: "center",
          inline: "center"
        });

        if (typeof element.click === "function") {
          element.click();
        } else {
          element.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              view: window
            })
          );
        }

        return {
          clicked: true,
          tagName: element.tagName,
          role: element.getAttribute("role") || "",
          text:
            normalize(element.textContent) ||
            normalize(element.getAttribute("aria-label")) ||
            normalize(element.value) ||
            ""
        };
      };

      // 1. Prefer real interactive controls whose own visible/accessibility text
      // matches the requested text.
      const interactiveElements = Array.from(
        document.querySelectorAll(interactiveSelector)
      );

      for (const element of interactiveElements) {
        if (!isVisible(element) || isDisabled(element)) continue;

        const candidateTexts = [
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.value
        ];

        if (!candidateTexts.some(textMatches)) continue;

        const clicked = clickInteractive(element);
        if (clicked) return clicked;
      }

      // 2. Find visible text descendants, but only succeed if they belong to
      // a real interactive ancestor. Never click a raw div/span/p as success.
      const textElements = Array.from(
        document.querySelectorAll(
          "span, div, p, strong, em, small, h1, h2, h3, h4, h5, h6"
        )
      );

      for (const element of textElements) {
        if (!isVisible(element)) continue;
        if (!textMatches(element.textContent)) continue;

        const interactive = element.closest(interactiveSelector);

        if (!interactive) continue;

        const clicked = clickInteractive(interactive);
        if (clicked) return clicked;
      }

      // 3. Support a label whose exact text is in a nested descendant and
      // whose associated input itself has no textContent.
      const labels = Array.from(document.querySelectorAll("label"));

      for (const label of labels) {
        if (!isVisible(label) || isDisabled(label)) continue;
        if (!textMatches(label.textContent)) continue;

        const clicked = clickInteractive(label);
        if (clicked) return clicked;
      }

      return {
        clicked: false,
        tagName: "",
        role: "",
        text: ""
      };
    },
    {
      targetText: text,
      exactMatch: exact
    }
  );

  if (result && result.clicked) {
    console.log(
      `[MINDBODY] Native interactive click: "${text}" -> ` +
        `${result.tagName || "control"}` +
        `${result.role ? ` role=${result.role}` : ""}`
    );
    return true;
  }

  console.log(
    `[MINDBODY] No enabled interactive control found for "${text}".`
  );

  if (required) {
    throw new Error(
      `Could not click enabled interactive control for text: ${text}`
    );
  }

  return false;
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

async function expandCategoryIfNeeded(frame, page, business = {}) {
  // NEXTAPPT MINDBODY CATEGORY-TOGGLE FIX V3
  const categoryText =
    business.categoryText ||
    business.categoryName ||
    "";

  const serviceId =
    business.serviceButtonId ||
    business.platformServiceId ||
    business.serviceId ||
    "";

  if (!serviceId) {
    throw new Error(
      `Missing serviceButtonId/platformServiceId for ${business.serviceName}`
    );
  }

  const serviceSelector =
    `button[data-service-id="${serviceId}"]`;

  const visibleService = frame
    .locator(`${serviceSelector}:visible`)
    .first();

  if (await visibleService.isVisible().catch(() => false)) {
    console.log(
      `[MINDBODY] Service already visible: ${business.serviceName} (${serviceId})`
    );
    return true;
  }

  if (!categoryText) {
    throw new Error(
      `Service ${business.serviceName} (${serviceId}) is hidden and no categoryText/categoryName is configured.`
    );
  }

  console.log(
    `[MINDBODY] Opening category "${categoryText}" for service ${serviceId}...`
  );

  const toggleResult = await frame.evaluate(
    ({ categoryText }) => {
      const normalize = (value) =>
        String(value || "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();

      const visible = (element) => {
        if (!element) return false;

        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          box.width > 0 &&
          box.height > 0
        );
      };

      const wanted = normalize(categoryText);

      const categoryCandidates = Array.from(
        document.querySelectorAll(
          "h1, h2, h3, h4, h5, h6, p, span, div"
        )
      ).filter((element) => {
        return visible(element) && normalize(element.textContent) === wanted;
      });

      const openWords = new Set(["show", "expand", "open"]);
      const closedWords = new Set(["hide", "collapse", "close"]);

      for (const categoryElement of categoryCandidates) {
        let container = categoryElement.parentElement;
        let depth = 0;

        while (container && depth < 10) {
          const controls = Array.from(
            container.querySelectorAll(
              "button, a, [role='button']"
            )
          ).filter(visible);

          for (const control of controls) {
            const text = normalize(control.textContent);
            const ariaLabel = normalize(control.getAttribute("aria-label"));
            const title = normalize(control.getAttribute("title"));
            const ariaExpanded = control.getAttribute("aria-expanded");

            const labels = [text, ariaLabel, title].filter(Boolean);

            const alreadyOpen =
              ariaExpanded === "true" ||
              labels.some((label) => closedWords.has(label)) ||
              labels.some(
                (label) =>
                  label.includes(wanted) &&
                  (label.includes("hide") ||
                    label.includes("collapse") ||
                    label.includes("close"))
              );

            if (alreadyOpen) {
              return {
                success: true,
                alreadyOpen: true,
                clicked: false,
                controlText: text || ariaLabel || title || ""
              };
            }

            const isOpenControl =
              ariaExpanded === "false" ||
              labels.some((label) => openWords.has(label)) ||
              labels.some(
                (label) =>
                  label.includes(wanted) &&
                  (label.includes("show") ||
                    label.includes("expand") ||
                    label.includes("open"))
              );

            if (!isOpenControl) {
              continue;
            }

            control.scrollIntoView({
              block: "center",
              inline: "center"
            });

            if (typeof control.click === "function") {
              control.click();
            } else {
              control.dispatchEvent(
                new MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                  view: window
                })
              );
            }

            return {
              success: true,
              alreadyOpen: false,
              clicked: true,
              controlText: text || ariaLabel || title || ""
            };
          }

          container = container.parentElement;
          depth += 1;
        }
      }

      return {
        success: false,
        alreadyOpen: false,
        clicked: false,
        controlText: ""
      };
    },
    { categoryText }
  );

  if (toggleResult.success) {
    console.log(
      toggleResult.alreadyOpen
        ? `[MINDBODY] Category already open: ${categoryText}`
        : `[MINDBODY] Clicked category toggle "${toggleResult.controlText || "toggle"}" for ${categoryText}`
    );

    await wait(page, 1200);

    if (await visibleService.isVisible().catch(() => false)) {
      console.log(
        `[MINDBODY] Service became visible after opening category: ${business.serviceName}`
      );
      return true;
    }
  }

  // One simple fallback: click the category heading itself.
  console.log(
    `[MINDBODY] Category toggle did not expose service. Trying category text click once...`
  );

  const clickedCategoryText = await clickTextWithFallback(
    frame,
    categoryText,
    {
      required: false,
      exact: true,
      timeout: 3500
    }
  ).catch(() => false);

  if (clickedCategoryText) {
    await wait(page, 1000);
  }

  if (await visibleService.isVisible().catch(() => false)) {
    console.log(
      `[MINDBODY] Service became visible after category text click: ${business.serviceName}`
    );
    return true;
  }

  throw new Error(
    `Could not expose visible Mindbody service "${business.serviceName}" (${serviceId}) inside category "${categoryText}".`
  );
}

async function clickServiceButton(frame, page, business) {
  // NEXTAPPT MINDBODY DOM-SERVICE-CLICK FIX V4
  const serviceId =
    business.serviceButtonId ||
    business.platformServiceId ||
    business.serviceId ||
    "";

  if (!serviceId) {
    throw new Error(
      `Missing serviceButtonId/platformServiceId for ${business.serviceName}`
    );
  }

  console.log(`Clicking service: ${business.serviceName}`);
  console.log(`Service ID: ${serviceId}`);

  const button = frame
    .locator(`button[data-service-id="${serviceId}"]:visible`)
    .first();

  const buttonIsVisible = await button
    .isVisible()
    .catch(() => false);

  if (!buttonIsVisible) {
    throw new Error(
      `Mindbody service ${business.serviceName} (${serviceId}) is not visible after category expansion.`
    );
  }

  // Let category expansion/layout settle, but do not use a pointer click.
  await wait(page, 500);

  console.log(
    `[MINDBODY] Selecting visible service ${serviceId} with native DOM click.`
  );

  await button.evaluate((element) => {
    element.scrollIntoView({
      block: "center",
      inline: "center"
    });

    // Native HTMLElement.click() bypasses hit-testing/overlay interception
    // while still invoking the button's registered click handler.
    element.click();
  });

  // Mindbody can take a moment to render the next step.
  await wait(page, 3500);

  let text = await getBodyText(frame);
  let lower = text.toLowerCase();

  const hasProgressed = () =>
    lower.includes("first available") ||
    lower.includes("select employee") ||
    lower.includes("select staff") ||
    lower.includes("select provider") ||
    lower.includes("choose employee") ||
    lower.includes("choose provider") ||
    lower.includes("continue") ||
    lower.includes("add-on") ||
    lower.includes("addon") ||
    lower.includes("select date & time") ||
    lower.includes("availability for") ||
    lower.includes("next available appointment") ||
    lower.includes("no appointments available") ||
    lower.includes("fully booked");

  if (!hasProgressed()) {
    // Give a slow widget one final short opportunity to update.
    await wait(page, 2000);
    text = await getBodyText(frame);
    lower = text.toLowerCase();
  }

  if (!hasProgressed()) {
    console.log("----- MINDBODY TEXT AFTER SERVICE CLICK FAILURE -----");
    console.log(text);

    throw new Error(
      `Native DOM click on visible service ${business.serviceName} (${serviceId}) did not advance the Mindbody widget.`
    );
  }

  console.log(
    `[MINDBODY] Successfully selected service with native DOM click: ${business.serviceName}`
  );

  return true;
}

async function handleAddOnsIfPresent(frame, page) {
  // NEXTAPPT MINDBODY ADD-ON FLOW FIX V7
  const looksLikeAddOnScreen = (lower) =>
    lower.includes("add-on") ||
    lower.includes("add on") ||
    lower.includes("addon") ||
    lower.includes("add ons") ||
    lower.includes("enhancement") ||
    lower.includes("enhance your") ||
    lower.includes("upgrade") ||
    lower.includes("extras") ||
    lower.includes("additional service") ||
    lower.includes("additional services") ||
    lower.includes("optional service") ||
    lower.includes("optional services") ||
    lower.includes("select enhancement") ||
    lower.includes("select enhancements") ||
    lower.includes("choose enhancement") ||
    lower.includes("choose enhancements") ||
    lower.includes("would you like to add") ||
    lower.includes("customize your") ||
    lower.includes("personalize your");

  const beforeText = await getBodyText(frame);
  const beforeLower = beforeText.toLowerCase();

  if (!looksLikeAddOnScreen(beforeLower)) {
    return false;
  }

  console.log("[MINDBODY] Optional add-on/enhancement step detected.");

  const skipTexts = [
    "No Thanks",
    "No thanks",
    "No, Thanks",
    "No, thanks",
    "None",
    "None Selected",
    "No Add-ons",
    "No add-ons",
    "No Add Ons",
    "No add ons",
    "No Addons",
    "No addons",
    "No Enhancements",
    "No enhancements",
    "No Extras",
    "No extras",
    "Skip Add-ons",
    "Skip Add-Ons",
    "Skip Add Ons",
    "Skip add-ons",
    "Skip for now",
    "Skip For Now",
    "Not Now",
    "Not now",
    "Maybe Later",
    "Maybe later",
    "Continue without add-ons",
    "Continue Without Add-ons",
    "Continue without Add-ons",
    "Continue without add ons",
    "Continue without enhancements",
    "Continue Without Enhancements",
    "Continue without extras",
    "Continue Without Extras",
    "Skip"
  ];

  const selectedSkip = await clickFirstMatchingText(
    frame,
    page,
    skipTexts,
    { waitAfter: 1200 }
  );

  if (selectedSkip) {
    console.log(
      `[MINDBODY] Selected add-on bypass option: ${selectedSkip}`
    );
  }

  let currentText = await getBodyText(frame);
  let currentLower = currentText.toLowerCase();

  // Selecting None / No Thanks can simply set a radio or checkbox.
  // If the add-on page remains, click Continue/Next afterward.
  if (looksLikeAddOnScreen(currentLower)) {
    const continued = await clickFirstMatchingText(
      frame,
      page,
      [
        "Continue",
        "Next",
        "Continue to availability",
        "Continue To Availability",
        "View Availability",
        "Select Date & Time",
        "Select Date and Time"
      ],
      { waitAfter: 2500 }
    );

    if (!continued) {
      console.log("----- MINDBODY UNHANDLED ADD-ON SCREEN -----");
      console.log(currentText);

      throw new Error(
        "Mindbody add_on_bypass_failed: add-on screen remained after selection and no Continue/Next control was found."
      );
    }

    console.log(
      `[MINDBODY] Continued after add-on selection using: ${continued}`
    );
  }

  const afterText = await getBodyText(frame);
  const afterLower = afterText.toLowerCase();

  // A business can have multiple consecutive optional add-on groups.
  if (looksLikeAddOnScreen(afterLower)) {
    if (afterText.trim() === beforeText.trim()) {
      console.log("----- MINDBODY ADD-ON SCREEN DID NOT ADVANCE -----");
      console.log(afterText);

      throw new Error(
        "Mindbody add_on_bypass_failed: add-on controls were activated but the screen did not advance."
      );
    }

    console.log(
      "[MINDBODY] Advanced to another optional add-on/enhancement screen."
    );

    return true;
  }

  console.log("[MINDBODY] Optional add-on/enhancement step bypassed.");
  return true;
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
  // NEXTAPPT MINDBODY ADD-ON BYPASS FIX V6
  for (let i = 0; i < 10; i++) {
    const text = await getBodyText(frame);
    const lower = text.toLowerCase();

    if (
      lower.includes("continue") ||
      lower.includes("select employee") ||
      lower.includes("select staff") ||
      lower.includes("select provider") ||
      lower.includes("first available") ||
      lower.includes("add-on") ||
      lower.includes("add on") ||
      lower.includes("addon") ||
      lower.includes("add ons") ||
      lower.includes("enhancement") ||
      lower.includes("enhance your") ||
      lower.includes("upgrade") ||
      lower.includes("extras") ||
      lower.includes("additional service") ||
      lower.includes("optional service") ||
      lower.includes("no thanks") ||
      lower.includes("select date & time") ||
      lower.includes("select date and time") ||
      lower.includes("choose date & time") ||
      lower.includes("choose date and time") ||
      lower.includes("availability for") ||
      lower.includes("available times") ||
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
  // NEXTAPPT MINDBODY MULTI-DAY FIX V7
  await waitForProgressAfterService(frame, page);

  const isAvailabilityStage = (lower) =>
    lower.includes("availability for") ||
    lower.includes("available on") ||
    lower.includes("appointments for") ||
    lower.includes("select date & time") ||
    lower.includes("select date and time") ||
    lower.includes("choose date & time") ||
    lower.includes("choose date and time") ||
    lower.includes("available times") ||
    lower.includes("next available appointment") ||
    lower.includes("no appointments available") ||
    lower.includes("fully booked") ||
    lower.includes("calendar");

  for (let step = 0; step < 12; step++) {
    const text = await getBodyText(frame);
    const lower = text.toLowerCase();

    if (isAvailabilityStage(lower)) {
      return text;
    }

    if (await handleAddOnsIfPresent(frame, page)) {
      continue;
    }

    if (await handleProviderIfPresent(frame, page, business)) {
      await clickContinueIfPresent(frame, page);
      continue;
    }

    if (await clickContinueIfPresent(frame, page)) {
      continue;
    }

    await wait(page, 1200);
  }

  const finalText = await getBodyText(frame);
  const finalLower = finalText.toLowerCase();

  if (isAvailabilityStage(finalLower)) {
    return finalText;
  }

  console.log("----- MINDBODY FLOW STALLED BEFORE AVAILABILITY -----");
  console.log(finalText);

  throw new Error(
    "Mindbody flow_stalled: service was selected but the widget never reached availability."
  );
}

function normalizeMindbodyDateToKey(value) {
  if (!value) return "";

  const raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return formatDateKey(parsed);
}

function addMindbodyDays(dateKey, amount) {
  const date = parseDateKey(dateKey);
  if (!date) return "";

  date.setDate(date.getDate() + Number(amount || 0));
  return formatDateKey(date);
}

function buildMindbodyDateWindow(business = {}) {
  const start =
    business.scrapeStartDate ||
    formatDateKey(new Date());

  const end =
    business.scrapeEndDate ||
    start;

  if (!isDateKey(start) || !isDateKey(end)) {
    return isDateKey(start) ? [start] : [];
  }

  const dates = [];
  let cursor = start;

  for (let guard = 0; guard < 31; guard++) {
    dates.push(cursor);

    if (cursor >= end) {
      break;
    }

    cursor = addMindbodyDays(cursor, 1);

    if (!cursor) {
      break;
    }
  }

  return dates;
}

function getMindbodyDateLabels(dateKey) {
  const date = parseDateKey(dateKey);

  if (!date) {
    return {
      dateKey,
      long: dateKey,
      full: dateKey,
      monthDay: dateKey,
      slash: dateKey,
      shortSlash: dateKey,
      day: ""
    };
  }

  const long = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);

  const full = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);

  const monthDay = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric"
  }).format(date);

  return {
    dateKey,
    long,
    full,
    monthDay,
    slash:
      `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`,
    shortSlash:
      `${date.getMonth() + 1}/${date.getDate()}`,
    day: String(date.getDate())
  };
}

async function navigateMindbodyToDate(frame, page, dateKey) {
  const labels = getMindbodyDateLabels(dateKey);

  const result = await frame.evaluate(({ labels }) => {
    const normalize = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[,\u00a0]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const isVisible = (element) => {
      if (!element) return false;

      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        box.width > 0 &&
        box.height > 0
      );
    };

    const isDisabled = (element) => {
      if (!element) return true;
      if ("disabled" in element && element.disabled) return true;
      if (element.getAttribute("aria-disabled") === "true") return true;
      return false;
    };

    const wanted = [
      labels.dateKey,
      labels.long,
      labels.full,
      labels.monthDay,
      labels.slash,
      labels.shortSlash
    ]
      .map(normalize)
      .filter(Boolean);

    const selectors = [
      "button",
      "a",
      "[role='button']",
      "[role='gridcell']",
      "[role='option']",
      "td",
      "label",
      "time"
    ].join(", ");

    const candidates = Array.from(
      document.querySelectorAll(selectors)
    );

    const describe = (element) => {
      return [
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-date"),
        element.getAttribute("data-value"),
        element.getAttribute("data-day"),
        element.getAttribute("datetime"),
        element.getAttribute("value")
      ]
        .map(normalize)
        .filter(Boolean);
    };

    const activate = (element, strategy) => {
      if (!element || !isVisible(element) || isDisabled(element)) {
        return null;
      }

      const actual =
        element.matches(
          "button, a, label, [role='button'], [role='option']"
        )
          ? element
          : element.querySelector(
              "button, a, label, [role='button'], [role='option']"
            ) || element;

      if (!isVisible(actual) || isDisabled(actual)) {
        return null;
      }

      actual.scrollIntoView({
        block: "center",
        inline: "center"
      });

      if (typeof actual.click === "function") {
        actual.click();
      } else {
        actual.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window
          })
        );
      }

      return {
        clicked: true,
        strategy,
        tagName: actual.tagName,
        text: normalize(actual.textContent),
        ariaLabel: normalize(actual.getAttribute("aria-label")),
        title: normalize(actual.getAttribute("title"))
      };
    };

    // Prefer controls with full date semantics.
    for (const element of candidates) {
      if (!isVisible(element) || isDisabled(element)) continue;

      const values = describe(element);

      if (
        values.some((value) =>
          wanted.some(
            (target) =>
              value === target ||
              value.includes(target)
          )
        )
      ) {
        const activated = activate(
          element,
          "date_specific_control"
        );

        if (activated) return activated;
      }
    }

    // Fallback: a day number, but only inside an obvious calendar/date root.
    const calendarSelectors = [
      "[role='grid']",
      "[role='dialog']",
      "[class*='calendar']",
      "[class*='datepicker']",
      "[class*='date-picker']",
      "[class*='datePicker']",
      "[data-testid*='calendar']",
      "[data-testid*='date']"
    ].join(", ");

    const calendarRoots = Array.from(
      document.querySelectorAll(calendarSelectors)
    ).filter(isVisible);

    for (const root of calendarRoots) {
      const dayCandidates = Array.from(
        root.querySelectorAll(
          "button, a, [role='button'], [role='gridcell'], td"
        )
      );

      for (const element of dayCandidates) {
        if (!isVisible(element) || isDisabled(element)) continue;

        const text = normalize(element.textContent);

        if (text !== normalize(labels.day)) continue;

        const activated = activate(
          element,
          "calendar_day_number"
        );

        if (activated) return activated;
      }
    }

    return {
      clicked: false,
      strategy: "not_found"
    };
  }, { labels });

  if (result && result.clicked) {
    console.log(
      `[MINDBODY] Activated ${dateKey} via ${result.strategy}.`
    );

    return result;
  }

  const goToText = `Go to ${labels.long}`;

  const clickedGoTo = await clickTextWithFallback(
    frame,
    goToText,
    {
      required: false,
      exact: true,
      timeout: 4000
    }
  ).catch(() => false);

  if (clickedGoTo) {
    await wait(page, 1500);

    return {
      clicked: true,
      strategy: "go_to_date_text"
    };
  }

  return {
    clicked: false,
    strategy: "not_found"
  };
}

async function scrapeMindbodyBusiness(page, business, attemptNumber) {
  // NEXTAPPT MINDBODY MULTI-DAY FIX V7
  const startedAt = Date.now();
  const scrapeWindow = getScrapeWindowPayload(business);
  const networkDiagnostics = [];

  const onResponse = async (response) => {
    try {
      if (networkDiagnostics.length >= 30) return;

      const url = response.url();
      const lowerUrl = url.toLowerCase();

      if (
        !lowerUrl.includes("mindbody") &&
        !lowerUrl.includes("healcode")
      ) {
        return;
      }

      if (
        !lowerUrl.includes("avail") &&
        !lowerUrl.includes("appointment") &&
        !lowerUrl.includes("schedule") &&
        !lowerUrl.includes("book") &&
        !lowerUrl.includes("service")
      ) {
        return;
      }

      const headers = await response.allHeaders().catch(() => ({}));
      const contentType = String(headers["content-type"] || "");

      const entry = {
        url,
        status: response.status(),
        method: response.request().method(),
        resourceType: response.request().resourceType(),
        contentType
      };

      if (
        contentType.includes("application/json") ||
        contentType.includes("text/json")
      ) {
        const body = await response.text().catch(() => "");

        if (body) {
          entry.bodyPreview = body.slice(0, 1800);
        }
      }

      networkDiagnostics.push(entry);
    } catch {
      // Diagnostics must never break scraping.
    }
  };

  page.on("response", onResponse);

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

  const frame = page.frames().find((candidate) =>
    candidate.url().includes(
      "go.mindbodyonline.com/book/widgets/appointments"
    )
  );

  if (!frame) {
    throw new Error("Mindbody iframe not found.");
  }

  console.log(
    `Opening category: ${business.categoryText || business.categoryName || ""}`
  );

  await expandCategoryIfNeeded(frame, page, business);
  await clickServiceButton(frame, page, business);

  let text = await runModernMindbodyFlow(
    frame,
    page,
    business
  );

  text = await clickNextAvailableIfNeeded(
    frame,
    page,
    business
  );

  const targetDates = buildMindbodyDateWindow(business);
  const appointments = [];
  const daySnapshots = [];

  const initialDate =
    normalizeMindbodyDateToKey(
      extractAvailabilityDate(text)
    ) ||
    scrapeWindow.scrapeStartDate ||
    "";

  if (
    initialDate &&
    dateIsInsideScrapeWindow(initialDate, business)
  ) {
    const initialTimes = extractAppointmentTimes(text);

    for (const time of initialTimes) {
      appointments.push({
        date: initialDate,
        localDateKey: initialDate,
        time,
        source: "mindbody_widget"
      });
    }

    daySnapshots.push({
      date: initialDate,
      times: initialTimes,
      source: "initial_widget_state"
    });
  }

  for (const dateKey of targetDates) {
    if (
      daySnapshots.some(
        (snapshot) => snapshot.date === dateKey
      )
    ) {
      continue;
    }

    console.log(
      `[MINDBODY] Checking calendar date: ${dateKey}`
    );

    const navigation = await navigateMindbodyToDate(
      frame,
      page,
      dateKey
    );

    if (!navigation.clicked) {
      console.log(
        `[MINDBODY] Could not directly activate calendar date ${dateKey}.`
      );

      daySnapshots.push({
        date: dateKey,
        times: [],
        source: "date_control_not_found"
      });

      continue;
    }

    await wait(page, 2200);

    const dayText = await getBodyText(frame);
    const dayTimes = extractAppointmentTimes(dayText);

    for (const time of dayTimes) {
      appointments.push({
        date: dateKey,
        localDateKey: dateKey,
        time,
        source: "mindbody_calendar",
        dateControl: navigation
      });
    }

    daySnapshots.push({
      date: dateKey,
      times: dayTimes,
      source: navigation.strategy || "calendar_click"
    });

    console.log(
      `[MINDBODY] ${dateKey}: ${dayTimes.length} appointment time(s)`
    );
  }

  const dedupedAppointments = [];
  const seen = new Set();

  for (const appointment of appointments) {
    const key = `${appointment.date}|${appointment.time}`;

    if (seen.has(key)) continue;

    seen.add(key);
    dedupedAppointments.push(appointment);
  }

  const allTimes = [
    ...new Set(
      dedupedAppointments.map((item) => item.time)
    )
  ];

  const finalText = await getBodyText(frame);

  const firstDate =
    dedupedAppointments[0]?.date ||
    normalizeMindbodyDateToKey(
      extractAvailabilityDate(finalText)
    ) ||
    null;

  let status;

  if (dedupedAppointments.length > 0) {
    status = "success";
  } else {
    status = determineStatus(finalText, allTimes);

    if (
      status === "unknown" ||
      status === "service_selection_failed"
    ) {
      status = "no_times_found";
    }
  }

  console.log("----- FINAL WIDGET TEXT -----");
  console.log(finalText);

  console.log("----- MINDBODY DATE SNAPSHOTS -----");
  console.log(JSON.stringify(daySnapshots, null, 2));

  if (networkDiagnostics.length) {
    console.log(
      `[MINDBODY] Captured ${networkDiagnostics.length} relevant network diagnostic response(s).`
    );
  }

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

    appointments: dedupedAppointments,

    // Legacy compatibility/debug fields.
    date: firstDate,
    times: allTimes,

    status,
    attemptNumber,
    scrapeDurationMs: Date.now() - startedAt,
    lastChecked: new Date().toISOString(),
    rawWidgetText: finalText,
    mindbodyDaySnapshots: daySnapshots,
    mindbodyNetworkDiagnostics: networkDiagnostics,
    ...scrapeWindow
  };

  return maybeApplyScrapeWindowToResult(
    result,
    business
  );
}

module.exports = {
  scrapeMindbodyBusiness
};