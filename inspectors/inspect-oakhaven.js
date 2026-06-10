const { chromium } = require("playwright");

const URL = process.argv[2] || "https://oakhavenbooking.com/";

function shouldLogUrl(url = "") {
  const text = String(url).toLowerCase();

  return (
    text.includes("endpoints.php") ||
    text.includes("appointment") ||
    text.includes("booking") ||
    text.includes("availability") ||
    text.includes("service") ||
    text.includes("location") ||
    text.includes("therapist") ||
    text.includes("staff")
  );
}
async function dumpInputs(page, label) {
  console.log(`\n===== ${label} INPUTS =====`);

  const inputs = await page.$$eval(
    ".sessions input, .customizations input, .pressures input, .tiers input",
    els =>
      els.map(el => ({
        type: el.type,
        value: el.value,
        checked: el.checked,
        dataText: el.getAttribute("data-text"),
        dataId: el.getAttribute("data-id"),
        id: el.id,
        name: el.name
      }))
  );

  console.log(JSON.stringify(inputs, null, 2));
}
async function safeTextList(page, selector) {
  try {
    return await page.$$eval(selector, (elements) =>
      elements.map((el, index) => ({
        index,
        text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " "),
        id: el.id || "",
        className: el.className || "",
        href: el.href || "",
        ariaLabel: el.getAttribute("aria-label") || ""
      }))
    );
  } catch {
    return [];
  }
}

async function clickVisibleText(page, text, options = {}) {
  const { timeout = 15000, waitMs = 2500 } = options;

  console.log(`\n[FLOW] Clicking visible text: ${text}`);

  const locator = page.locator(`text=${text}`);
  const count = await locator.count();

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);

    if (await item.isVisible().catch(() => false)) {
      await item.click({ timeout });
      await page.waitForTimeout(waitMs);
      console.log(`[FLOW] Clicked visible: ${text}`);
      return true;
    }
  }

  throw new Error(`No visible element found for text: ${text}`);
}

async function clickById(page, id, label, options = {}) {
  const { timeout = 15000, waitMs = 2500 } = options;

  console.log(`\n[FLOW] Clicking ID: ${label} (${id})`);

  const locator = page.locator(`#${id}`).first();

  await locator.waitFor({
    state: "attached",
    timeout
  });

  await locator.evaluate((element) => {
    element.click();
  });

  await page.waitForTimeout(waitMs);

  console.log(`[FLOW] Clicked ID: ${label}`);
}

async function dumpSelectedState(page, label) {
  console.log(`\n===== ${label} SELECTED STATE =====`);

  const selectedState = await page.evaluate(() => {
    function val(selector) {
      const item = document.querySelector(selector);
      return item ? item.value || item.getAttribute("value") || "" : "";
    }

    function checked(selector) {
      const item = document.querySelector(selector);
      if (!item) return null;

      return {
        value: item.value || "",
        text:
          item.closest("label")?.innerText?.trim().replace(/\s+/g, " ") ||
          item.closest(".customlength")?.innerText?.trim().replace(/\s+/g, " ") ||
          item.closest(".pressuretype")?.innerText?.trim().replace(/\s+/g, " ") ||
          "",
        dataId: item.getAttribute("data-id") || "",
        name: item.getAttribute("name") || "",
        id: item.id || "",
        className: item.className || ""
      };
    }

    return {
      city: checked("input[name='City']:checked"),
      place: checked("input[name='Place']:checked"),
      location: checked(".locations input:checked"),
      customization: checked(".customizations input:checked"),
      session: checked(".sessions input:checked"),
      pressure: checked(".pressures input[name='pressure10']:checked"),
      preference: checked("input[name='Preference']:checked"),
      dropdownPreference: checked("#Dropdown input[name='radio-group']:checked"),
      tier: checked("input[name='Tier']:checked"),
      timing: checked("input[name='timings']:checked"),
      typeOfPressureValue: val(".typeOfPressure")
    };
  });

  console.log(JSON.stringify(selectedState, null, 2));
}

async function dumpPageState(page, label) {
  console.log(`\n===== ${label} PAGE URL =====`);
  console.log(page.url());

  console.log(`\n===== ${label} BODY TEXT PREVIEW =====`);
  try {
    const text = await page.locator("body").innerText({
      timeout: 5000
    });

    console.log(text.slice(0, 5000));
  } catch (error) {
    console.log("Could not read body text:", error.message);
  }

  console.log(`\n===== ${label} BUTTONS/LINKS PREVIEW =====`);
  const controls = await safeTextList(page, "button, a, label");
  console.log(JSON.stringify(controls.slice(0, 240), null, 2));
}

