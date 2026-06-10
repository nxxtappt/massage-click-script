const { chromium } = require("playwright");
const fs = require("fs");

const TARGET_URL =
  "https://www.vagaro.com/listings/massage/austin--tx?service=Swedish%20Massage%20-%2060%20minute";

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTimes(text) {
  const matches =
    text.match(/\b(1[0-2]|[1-9]):[0-5][0-9]\s?(AM|PM)\b/gi) || [];

  return [...new Set(matches.map(clean))];
}

function extractPrices(text) {
  const matches =
    text.match(/\$[0-9]+(?:\.[0-9]{2})?/g) || [];

  return [...new Set(matches)];
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: {
      width: 1400,
      height: 1800
    }
  });

  console.log("Opening Vagaro marketplace...");

  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });

  await page.waitForTimeout(10000);

  // Scroll to force lazy-loaded cards/buttons to render.
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(1500);
  }

  await page.screenshot({
    path: "vagaro-marketplace-debug.png",
    fullPage: true
  });

  const bodyText = await page.locator("body").innerText();
  const html = await page.content();

  fs.writeFileSync("vagaro-marketplace-raw.txt", bodyText);
  fs.writeFileSync("vagaro-marketplace-raw.html", html);

  const buttons = await page.locator("button").evaluateAll((els) =>
    els.map((el) => ({
      text: el.innerText,
      ariaLabel: el.getAttribute("aria-label"),
      className: el.className
    }))
  );

  const links = await page.locator("a").evaluateAll((els) =>
    els.map((el) => ({
      text: el.innerText,
      href: el.href,
      className: el.className
    }))
  );

  fs.writeFileSync(
    "vagaro-marketplace-buttons.json",
    JSON.stringify(buttons, null, 2)
  );

  fs.writeFileSync(
    "vagaro-marketplace-links.json",
    JSON.stringify(links, null, 2)
  );

  const lines = bodyText
    .split("\n")
    .map(clean)
    .filter(Boolean);

  console.log("\n===== PAGE TEXT SAMPLE =====");
  console.log(lines.slice(0, 250).join("\n"));

  console.log("\n===== BUTTONS SAMPLE =====");
  console.log(JSON.stringify(buttons.slice(0, 100), null, 2));

  console.log("\n===== LINKS SAMPLE =====");
  console.log(JSON.stringify(links.slice(0, 100), null, 2));

  const results = [];

  // Pattern 1: visible lines with Book / time.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    const hasBook = lower.includes("book");
    const times = extractTimes(line);
    const prices = extractPrices(line);

    if (!hasBook && times.length === 0) {
      continue;
    }

    const rawBlockLines = lines.slice(
      Math.max(0, i - 12),
      Math.min(lines.length, i + 8)
    );

    const rawBlock = rawBlockLines.join(" | ");

    const blockTimes = extractTimes(rawBlock);
    const blockPrices = extractPrices(rawBlock);

    const possibleBusinessName =
      rawBlockLines.find((x) =>
        links.some((link) => clean(link.text) === x && link.href.includes("vagaro.com"))
      ) ||
      rawBlockLines[0] ||
      null;

    results.push({
      businessName: possibleBusinessName,
      platform: "vagaro",
      service: "Swedish Massage - 60 Minute",
      bookingText: line,
      date: /today/i.test(rawBlock) ? "Today" : null,
      times: blockTimes,
      price: blockPrices[0] || prices[0] || null,
      status: blockTimes.length ? "success" : "possible_match",
      sourceUrl: TARGET_URL,
      rawBlock,
      lastChecked: new Date().toISOString()
    });
  }

  // Pattern 2: links/buttons containing Book text.
  for (const button of buttons) {
    const text = clean(button.text || button.ariaLabel);

    if (!text.toLowerCase().includes("book")) {
      continue;
    }

    results.push({
      businessName: null,
      platform: "vagaro",
      service: "Swedish Massage - 60 Minute",
      bookingText: text,
      date: /today/i.test(text) ? "Today" : null,
      times: extractTimes(text),
      price: extractPrices(text)[0] || null,
      status: extractTimes(text).length ? "success" : "possible_button_match",
      sourceUrl: TARGET_URL,
      rawBlock: text,
      lastChecked: new Date().toISOString()
    });
  }

  const deduped = [];
  const seen = new Set();

  for (const item of results) {
    const key = `${item.businessName}|${item.bookingText}|${item.rawBlock}`;

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }

  console.log("\n===== VAGARO MARKETPLACE RESULTS =====");
  console.log(JSON.stringify(deduped, null, 2));

  fs.writeFileSync(
    "vagaro-marketplace-results.json",
    JSON.stringify(deduped, null, 2)
  );

  console.log("\nSaved files:");
  console.log("- vagaro-marketplace-results.json");
  console.log("- vagaro-marketplace-raw.txt");
  console.log("- vagaro-marketplace-raw.html");
  console.log("- vagaro-marketplace-buttons.json");
  console.log("- vagaro-marketplace-links.json");
  console.log("- vagaro-marketplace-debug.png");

  await browser.close();
})();