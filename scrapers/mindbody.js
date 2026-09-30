"use strict";
const compat = require("./mindbodyCompat");

async function wait(page, ms = 1500) {
  await page.waitForTimeout(ms);
}

async function getBodyText(frame) {
  return await frame.locator("body").innerText().catch(() => "");
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

      const wanted = normalize(targetText).toLowerCase();

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

        if (element.getAttribute("aria-disabled") === "true" || element.closest("[inert]")) {
          return true;
        }

        return false;
      };

      const textMatches = (candidateText) => {
        const normalized = normalize(candidateText).toLowerCase();

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
    lower.includes("select provider") || lower.includes("select your provider") ||
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
    business.providerText && business.providerText.toLowerCase() !== "first available"
      ? [providerText]
      : [providerText, "First Available", "Any Staff", "Any Therapist", "No preference"],
    { waitAfter: 700 }
  );

  if (!clicked) {
    throw new Error(`Mindbody configured provider unavailable: ${providerText}`);
  }

  return true;
}

async function clickContinueIfPresent(frame, page) {
  const clicked = await clickFirstMatchingText(
    frame,
    page,
    ["Continue", "Next", "Select Date & Time", "View Availability"],
    { waitAfter: 1000 }
  );

  return Boolean(clicked);
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
      lower.includes("select provider") || lower.includes("select your provider") ||
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

    if (await frame.locator("[role=progressbar]:visible").count()) {
      await wait(page, 300);
      continue;
    }
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

function isNoAvailabilityText(text) {
  return /fully booked|no appointments available|no available appointments|there is no availability today/i.test(String(text || ""));
}

async function scrapeMindbodyBusiness(page, business, attemptNumber = 1) {
  const startedAt = Date.now();
  const window = compat.windowFor(business);
  const monitor = compat.networkMonitor(page);
  try {
  await page.goto(business.bookingUrl, {waitUntil:"domcontentloaded",timeout:90000});
  const frame = await compat.widgetFrame(page);
  await compat.exposeService(frame, page, business);
  await compat.selectService(frame, page, business);
  await runModernMindbodyFlow(frame, page, business);
  const initial = await compat.settledSnapshot(frame, page, undefined, monitor);
  const appointments = [], daySnapshots = [];
  let current = initial;
  for (const date of window.dates) {
    if (current.date !== date) current = await compat.navigateDate(frame, page, date, monitor);
    if (current.date !== date) throw new Error(`Mindbody displayed date mismatch: expected ${date}, got ${current.date}`);
    const noAvailability = isNoAvailabilityText(current.text);
    if (!current.times.length && !noAvailability) throw new Error(`Mindbody availability not recognized for ${date}`);
    for (const time of current.times) appointments.push({date,localDateKey:date,time,source:"mindbody_widget"});
    daySnapshots.push({date,times:current.times,source:"verified_widget_date"});
    console.log(`[MINDBODY] ${date}: ${current.times.length} appointment time(s)`);
  }
  const {dates, ...scrapeWindow} = window;
  return {
    businessName:business.businessName, bookingUrl:business.bookingUrl,
    platform:business.platform || "mindbody", service:business.serviceName, serviceName:business.serviceName,
    serviceType:business.serviceType || "", durationMinutes:business.durationMinutes || null,
    platformServiceId:business.platformServiceId || business.serviceButtonId || business.serviceId || null,
    provider:business.skipProvider ? "Auto-selected" : business.providerText || "First Available",
    appointments, date:appointments[0]?.date || window.scrapeStartDate,
    times:[...new Set(appointments.map(a => a.time))],
    status:appointments.length ? "success" : "no_times_found",
    attemptNumber, scrapeDurationMs:Date.now()-startedAt, lastChecked:new Date().toISOString(),
    rawWidgetText:current.text, mindbodyDaySnapshots:daySnapshots,
    scraperVersion:"mindbody-compat-2026-09-30", ...scrapeWindow
  };
  } finally {monitor.dispose();}
}
module.exports = {scrapeMindbodyBusiness, isNoAvailabilityText};
