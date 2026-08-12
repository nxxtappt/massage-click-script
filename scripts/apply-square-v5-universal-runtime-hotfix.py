from pathlib import Path

ROOT = Path.cwd()
SQUARE = ROOT / "scrapers/square.js"

if not SQUARE.exists():
    raise SystemExit("scrapers/square.js not found")

src = SQUARE.read_text()
backup = SQUARE.with_name("square.js.pre-square-v5-universal-runtime-hotfix")
if not backup.exists():
    backup.write_text(src)
    print(f"[BACKUP] {backup.name}")

browser_discovery = r'''
async function discoverSquareSyncIdsInBrowser(squareSiteOrigin, timeoutMs = 20000) {
  if (!squareSiteOrigin) return null;

  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (error) {
    console.warn("[SQUARE] Playwright unavailable for square-sync network discovery:", error.message);
    return null;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();
  let discovered = null;

  function inspectUrl(url = "") {
    if (discovered) return;
    const match = String(url).match(
      /\/app\/square-sync\/published\/users\/(\d+)\/site\/(\d+)\/appointments(?:\/|$)/i
    );
    if (match) {
      discovered = { publishedUserId: match[1], siteId: match[2] };
    }
  }

  page.on("request", (request) => inspectUrl(request.url()));
  page.on("response", (response) => inspectUrl(response.url()));

  try {
    await page.goto(`${squareSiteOrigin}/`, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });

    const deadline = Date.now() + Math.min(timeoutMs, 12000);
    while (!discovered && Date.now() < deadline) {
      await page.waitForTimeout(250);
    }

    if (discovered) {
      console.log("[SQUARE] Discovered square-sync IDs from browser network", {
        squareSiteOrigin,
        publishedUserId: discovered.publishedUserId,
        siteId: discovered.siteId
      });
    }

    return discovered;
  } finally {
    await page.close().catch(() => null);
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

'''

if "async function discoverSquareSyncIdsInBrowser(" not in src:
    marker = "async function discoverSquareContext(target = {}) {"
    if marker not in src:
        raise SystemExit("Could not find discoverSquareContext marker.")
    src = src.replace(marker, browser_discovery + marker, 1)

old_discovery = r'''  const discovered = findPublishedIdsInText(text);

  if (!discovered) {
    throw new Error(
      "Square site loaded, but published user/site IDs were not discoverable from HTML. " +
        "If this merchant has a book.squareup.com appointment URL, save that as Booking URL. " +
        "Otherwise save squarePublishedUserId and squareSiteId on the business integration. " +
        `Square site: ${squareSiteOrigin}`
    );
  }

  return {
    squareSiteOrigin,
    ...discovered,
    syncBase:
      `${squareSiteOrigin}/app/square-sync/published/users/` +
      `${discovered.publishedUserId}/site/${discovered.siteId}/appointments`,'''

new_discovery = r'''  let discovered = findPublishedIdsInText(text);

  if (!discovered) {
    discovered = await discoverSquareSyncIdsInBrowser(
      squareSiteOrigin,
      Math.max(Number(target.squareTimeoutMs || 20000), 20000)
    );
  }

  if (!discovered) {
    throw new Error(
      "Square site loaded, but square-sync IDs were not discoverable from HTML or browser network traffic. " +
        "Save a direct book.squareup.com Booking URL if the merchant has one, or save " +
        "squarePublishedUserId and squareSiteId on the integration. " +
        `Square site: ${squareSiteOrigin}`
    );
  }

  return {
    squareSiteOrigin,
    ...discovered,
    syncBase:
      `${squareSiteOrigin}/app/square-sync/published/users/` +
      `${discovered.publishedUserId}/site/${discovered.siteId}/appointments`,'''

if old_discovery in src:
    src = src.replace(old_discovery, new_discovery, 1)
elif "browser network traffic" not in src:
    raise SystemExit("Could not patch square-sync discovery fallback.")

