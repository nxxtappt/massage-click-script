// inspectors/inspect-meevo-deep.js
//
// Purpose:
// Deeper Meevo API/flow inspector.
// Current target:
// - Category: Swedish Massage
// - Specific service: 1 Hour Swedish Massage
// - Therapist mode: Any Therapist
// - Next objective: trigger Angular therapist selection state and expose availability APIs
//
// Usage:
// node inspectors/inspect-meevo-deep.js "MEEVO_URL"

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2];

const CATEGORY_SEARCH = "Swedish Massage";
const SERVICE_SEARCH = "1 Hour Swedish Massage";
const THERAPIST_SEARCH = "Any Therapist";

if (!TARGET_URL) {
  console.error(`
Usage:
node inspectors/inspect-meevo-deep.js "MEEVO_URL"
`);
  process.exit(1);
}

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function clickText(page, text, exact = false) {
  try {
    const locator = page.getByText(text, { exact });
    const count = await locator.count();

    if (count === 0) {
      console.log(`No match found for: ${text}`);
      return false;
    }

    console.log(`Clicking: ${text}`);

    await locator.first().click({
      timeout: 7000,
      force: true
    });

    await page.waitForTimeout(3000);
    return true;
  } catch (error) {
    console.log(`Could not click "${text}": ${error.message}`);
    return false;
  }
}

