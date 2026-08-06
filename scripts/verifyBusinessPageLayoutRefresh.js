const fs = require("fs");
const path = require("path");

function readSource(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function getBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  if (start === -1 || end === -1) {
    throw new Error(`Could not isolate ${startMarker}.`);
  }

  return source.slice(start, end);
}

function requireMarker(source, marker, label) {
  if (!source.includes(marker)) {
    throw new Error(`${label} is missing: ${marker}`);
  }
}

try {
  const javascript = readSource("public/business-page.js");
  const styles = readSource("public/business-page.css");
  const html = readSource("public/business-page.html");

  const verified = getBlock(
    javascript,
    "function renderVerifiedPage(page) {",
    "function renderUnverifiedPage(page) {"
  );

  const unverified = getBlock(
    javascript,
    "function renderUnverifiedPage(page) {",
    "async function loadBusinessInventory(page) {"
  );

  const inventory = getBlock(
    javascript,
    "async function loadBusinessInventory(page) {",
    "async function loadBusinessPage() {"
  );

  requireMarker(verified, 'about-only-grid', "Verified layout");
  requireMarker(verified, 'compact-about-card', "Verified layout");

  if (verified.includes("Specialties") || verified.includes("Amenities")) {
    throw new Error("Specialties or Amenities still render.");
  }

  if (verified.includes("${renderServiceCatalog(page)}")) {
    throw new Error("Services by category still renders.");
  }

  const inventoryIndex = verified.indexOf('class="inventory-card"');
  const widgetIndex = verified.indexOf("${renderBookingWidget(page)}");

  if (inventoryIndex === -1 || widgetIndex === -1 || inventoryIndex > widgetIndex) {
    throw new Error("Inventory is not above the booking widget.");
  }

  requireMarker(unverified, 'inventory-card muted', "Unverified layout");
  requireMarker(
    unverified,
    "Previewing up to eight current times per appointment category.",
    "Unverified layout"
  );

  requireMarker(inventory, 'page.isVerified ? "999" : "96"', "Inventory loader");
  requireMarker(inventory, ".slice(0, 4)", "Inventory loader");
  requireMarker(inventory, ".slice(0, 8)", "Inventory loader");
  requireMarker(inventory, "page.isVerified ? 14 : 3", "Inventory loader");

  requireMarker(
    styles,
    "/* NEXTAPPT BUSINESS PAGE LAYOUT REFRESH START */",
    "Business page CSS"
  );

  requireMarker(html, "v=20260806-layout-refresh", "Business page HTML");

  const loadIndex = javascript.indexOf("await loadBusinessInventory(page);");
  const mountIndex = javascript.indexOf("mountBookingWidget(page);", loadIndex);

  if (loadIndex === -1 || mountIndex === -1 || loadIndex > mountIndex) {
    throw new Error("Inventory does not load before the widget mounts.");
  }

  console.table([
    { feature: "Specialties and Amenities", result: "Removed" },
    { feature: "About", result: "Full-width compact card" },
    { feature: "Services catalog", result: "Hidden" },
    { feature: "Inventory order", result: "Above booking widgets" },
    { feature: "Unverified inventory", result: "4 categories / 8 times / 3 dates" },
    { feature: "Unverified styling", result: "Muted and grayscale" }
  ]);

  console.log("\nBusiness page layout refresh verification passed.");
} catch (error) {
  console.error("\nBusiness page layout refresh verification failed.");
  console.error(error);
  process.exitCode = 1;
}