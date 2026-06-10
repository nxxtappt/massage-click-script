// inspectors/inspect-axl3.js

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2];
const SEARCH_TEXT = process.argv[3] || "The Deep";

if (!TARGET_URL) {
  console.error(`
Usage:
node inspectors/inspect-axl3.js "AXL3_BOOKING_URL" "The Deep"
`);
  process.exit(1);
}

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function printSection(title) {
  console.log("\n==================================================");
  console.log(title);
  console.log("==================================================");
}

async function safeText(locator) {
  try {
    return cleanText(await locator.innerText({ timeout: 1500 }));
  } catch {
    return "";
  }
}

async function inspectPage(page) {
  await printSection("PAGE INFO");
  console.log("Title:", await page.title().catch(() => "[No title]"));
  console.log("Current URL:", page.url());

  const bodyText = cleanText(await page.locator("body").innerText().catch(() => ""));

  await printSection("BODY TEXT SAMPLE");
  console.log(bodyText.slice(0, 15000) || "[No readable body text]");

  await printSection("SEARCH TARGETS FOUND IN BODY");
  const targets = [
    "The Deep",
    "DEEP",
    "60",
    "60 min",
    "60 minute",
    "Signature",
    "Massage",
    "appointment",
    "availability",
    "service"
  ];

  for (const target of targets) {
    console.log(`${target}:`, bodyText.toLowerCase().includes(target.toLowerCase()));
  }

  await printSection("BUTTONS");
  const buttons = page.locator("button");
  const buttonCount = await buttons.count().catch(() => 0);
  console.log("Button count:", buttonCount);

  for (let i = 0; i < Math.min(buttonCount, 250); i++) {
    const button = buttons.nth(i);
    const text = await safeText(button);
    const disabled = await button.isDisabled().catch(() => false);
    const id = await button.getAttribute("id").catch(() => null);
    const className = await button.getAttribute("class").catch(() => null);
    const ariaLabel = await button.getAttribute("aria-label").catch(() => null);

    const dataAttrs = await button.evaluate((el) => {
      const out = {};
      for (const attr of el.attributes) {
        if (attr.name.startsWith("data-")) out[attr.name] = attr.value;
      }
      return out;
    }).catch(() => ({}));

    if (text || id || className || ariaLabel || Object.keys(dataAttrs).length) {
      console.log(JSON.stringify({
        index: i,
        text,
        disabled,
        id,
        className,
        ariaLabel,
        dataAttrs
      }, null, 2));
    }
  }

  await printSection("LINKS");
  const links = page.locator("a");
  const linkCount = await links.count().catch(() => 0);
  console.log("Link count:", linkCount);

  for (let i = 0; i < Math.min(linkCount, 250); i++) {
    const link = links.nth(i);
    const text = await safeText(link);
    const href = await link.getAttribute("href").catch(() => null);
    const id = await link.getAttribute("id").catch(() => null);
    const className = await link.getAttribute("class").catch(() => null);

    if (text || href || id || className) {
      console.log(JSON.stringify({
        index: i,
        text,
        href,
        id,
        className
      }, null, 2));
    }
  }

  await printSection("INPUTS / SELECTS / TEXTAREAS");
  const fields = page.locator("input, select, textarea");
  const fieldCount = await fields.count().catch(() => 0);
  console.log("Field count:", fieldCount);

  for (let i = 0; i < Math.min(fieldCount, 150); i++) {
    const field = fields.nth(i);
    const tagName = await field.evaluate((el) => el.tagName).catch(() => null);
    const type = await field.getAttribute("type").catch(() => null);
    const id = await field.getAttribute("id").catch(() => null);
    const name = await field.getAttribute("name").catch(() => null);
    const placeholder = await field.getAttribute("placeholder").catch(() => null);
    const value = await field.inputValue().catch(() => null);

    let options = [];
    if (tagName === "SELECT") {
      options = await field.locator("option").evaluateAll((els) =>
        els.map((el) => ({
          text: cleanText(el.textContent),
          value: el.getAttribute("value")
        }))
      ).catch(() => []);
    }

    console.log(JSON.stringify({
      index: i,
      tagName,
      type,
      id,
      name,
      placeholder,
      value,
      options
    }, null, 2));
  }

  await printSection(`TEXT MATCHES FOR "${SEARCH_TEXT}"`);
  const matches = page.locator(`text=${SEARCH_TEXT}`);
  const matchCount = await matches.count().catch(() => 0);
  console.log("Match count:", matchCount);

  for (let i = 0; i < Math.min(matchCount, 75); i++) {
    const match = matches.nth(i);
    const text = await safeText(match);
    const tagName = await match.evaluate((el) => el.tagName).catch(() => null);
    const className = await match.getAttribute("class").catch(() => null);

    console.log(JSON.stringify({
      index: i,
      tagName,
      text,
      className
    }, null, 2));
  }

  await printSection("POSSIBLE TIME TEXT MATCHES");
  const timeMatches = bodyText.match(/\b(1[0-2]|[1-9]):[0-5][0-9]\s?(AM|PM|am|pm)\b/g) || [];
  console.log([...new Set(timeMatches.map((t) => cleanText(t).toUpperCase()))]);

  await printSection("POSSIBLE SERVICE IDS / NUMERIC IDS IN HTML");
  const html = await page.content().catch(() => "");
  const idMatches = html.match(/(?:service|serviceId|service_id|duration|appointment|appointmentType|category|location|provider|staff|employee)[^"'<>]{0,80}/gi) || [];
  console.log([...new Set(idMatches)].slice(0, 300));
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  });

  const page = await context.newPage();

  const apiHits = [];

  page.on("response", async (response) => {
    const url = response.url();

    if (
      /api|availability|appointment|booking|service|provider|staff|employee|slot|time|calendar|graphql|deep|duration|location/i.test(
        url
      )
    ) {
      const contentType = response.headers()["content-type"] || "";
      let preview = null;

      try {
        if (contentType.includes("application/json")) {
          const json = await response.json();
          preview = JSON.stringify(json, null, 2).slice(0, 20000);
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
      console.log("API / NETWORK HIT");
      console.log("==================================================");
      console.log("STATUS:", hit.status);
      console.log("METHOD:", hit.method);
      console.log("URL:", hit.url);
      if (hit.postData) {
        console.log("POST DATA:");
        console.log(hit.postData.slice(0, 8000));
      }
      console.log("RESPONSE PREVIEW:");
      console.log(hit.preview);
    }
  });

  console.log("Opening:", TARGET_URL);

  await page.goto(TARGET_URL, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(7000);

  await inspectPage(page);

  await printSection("FRAMES FOUND");
  page.frames().forEach((frame, index) => {
    console.log(`${index}: ${frame.url()}`);
  });

  await printSection("API HITS SUMMARY");
  console.log(
    JSON.stringify(
      apiHits.map((hit) => ({
        status: hit.status,
        method: hit.method,
        url: hit.url,
        hasPostData: !!hit.postData
      })),
      null,
      2
    )
  );

  await browser.close();

  await printSection("DONE");
  console.log("Paste the output back into ChatGPT.");
})();