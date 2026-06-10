const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const START_URL =
  process.argv[2] ||
  "https://locations.massageenvy.com/texas/austin/9600-escarpment-blvd.html?utm_source=GMB&utm_medium=useractions&utm_campaign=products+services";

const OUT_FILE = path.join(__dirname, "massage-envy-network-log.json");

const KEYWORDS = [
  "appointment",
  "availability",
  "booking",
  "calendar",
  "clinic",
  "employee",
  "provider",
  "schedule",
  "service",
  "slot",
  "slots",
  "time",
  "start_date",
  "end_date",
  "serviceid",
  "mainserviceid"
];

const BLOCKED = [
  "google",
  "googletagmanager",
  "google-analytics",
  "doubleclick",
  "facebook",
  "bing",
  "adroll",
  "adsrvr",
  "pinterest",
  "quantserve",
  "teads",
  "clinch",
  "hotjar"
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lower(value) {
  return String(value || "").toLowerCase();
}

function isBlocked(url = "") {
  const text = lower(url);
  return BLOCKED.some((word) => text.includes(word));
}

function isInterestingUrl(url = "") {
  const text = lower(url);
  if (isBlocked(text)) return false;
  return KEYWORDS.some((word) => text.includes(word));
}

function isInterestingText(text = "") {
  const body = lower(text);
  return KEYWORDS.some((word) => body.includes(word));
}

async function safeText(response) {
  try {
    const ct = response.headers()["content-type"] || "";
    if (
      ct.includes("image") ||
      ct.includes("font") ||
      ct.includes("video") ||
      ct.includes("octet-stream")
    ) {
      return "";
    }

    const text = await response.text();
    return text.slice(0, 15000);
  } catch {
    return "";
  }
}

async function writeLog(logs) {
  fs.writeFileSync(OUT_FILE, JSON.stringify(logs, null, 2));
}

async function dumpPageState(page, logs, label) {
  const state = await page.evaluate(() => {
    return {
      url: window.location.href,
      title: document.title,
      visibleText: document.body.innerText.slice(0, 5000),
      iframes: [...document.querySelectorAll("iframe")].map((iframe) => iframe.src),
      buttons: [...document.querySelectorAll("button")]
        .map((button) => ({
          text: button.innerText || button.textContent || "",
          disabled: button.disabled || false
        }))
        .slice(0, 100),
      links: [...document.querySelectorAll("a")]
        .map((a) => ({
          text: a.innerText || a.textContent || "",
          href: a.href || ""
        }))
        .filter((x) =>
          /book|appointment|schedule|service|massage|continue|relaxation|60/i.test(
            `${x.text} ${x.href}`
          )
        )
        .slice(0, 100),
      inputs: [...document.querySelectorAll("input, select")]
        .map((el) => ({
          tag: el.tagName,
          type: el.type || "",
          name: el.name || "",
          id: el.id || "",
          value: el.value || "",
          placeholder: el.placeholder || "",
          checked: el.checked || false
        }))
        .slice(0, 100)
    };
  });

  logs.push({
    type: "page-state",
    label,
    ...state,
    timestamp: new Date().toISOString()
  });

  await writeLog(logs);

  console.log(`\n[PAGE STATE] ${label}`);
  console.log("URL:", state.url);
  console.log("TITLE:", state.title);
}

async function clickBest(page, label, patterns, logs) {
  console.log(`\n[STEP] ${label}`);

  await dumpPageState(page, logs, `before: ${label}`);

  for (const pattern of patterns) {
    const locators = [
      page.getByRole("button", { name: pattern }),
      page.getByRole("link", { name: pattern }),
      page.getByText(pattern)
    ];

    for (const locator of locators) {
      try {
        const count = await locator.count();

        if (!count) continue;

        const first = locator.first();

        await first.scrollIntoViewIfNeeded().catch(() => null);
        await first.click({ timeout: 7000 });

        console.log(`[CLICKED] ${label} using ${pattern}`);
        await page.waitForLoadState("domcontentloaded").catch(() => null);
        await sleep(2500);
        await dumpPageState(page, logs, `after: ${label}`);
        return true;
      } catch {
        // try next selector
      }
    }
  }

  console.log(`[FAILED CLICK] ${label}`);

  logs.push({
    type: "click-failed",
    label,
    patterns: patterns.map(String),
    url: page.url(),
    timestamp: new Date().toISOString()
  });

  await writeLog(logs);
  return false;
}

async function selectDuration60(page, logs) {
  console.log("\n[STEP] Select 60 min");

  await dumpPageState(page, logs, "before: select 60 min");

  const patterns = [
    /60\s*min/i,
    /60\s*minute/i,
    /60/i
  ];

  for (const pattern of patterns) {
    try {
      const locator = page.getByText(pattern).first();
      if ((await locator.count()) > 0) {
        await locator.scrollIntoViewIfNeeded().catch(() => null);
        await locator.click({ timeout: 7000 });
        console.log("[CLICKED] 60 min");
        await sleep(1500);
        await dumpPageState(page, logs, "after: select 60 min");
        return true;
      }
    } catch {
      // keep trying
    }
  }

  console.log("[FAILED] Could not select 60 min");
  return false;
}

async function run() {
  const logs = [];

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  page.on("request", (request) => {
    const url = request.url();
    const postData = request.postData() || "";

    if (!isInterestingUrl(url) && !isInterestingText(postData)) return;

    const entry = {
      type: "request",
      method: request.method(),
      url,
      headers: request.headers(),
      postData,
      timestamp: new Date().toISOString()
    };

    logs.push(entry);
    writeLog(logs).catch(() => null);

    console.log("\n[REQUEST]");
    console.log(request.method(), url);

    if (postData) {
      console.log("[POST DATA]");
      console.log(postData);
    }
  });

  page.on("response", async (response) => {
    const url = response.url();

    if (isBlocked(url)) return;

    const text = await safeText(response);

    if (!isInterestingUrl(url) && !isInterestingText(text)) return;

    const entry = {
      type: "response",
      status: response.status(),
      url,
      headers: response.headers(),
      bodyPreview: text,
      timestamp: new Date().toISOString()
    };

    logs.push(entry);
    await writeLog(logs);

    console.log("\n[RESPONSE]");
    console.log(response.status(), url);

    if (text) {
      console.log("[BODY PREVIEW]");
      console.log(text.slice(0, 1500));
    }
  });

  console.log("\nOpening:");
  console.log(START_URL);
  console.log(`\nSaving log to: ${OUT_FILE}\n`);

  await page.goto(START_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await sleep(3000);
  await dumpPageState(page, logs, "initial landing page");

  await clickBest(
    page,
    "Click Book an Appointment",
    [/book an appointment/i, /book appointment/i, /book now/i, /book/i],
    logs
  );

  await clickBest(
    page,
    "Click Relaxation Massage",
    [/relaxation massage/i, /relaxation/i],
    logs
  );

  await clickBest(
    page,
    "Click Continue #1",
    [/continue/i, /next/i],
    logs
  );

  await clickBest(
    page,
    "Click Continue #2",
    [/continue/i, /next/i],
    logs
  );

  await selectDuration60(page, logs);

  await clickBest(
    page,
    "Click Continue #3",
    [/continue/i, /next/i, /see times/i, /find appointments/i],
    logs
  );

  console.log("\n[WAITING] Waiting for availability requests...");
  await sleep(10000);

  await dumpPageState(page, logs, "final availability page");

  const resourceUrls = await page.evaluate(() => {
    return performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .filter((url) =>
        /appointment|availability|booking|calendar|clinic|employee|provider|schedule|service|slot|time/i.test(
          url
        )
      );
  });

  logs.push({
    type: "performance-resource-urls",
    urls: resourceUrls,
    timestamp: new Date().toISOString()
  });

  await writeLog(logs);

  console.log("\n===== INTERESTING RESOURCE URLS =====");
  console.log(JSON.stringify(resourceUrls, null, 2));

  console.log("\nSaved network log:");
  console.log(OUT_FILE);

  await browser.close();
}

run().catch((error) => {
  console.error("\n[FATAL INSPECTOR ERROR]");
  console.error(error);
  process.exit(1);
});