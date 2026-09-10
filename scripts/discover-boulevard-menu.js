"use strict";

require("dotenv").config();

const { chromium } = require("playwright");
const { normalizeWidgetUrl } = require("../scrapers/boulevard");

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function usage() {
  console.log(
    'Usage: node scripts/discover-boulevard-menu.js --url="https://www.joinblvd.com/b/.../widget" [--location="Exact Location"]'
  );
}

async function clickIfVisible(locator) {
  try {
    if ((await locator.count()) > 0 && (await locator.first().isVisible())) {
      await locator.first().click({ timeout: 7000 });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function decodeCategoryFromHref(href) {
  const match = String(href || "").match(/\/cart\/menu\/([^/?#]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function getServiceIdFromHref(href) {
  const match = String(href || "").match(/\/s_([a-f0-9-]{20,})/i);
  return match ? match[1] : "";
}

async function main() {
  const rawUrl = getArg("url");
  const locationName = getArg("location");

  if (!rawUrl) {
    usage();
    process.exitCode = 1;
    return;
  }

  const widgetUrl = normalizeWidgetUrl({ boulevardWidgetUrl: rawUrl });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(widgetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(500);

    if (locationName) {
      await clickIfVisible(
        page
          .getByRole("button", { name: new RegExp(locationName, "i") })
          .or(page.getByRole("link", { name: new RegExp(locationName, "i") }))
          .or(page.getByText(locationName, { exact: true }))
      );
      await page.waitForTimeout(400);
    }

    await clickIfVisible(
      page.getByRole("button", { name: /Individual Appointment/i })
    );
    await page.waitForTimeout(400);

    const categoryLinks = await page.locator('a[href*="#/cart/menu/"]').evaluateAll(
      (links) =>
        links
          .map((link) => ({
            name: (link.textContent || "").replace(/\s+/g, " ").trim(),
            href: link.getAttribute("href") || ""
          }))
          .filter((item) => item.name && !/\/s_[a-f0-9-]+/i.test(item.href))
    );

    const uniqueCategories = [
      ...new Map(categoryLinks.map((item) => [item.href, item])).values()
    ];
    const menu = [];

    for (const category of uniqueCategories) {
      const currentBase = (await page.url()).split("#")[0];
      const categoryUrl = new URL(category.href, currentBase).toString();
      await page.goto(categoryUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(250);

      const serviceLinks = await page.locator('a[href*="/s_"]').evaluateAll(
        (links) =>
          links.map((link) => ({
            serviceName: (link.textContent || "").replace(/\s+/g, " ").trim(),
            href: link.getAttribute("href") || ""
          }))
      );

      menu.push({
        categoryName: decodeCategoryFromHref(category.href) || category.name,
        services: [
          ...new Map(
            serviceLinks.map((service) => [getServiceIdFromHref(service.href), {
              serviceName: service.serviceName,
              platformServiceId: getServiceIdFromHref(service.href)
            }])
          ).values()
        ].filter((service) => service.platformServiceId)
      });
    }

    console.log(JSON.stringify({ widgetUrl, locationName, menu }, null, 2));
  } finally {
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

main().catch((error) => {
  console.error(`Boulevard menu discovery failed: ${error.message}`);
  process.exitCode = 1;
});