async function clickButtonByText(page, text, exact = true) {
  try {
    const pattern = exact
      ? new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`, "i")
      : new RegExp(escapeRegExp(text), "i");

    const button = page.locator("button").filter({
      hasText: pattern
    });

    const count = await button.count();

    if (count === 0) {
      console.log(`No button found for: ${text}`);
      return false;
    }

    console.log(`Clicking button: ${text}`);

    await button.first().click({
      timeout: 7000,
      force: true
    });

    await page.waitForTimeout(3000);
    return true;
  } catch (error) {
    console.log(`Could not click button "${text}": ${error.message}`);
    return false;
  }
}

async function clickLastTextMatch(page, text) {
  try {
    const locator = page.getByText(text, { exact: false });
    const count = await locator.count();

    if (count === 0) {
      console.log(`No match found for service: ${text}`);
      return false;
    }

    console.log(`Clicking SERVICE last match: ${text}`);

    await locator.last().click({
      timeout: 7000,
      force: true
    });

    await page.waitForTimeout(4000);
    return true;
  } catch (error) {
    console.log(`Could not click service "${text}": ${error.message}`);
    return false;
  }
}

async function handleAddOnsIfPresent(page) {
  console.log("\nChecking for Meevo add-on step...");

  const bodyText = cleanText(
    await page.locator("body").innerText().catch(() => "")
  );

  const likelyAddOnStep =
    bodyText.includes("No, thanks") ||
    bodyText.includes("Aromatherapy") ||
    bodyText.includes("Save") ||
    bodyText.includes("Add-on") ||
    bodyText.includes("Add-On");

  if (!likelyAddOnStep) {
    console.log("No add-on step detected.");
    return false;
  }

  console.log("Add-on step detected.");

  const clickedNoThanks = await clickButtonByText(page, "No, thanks", true);

  if (clickedNoThanks) {
    await page.waitForTimeout(4000);
    return true;
  }

  const clickedSave = await clickButtonByText(page, "Save", true);

  if (clickedSave) {
    await page.waitForTimeout(4000);
    return true;
  }

  console.log("Add-on step was detected, but neither No, thanks nor Save could be clicked.");
  return false;
}

async function isNextDisabled(page) {
  try {
    const nextButton = page.locator("button").filter({
      hasText: /^Next$/
    });

    const count = await nextButton.count();

    if (count === 0) {
      return true;
    }

    const disabledNative = await nextButton.first().isDisabled().catch(() => false);
    const className = await nextButton.first().getAttribute("class").catch(() => "");

    return disabledNative || String(className || "").includes("disabled-btn");
  } catch {
    return true;
  }
}

async function clickAnyTherapist(page) {
  console.log("\n==================================================");
  console.log("CLICKING ANY THERAPIST WITH PLAYWRIGHT-NATIVE LOGIC");
  console.log("==================================================");

  let clickedSomething = false;

  const attempts = [
    {
      name: "exact div text Any Therapist",
      locator: page.locator("div").filter({ hasText: /^Any Therapist$/ })
    },
    {
      name: "OB-EMPLOYEE text Any Therapist",
      locator: page.locator("ob-employee").getByText("Any Therapist", { exact: true })
    },
    {
      name: "visible exact text Any Therapist",
      locator: page.getByText("Any Therapist", { exact: true })
    }
  ];

  for (const attempt of attempts) {
    try {
      const count = await attempt.locator.count().catch(() => 0);
      console.log(`${attempt.name} count:`, count);

      if (count === 0) {
        continue;
      }

      for (let i = 0; i < Math.min(count, 5); i++) {
        const target = attempt.locator.nth(i);
        const visible = await target.isVisible().catch(() => false);

        if (!visible) {
          console.log(`${attempt.name} index ${i} is not visible`);
          continue;
        }

        const box = await target.boundingBox().catch(() => null);
        const text = cleanText(await target.innerText().catch(() => ""));

        console.log({
          attempt: attempt.name,
          index: i,
          text,
          box
        });

        if (!box) {
          continue;
        }

        console.log(`Hovering and clicking ${attempt.name} index ${i}...`);

        await target.hover({ force: true });
        await page.waitForTimeout(500);

        await target.click({
          force: true,
          timeout: 7000,
          position: {
            x: Math.max(5, Math.min(20, box.width / 2)),
            y: Math.max(5, Math.min(10, box.height / 2))
          }
        });

        clickedSomething = true;

        await page.waitForTimeout(5000);

        let disabled = await isNextDisabled(page);
        console.log("Next disabled after Playwright click:", disabled);

        if (!disabled) {
          console.log("SUCCESS: Next appears enabled after Any Therapist click.");
          return true;
        }

        console.log("Trying focus + Enter/Space on same target...");

        try {
          await target.focus();
          await page.keyboard.press("Enter");
          await page.waitForTimeout(3000);

          disabled = await isNextDisabled(page);
          console.log("Next disabled after Enter:", disabled);

          if (!disabled) {
            console.log("SUCCESS: Next appears enabled after Enter.");
            return true;
          }

          await page.keyboard.press("Space");
          await page.waitForTimeout(3000);

          disabled = await isNextDisabled(page);
          console.log("Next disabled after Space:", disabled);

          if (!disabled) {
            console.log("SUCCESS: Next appears enabled after Space.");
            return true;
          }
        } catch (error) {
          console.log(`Keyboard activation failed: ${error.message}`);
        }
      }
    } catch (error) {
      console.log(`Attempt failed for ${attempt.name}: ${error.message}`);
    }
  }

  console.log("Trying parent/sibling DOM event fallback...");

  const domResult = await page.evaluate(() => {
    function clean(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }

    const all = Array.from(document.querySelectorAll("*"));
    const exact = all.find((el) => clean(el.innerText || el.textContent) === "Any Therapist");

    if (!exact) {
      return {
        success: false,
        reason: "No exact Any Therapist element found"
      };
    }

    const candidates = [
      exact,
      exact.parentElement,
      exact.parentElement?.parentElement,
      exact.closest("ob-employee"),
      exact.closest("app-service"),
      exact.closest(".step-content-container"),
      exact.closest(".ng-star-inserted")
    ].filter(Boolean);

    const eventNames = [
      "pointerover",
      "mouseover",
      "mouseenter",
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click",
      "change"
    ];

    const results = [];

    for (const candidate of candidates) {
      try {
        candidate.scrollIntoView({
          block: "center",
          inline: "center"
        });
      } catch {}

      for (const eventName of eventNames) {
        try {
          candidate.dispatchEvent(
            new MouseEvent(eventName, {
              bubbles: true,
              cancelable: true,
              view: window
            })
          );
        } catch {}
      }

      try {
        candidate.click();
      } catch {}

      results.push({
        tag: candidate.tagName,
        className: candidate.getAttribute("class"),
        text: clean(candidate.innerText || candidate.textContent).slice(0, 300)
      });
    }

    return {
      success: true,
      exactTag: exact.tagName,
      exactClass: exact.getAttribute("class"),
      exactText: clean(exact.innerText || exact.textContent),
      clickedCandidates: results
    };
  });

  console.log("DOM fallback result:");
  console.log(JSON.stringify(domResult, null, 2));

  await page.waitForTimeout(7000);

  let disabledAfterDom = await isNextDisabled(page);
  console.log("Next disabled after DOM fallback:", disabledAfterDom);

  if (!disabledAfterDom) {
    return true;
  }

  console.log("Trying coordinate click fallback from exact Any Therapist locator...");

  try {
    const exact = page.getByText("Any Therapist", { exact: true });
    const count = await exact.count();

    if (count > 0) {
      const box = await exact.first().boundingBox();

      if (box) {
        console.log("Any Therapist bounding box:", box);

        const points = [
          [box.x + box.width / 2, box.y + box.height / 2],
          [box.x + 8, box.y + box.height / 2],
          [box.x + box.width - 8, box.y + box.height / 2],
          [box.x + box.width / 2, box.y + 8],
          [box.x + box.width / 2, box.y + box.height - 8]
        ];

        for (const [x, y] of points) {
          console.log(`Coordinate clicking Any Therapist at ${x}, ${y}`);

          await page.mouse.move(x, y);
          await page.waitForTimeout(250);
          await page.mouse.down();
          await page.waitForTimeout(250);
          await page.mouse.up();
          await page.waitForTimeout(4000);

          const disabled = await isNextDisabled(page);
          console.log("Next disabled after coordinate click:", disabled);

          if (!disabled) {
            return true;
          }
        }
      }
    }
  } catch (error) {
    console.log(`Coordinate fallback failed: ${error.message}`);
  }

  return clickedSomething;
}

async function activateDateTimeStep(page) {
  console.log("\n==================================================");
  console.log("DATE & TIME ACTIVATION ATTEMPT");
  console.log("==================================================");

  await page.waitForTimeout(3000);

  await clickText(page, "3 Date & Time", false);
  await page.waitForTimeout(5000);

  await clickText(page, "Date & Time", false);
  await page.waitForTimeout(5000);

  console.log("Scrolling page to force Date & Time lazy load...");
  await page.mouse.wheel(0, 1600);
  await page.waitForTimeout(5000);

  await page.evaluate(() => {
    const candidates = [
      document.scrollingElement,
      document.body,
      ...Array.from(document.querySelectorAll(
        ".mat-step-content, .step-content-container, mat-vertical-stepper, mil-external-vertical-stepper, app-root"
      ))
    ].filter(Boolean);

    for (const el of candidates) {
      try {
        el.scrollTop = el.scrollTop + 1800;
      } catch {}
    }
  });

  await page.waitForTimeout(5000);

  try {
    const headers = page.locator("mat-step-header");
    const count = await headers.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
      const header = headers.nth(i);
      const text = cleanText(await header.innerText().catch(() => ""));

      if (text.includes("Date") || text.includes("Time") || text.includes("3")) {
        console.log(`Clicking possible Date & Time mat-step-header: ${text}`);

        await header.click({
          timeout: 7000,
          force: true
        });

        await page.waitForTimeout(5000);
      }
    }
  } catch (error) {
    console.log(`Could not click Date & Time mat-step-header: ${error.message}`);
  }

  console.log("Date & Time activation attempt complete.");
}

async function verifyServiceSelected(page, label) {
  console.log(`\n==================================================`);
  console.log(label);
  console.log(`==================================================`);

  const bodyText = cleanText(
    await page.locator("body").innerText().catch(() => "")
  );

  const stillNotSelected =
    bodyText.includes("Service not selected") ||
    bodyText.includes("Guest Service not selected");

  if (stillNotSelected) {
    console.log("SERVICE STATUS: NOT SELECTED");
    return false;
  }

  if (bodyText.includes(SERVICE_SEARCH)) {
    console.log("SERVICE STATUS: SELECTED");
    return true;
  }

  console.log("SERVICE STATUS: UNCLEAR");
  return false;
}

async function verifyTherapistSelected(page, label) {
  console.log(`\n==================================================`);
  console.log(label);
  console.log(`==================================================`);

  const bodyText = cleanText(
    await page.locator("body").innerText().catch(() => "")
  );

  const nextDisabled = await isNextDisabled(page);

  console.log("Next disabled:", nextDisabled);

  if (!nextDisabled) {
    console.log("THERAPIST STATUS: LIKELY SELECTED / NEXT ENABLED");
    return true;
  }

  if (
    bodyText.includes("Date & Time") &&
    !bodyText.includes("Select a Specific Therapist for Guest")
  ) {
    console.log("THERAPIST STATUS: LIKELY SELECTED / MOVED FORWARD");
    return true;
  }

  if (bodyText.includes("Select a Specific Therapist for Guest")) {
    console.log("THERAPIST STATUS: STILL ON THERAPIST SELECTION SCREEN");
    return false;
  }

  if (bodyText.includes(THERAPIST_SEARCH)) {
    console.log(`THERAPIST STATUS: FOUND TEXT "${THERAPIST_SEARCH}", BUT SCREEN STATE IS UNCLEAR`);
  }

  console.log("THERAPIST STATUS: UNCLEAR");
  return false;
}

async function printBody(page, label) {
  console.log(`\n==================================================`);
  console.log(label);
  console.log(`==================================================`);

  const bodyText = cleanText(
    await page.locator("body").innerText().catch(() => "")
  );

  console.log(bodyText.slice(0, 16000));
}

async function printButtons(page, label) {
  console.log(`\n==================================================`);
  console.log(label);
  console.log(`==================================================`);

  const buttons = page.locator("button");
  const count = await buttons.count().catch(() => 0);

  console.log("Button count:", count);

  for (let i = 0; i < Math.min(count, 140); i++) {
    const button = buttons.nth(i);

    const text = cleanText(await button.innerText().catch(() => ""));
    const disabled = await button.isDisabled().catch(() => false);
    const className = await button.getAttribute("class").catch(() => null);
    const ariaLabel = await button.getAttribute("aria-label").catch(() => null);

    console.log({
      index: i,
      text,
      disabled,
      className,
      ariaLabel
    });
  }
}

async function printClickableSample(page, label) {
  console.log(`\n==================================================`);
  console.log(label);
  console.log(`==================================================`);

  const elements = page.locator(
    [
      "button",
      "a",
      '[role="button"]',
      "mat-card",
      "mat-option",
      "mat-list-item",
      "mat-step-header",
      "li",
      ".category-item",
      ".addonItems",
      "ob-employee",
      "ob-employee-item",
      ".summary-service-selected",
      ".mat-step-header",
      ".mat-calendar-body-cell",
      ".calendar",
      ".datepicker",
      ".ng-star-inserted"
    ].join(", ")
  );

  const count = await elements.count().catch(() => 0);

  console.log("Clickable-ish count:", count);

  for (let i = 0; i < Math.min(count, 340); i++) {
    const el = elements.nth(i);

    const text = cleanText(await el.innerText().catch(() => ""));
    const tagName = await el.evaluate((node) => node.tagName).catch(() => null);
    const role = await el.getAttribute("role").catch(() => null);
    const className = await el.getAttribute("class").catch(() => null);

    if (text) {
      console.log({
        index: i,
        tagName,
        role,
        className,
        text: text.slice(0, 300)
      });
    }
  }
}

async function printPossibleTimes(page, label) {
  console.log(`\n==================================================`);
  console.log(label);
  console.log(`==================================================`);

  const bodyText = cleanText(
    await page.locator("body").innerText().catch(() => "")
  );

  const times =
    bodyText.match(/\b(1[0-2]|[1-9]):[0-5][0-9]\s?(AM|PM|am|pm)\b/g) || [];

  console.log([...new Set(times.map((t) => cleanText(t).toUpperCase()))]);
}

async function printStorage(page, label) {
  console.log(`\n==================================================`);
  console.log(label);
  console.log(`==================================================`);

  try {
    const storage = await page.evaluate(() => {
      const local = {};
      const session = {};

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        local[key] = localStorage.getItem(key);
      }

      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        session[key] = sessionStorage.getItem(key);
      }

      return { localStorage: local, sessionStorage: session };
    });

    console.log(JSON.stringify(storage, null, 2).slice(0, 30000));
  } catch (error) {
    console.log(`Could not print storage: ${error.message}`);
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: {
      width: 1400,
      height: 1200
    },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  });

  const page = await context.newPage();

  const apiHits = [];

  page.on("request", async (request) => {
    const url = request.url();

    if (
      /meevo\.com\/.*(api|service|provider|therapist|employee|availability|appointment|slot|time|book|calendar|schedule|openings|hours|day|week|search|reserve|resource|timeslot|booking)/i.test(
        url
      )
    ) {
      console.log("\n==================================================");
      console.log("API REQUEST");
      console.log("==================================================");
      console.log("METHOD:", request.method());
      console.log("URL:", url);

      const postData = request.postData();
      if (postData) {
        console.log("POST DATA:");
        console.log(postData.slice(0, 10000));
      }
    }
  });

  page.on("response", async (response) => {
    const url = response.url();

    if (
      /meevo\.com\/.*(api|service|provider|therapist|employee|availability|appointment|slot|time|book|calendar|schedule|openings|hours|day|week|search|reserve|resource|timeslot|booking)/i.test(
        url
      )
    ) {
      let preview = null;

      try {
        const contentType = response.headers()["content-type"] || "";

        if (contentType.includes("application/json")) {
          const json = await response.json();
          preview = JSON.stringify(json, null, 2).slice(0, 40000);
        } else {
          preview = `[non-json: ${contentType}]`;
        }
      } catch (error) {
        preview = `[could not parse response: ${error.message}]`;
      }

      const hit = {
        status: response.status(),
        method: response.request().method(),
        url,
        postData: response.request().postData(),
        preview
      };

      apiHits.push(hit);

      console.log("\n==================================================");
      console.log("API RESPONSE");
      console.log("==================================================");
      console.log("STATUS:", hit.status);
      console.log("METHOD:", hit.method);
      console.log("URL:", hit.url);

      if (hit.postData) {
        console.log("POST DATA:");
        console.log(hit.postData.slice(0, 10000));
      }

      console.log("RESPONSE PREVIEW:");
      console.log(hit.preview);
    }
  });

  console.log("\nOpening:");
  console.log(TARGET_URL);
  console.log(`Target category: ${CATEGORY_SEARCH}`);
  console.log(`Target service: ${SERVICE_SEARCH}`);
  console.log(`Target therapist mode: ${THERAPIST_SEARCH}`);

  await page.goto(TARGET_URL, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(6000);

  await printBody(page, "INITIAL BODY");
  await printButtons(page, "INITIAL BUTTONS");

  try {
    const acceptAll = page.getByText("Accept All", { exact: true });
    if ((await acceptAll.count()) > 0) {
      console.log("Clicking cookie Accept All...");
      await acceptAll.first().click({ timeout: 3000, force: true });
      await page.waitForTimeout(1000);
    }
  } catch {}

  try {
    const closeButtons = page.locator("button.closeable-banner__close");
    if ((await closeButtons.count()) > 0) {
      console.log("Closing banner...");
      await closeButtons.first().click({ timeout: 3000, force: true });
      await page.waitForTimeout(1000);
    }
  } catch {}

  await clickText(page, "Next", true);

  await printBody(page, "AFTER FIRST NEXT");
  await printClickableSample(page, "CLICKABLES AFTER FIRST NEXT");

  await clickText(page, CATEGORY_SEARCH, false);

  await page.waitForTimeout(4000);

  await printBody(page, "AFTER CATEGORY CLICK");
  await printClickableSample(page, "CLICKABLES AFTER CATEGORY CLICK");

  await clickLastTextMatch(page, SERVICE_SEARCH);

  await page.waitForTimeout(4000);

  await printBody(page, "AFTER SPECIFIC SERVICE CLICK BEFORE ADD-ON HANDLING");
  await printClickableSample(page, "CLICKABLES AFTER SPECIFIC SERVICE CLICK BEFORE ADD-ON HANDLING");

  await handleAddOnsIfPresent(page);

  await page.waitForTimeout(5000);

  await printBody(page, "AFTER ADD-ON HANDLING");
  await printClickableSample(page, "CLICKABLES AFTER ADD-ON HANDLING");

  const serviceSelected = await verifyServiceSelected(
    page,
    "SERVICE SELECTION CHECK AFTER ADD-ON HANDLING"
  );

  if (!serviceSelected) {
    console.log("\nWARNING:");
    console.log("Service still does not appear selected. Continuing anyway for inspection.");
  }

  await clickAnyTherapist(page);

  await page.waitForTimeout(7000);

  await printBody(page, "AFTER ANY THERAPIST ATTEMPT");
  await printClickableSample(page, "CLICKABLES AFTER ANY THERAPIST ATTEMPT");
  await verifyTherapistSelected(page, "THERAPIST SELECTION CHECK");

  const nextDisabledBeforeClick = await isNextDisabled(page);
  console.log("Next disabled before trying Next:", nextDisabledBeforeClick);

  await clickText(page, "Next", true);

  await page.waitForTimeout(10000);

  await printBody(page, "AFTER NEXT TO DATE TIME");
  await printButtons(page, "BUTTONS AFTER NEXT TO DATE TIME");
  await printClickableSample(page, "CLICKABLES AFTER NEXT TO DATE TIME");
  await printPossibleTimes(page, "POSSIBLE TIMES AFTER NEXT TO DATE TIME");

  await activateDateTimeStep(page);

  await page.waitForTimeout(10000);

  await printBody(page, "AFTER DATE PANEL ACTIVATION");
  await printButtons(page, "BUTTONS AFTER DATE PANEL ACTIVATION");
  await printClickableSample(page, "CLICKABLES AFTER DATE PANEL ACTIVATION");
  await printPossibleTimes(page, "TIMES AFTER DATE PANEL ACTIVATION");

  await printStorage(page, "BROWSER STORAGE SNAPSHOT");

  console.log("\n==================================================");
  console.log("ALL API HITS SUMMARY");
  console.log("==================================================");

  console.log(
    JSON.stringify(
      apiHits.map((hit) => ({
        status: hit.status,
        method: hit.method,
        url: hit.url,
        hasPostData: !!hit.postData,
        postData: hit.postData ? hit.postData.slice(0, 3000) : null
      })),
      null,
      2
    )
  );

  await browser.close();

  console.log("\n==================================================");
  console.log("DONE");
  console.log("==================================================");
})();