old_sig = '''async function fetchSquareAvailabilityInBrowser({
  bookingUrl,
  buyerStartUrl,
  payload,
  serviceName = "",
  staffProfiles = [],
  timeoutMs = 35000
}) {'''

new_sig = '''async function fetchSquareAvailabilityInBrowser({
  bookingUrl,
  buyerStartUrl,
  payload,
  serviceName = "",
  serviceId = "",
  durationMinutes = null,
  staffProfiles = [],
  timeoutMs = 35000
}) {'''

if old_sig in src:
    src = src.replace(old_sig, new_sig, 1)

option_helper = r'''
  async function clickConfiguredServiceOption() {
    const configuredId = String(serviceId || "").trim();

    if (configuredId) {
      const selectors = [
        `a[href*="${configuredId}"]`,
        `button[data-id="${configuredId}"]`,
        `[data-service-id="${configuredId}"]`,
        `[data-variation-id="${configuredId}"]`,
        `[data-item-id="${configuredId}"]`,
        `[value="${configuredId}"]`
      ];

      for (const selector of selectors) {
        if (await clickLocator(page.locator(selector), `configured-id:${configuredId}`)) {
          return true;
        }
      }
    }

    const minutes = Number(durationMinutes || 0);
    if (Number.isFinite(minutes) && minutes > 0) {
      const patterns = [
        new RegExp(`(?:^|\\b)${minutes}\\s*(?:min|mins|minute|minutes)(?:\\b|$)`, "i")
      ];

      const hours = minutes / 60;
      if (Number.isInteger(hours)) {
        patterns.push(
          new RegExp(`(?:^|\\b)${hours}\\s*(?:hr|hrs|hour|hours)(?:\\b|$)`, "i")
        );
      }

      for (const pattern of patterns) {
        for (const locator of [
          page.getByRole("button", { name: pattern }),
          page.getByRole("link", { name: pattern }),
          page.getByText(pattern, { exact: false })
        ]) {
          if (await clickLocator(locator, `duration-option:${minutes}`)) {
            return true;
          }
        }
      }
    }

    return false;
  }

'''

browser_start = src.find("async function fetchSquareAvailabilityInBrowser({")
attempt_pos = src.find("  async function attemptNativeFlow() {", browser_start)
if attempt_pos == -1:
    raise SystemExit("Could not find attemptNativeFlow.")

if "async function clickConfiguredServiceOption()" not in src[browser_start:attempt_pos]:
    src = src[:attempt_pos] + option_helper + src[attempt_pos:]

needle = '''    const genericSteps = [
      [/book/i, "book"],'''

replacement = '''    if (await clickConfiguredServiceOption()) {
      result = await waitForNative(4000);
      if (result) return result;
    }

    const genericSteps = [
      [/book/i, "book"],'''

if needle in src and "clickConfiguredServiceOption()) {" not in src[src.find("async function attemptNativeFlow"):src.find("async function replayInsidePage")]:
    src = src.replace(needle, replacement, 1)

direct_pos = src.find("async function scrapeSquareDirectBookingBusiness(")
old_call = '''    payload: null,
    serviceName,
    staffProfiles: [],
    timeoutMs: Math.max(Number(target.squareTimeoutMs || 20000), 35000)
  });'''
new_call = '''    payload: null,
    serviceName,
    serviceId: serviceItemId,
    durationMinutes: toNumberOrNull(target.durationMinutes),
    staffProfiles: [],
    timeoutMs: Math.max(Number(target.squareTimeoutMs || 20000), 35000)
  });'''

call_pos = src.find(old_call, direct_pos)
if call_pos != -1:
    src = src[:call_pos] + src[call_pos:].replace(old_call, new_call, 1)

for marker in [
    "async function discoverSquareSyncIdsInBrowser(",
    "async function clickConfiguredServiceOption()",
    "serviceId: serviceItemId",
    "durationMinutes: toNumberOrNull(target.durationMinutes)"
]:
    if marker not in src:
        raise SystemExit(f"Missing patch marker: {marker}")

SQUARE.write_text(src)
print("[PATCHED] scrapers/square.js")