async function runOakHavenFlow(page) {
  console.log("\n===== OAK HAVEN FLOW TEST START =====");

  await clickById(page, "newAccountCreate", "Proceed as Guest", {
    waitMs: 3500
  });

  await clickVisibleText(page, "Austin", {
    waitMs: 2500
  });

  await clickVisibleText(page, "Next", {
    waitMs: 2500
  });

  await clickVisibleText(page, "S 1ST", {
    waitMs: 2500
  });

  await clickVisibleText(page, "Next", {
    waitMs: 2500
  });

  await clickVisibleText(page, "Customized Massage Session", {
    waitMs: 2500
  });

  await clickVisibleText(page, "Next", {
    waitMs: 2500
  });

  await clickVisibleText(page, "50 Minute Massage", {
    waitMs: 2500
  });

  await clickVisibleText(page, "Next", {
    waitMs: 2500
  });

  await clickVisibleText(page, "Relaxation", {
    waitMs: 2500
  });

  await clickVisibleText(page, "Next", {
    waitMs: 2500
  });

  await clickVisibleText(page, "No Preference", {
    waitMs: 2500
  });

  await clickVisibleText(page, "Next", {
    waitMs: 2500
  });

  await clickVisibleText(page, "Tier 1", {
    waitMs: 2500
  });

  await dumpSelectedState(page, "BEFORE AVAILABILITY");
await dumpInputs(page, "BEFORE AVAILABILITY");
  await clickVisibleText(page, "Next", {
    waitMs: 7000
  });

  await dumpSelectedState(page, "AFTER AVAILABILITY");

  try {
    await clickById(page, "showAvailableTimes", "Show Available Times", {
      waitMs: 5000
    });
  } catch (error) {
    console.log("[FLOW] Show Available Times click skipped:", error.message);
  }

  console.log("\n===== OAK HAVEN FLOW TEST COMPLETE =====");

  await dumpPageState(page, "AFTER AVAILABILITY");

  console.log("\n===== POSSIBLE TIME BUTTONS =====");

  const possibleTimes = await page.$$eval("button, a, div, span", (elements) =>
    elements
      .map((el, index) => ({
        index,
        text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " "),
        id: el.id || "",
        className: el.className || "",
        href: el.href || ""
      }))
      .filter((item) => {
        const text = item.text || "";

        return (
          /\b\d{1,2}:\d{2}\s*(AM|PM)\b/i.test(text) ||
          text.toLowerCase().includes("book now") ||
          text.toLowerCase().includes("available")
        );
      })
      .slice(0, 250)
  );

  console.log(JSON.stringify(possibleTimes, null, 2));
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 1200
    }
  });

  const page = await context.newPage();

  page.on("request", (request) => {
    const url = request.url();
    const method = request.method();

    if (url.includes("endPoints.php")) {
      console.log("\n================================");
      console.log("ENDPOINT REQUEST");
      console.log("URL:", url);
      console.log("METHOD:", method);

      try {
        const postData = request.postData();
        console.log("POST DATA:");
        console.log(postData || "(none)");
      } catch (error) {
        console.log("POST DATA ERROR:", error.message);
      }

      console.log("================================\n");
      return;
    }

    if (method === "POST" && shouldLogUrl(url)) {
      console.log("\n===== OTHER INTERESTING POST =====");
      console.log("URL:", url);
      console.log("METHOD:", method);

      try {
        const postData = request.postData();
        console.log("POST DATA:");
        console.log(postData || "(none)");
      } catch (error) {
        console.log("POST DATA ERROR:", error.message);
      }
    }
  });

  page.on("response", async (response) => {
    const url = response.url();

    if (url.includes("endPoints.php")) {
      console.log("===== OAK HAVEN ENDPOINT RESPONSE =====");
      console.log("STATUS:", response.status());
      console.log("URL:", url);

      try {
        const text = await response.text();
        console.log("BODY PREVIEW:");
        console.log(text.slice(0, 1500));
      } catch (error) {
        console.log("BODY READ ERROR:", error.message);
      }

      return;
    }

    if (shouldLogUrl(url)) {
      console.log("[RESPONSE]", response.status(), url);
    }
  });

  try {
    await page.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    await page.waitForTimeout(5000);

    console.log("\n===== INITIAL PAGE URL =====");
    console.log(page.url());

    await runOakHavenFlow(page);

    console.log("\nInspector finished.");
  } catch (error) {
    console.error("\nInspector failed:", error.message);

    try {
      await dumpPageState(page, "ERROR STATE");
      await dumpSelectedState(page, "ERROR STATE");
    } catch {
      // ignore
    }
  } finally {
    await browser.close().catch(() => null);
  }
})();