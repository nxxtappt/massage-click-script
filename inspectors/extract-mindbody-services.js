const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const TARGET_URL = process.argv[2];
const CATEGORY = process.argv[3] || "Massage";

if (!TARGET_URL) {
  console.error(`
Usage:
node inspectors/extract-mindbody-services.js "BOOKING_URL" "Massage"
`);
  process.exit(1);
}

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function guessDuration(text) {
  const match = text.match(/(\d+)\s*(min|minute)/i);
  return match ? Number(match[1]) : null;
}

function guessType(text) {
  const t = text.toLowerCase();

  if (t.includes("sports")) return "sports";
  if (t.includes("deep")) return "deep_tissue";
  if (t.includes("swedish")) return "swedish";
  if (t.includes("prenatal")) return "prenatal";
  if (t.includes("breathwork")) return "breathwork";

  return "massage";
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: {
      width: 1400,
      height: 1000
    }
  });

  console.log(`Opening ${TARGET_URL}`);

  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(5000);

  const frame = page.frames().find((f) =>
    f.url().includes("mindbodyonline.com/book/widgets/appointments")
  );

  if (!frame) {
    console.log("Mindbody widget frame not found.");
    await browser.close();
    process.exit(1);
  }

  console.log("Mindbody frame found.");

  const expandButtons = frame.locator("text=Expand");
  const expandCount = await expandButtons.count();

  for (let i = 0; i < expandCount; i++) {
    const btn = expandButtons.nth(i);

    const parentText = await btn
      .locator("../..")
      .innerText()
      .catch(() => "");

    if (parentText.toLowerCase().includes(CATEGORY.toLowerCase())) {
      console.log(`Opening ${CATEGORY} category...`);
      await btn.click();
      await page.waitForTimeout(3000);
      break;
    }
  }

  const buttons = frame.locator("button");
  const count = await buttons.count();

  const services = [];

  for (let i = 0; i < count; i++) {
    const btn = buttons.nth(i);

    const serviceId = await btn
      .getAttribute("data-service-id")
      .catch(() => null);

    if (!serviceId) continue;

    const grandParentText = cleanText(
      await btn
        .evaluate((el) => el.parentElement?.parentElement?.innerText || "")
        .catch(() => "")
    );

    if (!grandParentText || grandParentText === "Select") {
      continue;
    }

    const serviceName = grandParentText
      .replace("Show Details", "")
      .replace("Select", "")
      .replace(/\s+\d+\s*min$/i, "")
      .trim();

    services.push({
      serviceName,
      platformServiceId: serviceId,
      durationMinutes: guessDuration(serviceName),
      serviceType: guessType(serviceName),
      enabled: true,
      priority: "medium"
    });
  }

  const unique = [];

  for (const service of services) {
    const exists = unique.find(
      (s) => s.platformServiceId === service.platformServiceId
    );

    if (!exists) {
      unique.push(service);
    }
  }

  const output = {
    platform: "mindbody",
    category: CATEGORY,
    bookingUrl: TARGET_URL,
    serviceCount: unique.length,
    services: unique
  };

  const outputDir = path.join(process.cwd(), "inspector-results", "mindbody");

  fs.mkdirSync(outputDir, {
    recursive: true
  });

  const outputPath = path.join(outputDir, `${Date.now()}-services.json`);

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log("\n===== SERVICES FOUND =====");
  console.log(JSON.stringify(output, null, 2));

  console.log(`\nSaved to:\n${outputPath}`);

  await browser.close();
})();