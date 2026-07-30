#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(process.cwd());
const DRY_RUN = process.argv.includes("--dry-run");
const ALLOW_SHA_MISMATCH = process.argv.includes("--allow-sha-mismatch");

const EXPECTED_GIT_BLOB_SHAS = {
  "database/BusinessRepository.js": "bb184f9b612a4a76907aa1c7661ced79375f48f1",
  "businessManager.js": "8f4f928978f2ed1126d8eb9f999f0927c73efc52",
  "inventoryManager.js": "f0b0ca0a5157d74ecc0dc7f7ea5e37608641121e",
  "public/app.js": "34b36f44b640ff5c693b4666c2558f906d6a6cc3"
};

function gitBlobSha(content) {
  const body = Buffer.from(content, "utf8");
  return crypto
    .createHash("sha1")
    .update(Buffer.from(`blob ${body.length}\0`, "utf8"))
    .update(body)
    .digest("hex");
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first === -1) {
    throw new Error(`Could not find patch anchor: ${label}`);
  }

  const second = source.indexOf(search, first + search.length);
  if (second !== -1) {
    throw new Error(`Patch anchor is not unique: ${label}`);
  }

  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function insertAfterOnce(source, anchor, addition, label) {
  return replaceOnce(source, anchor, anchor + addition, label);
}

function patchBusinessRepository(source) {
  if (source.includes("function buildLocationsForSave(business = {})")) {
    return source;
  }

  const normalizeLocationEnd = `function normalizeLocation(input = {}, numericBusinessId) {
  return {
    business_id: numericBusinessId,
    location_name: input.locationName || input.businessName || input.name || null,
    address: input.address || null,
    city: input.city || null,
    state: input.state || null,
    postal_code: input.postalCode || input.zip || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    timezone: input.timezone || "America/Chicago",
    raw_json: toCleanRawJson(input, [
      "locationName", "address", "city", "state", "postalCode",
      "latitude", "longitude", "timezone"
    ])
  };
}
`;

  const locationHelpers = `
function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function getExplicitValue(object, keys, fallback) {
  for (const key of keys) {
    if (hasOwn(object, key) && object[key] !== undefined) {
      return object[key];
    }
  }

  return fallback;
}

function buildLocationsForSave(business = {}) {
  const suppliedLocations = Array.isArray(business.locations)
    ? business.locations.filter(
        (location) => location && typeof location === "object" && !Array.isArray(location)
      )
    : [];

  const primarySource = suppliedLocations[0] || cleanObject(business.location);

  const primaryLocation = {
    ...primarySource,
    locationName: getExplicitValue(
      business,
      ["locationName"],
      primarySource.locationName || business.businessName || business.name || null
    ),
    address: getExplicitValue(
      business,
      ["address"],
      primarySource.address || null
    ),
    city: getExplicitValue(
      business,
      ["city"],
      primarySource.city || null
    ),
    state: getExplicitValue(
      business,
      ["state"],
      primarySource.state || null
    ),
    postalCode: getExplicitValue(
      business,
      ["postalCode", "postal_code", "zip"],
      primarySource.postalCode || primarySource.postal_code || primarySource.zip || null
    ),
    latitude: getExplicitValue(
      business,
      ["latitude", "lat"],
      primarySource.latitude ?? null
    ),
    longitude: getExplicitValue(
      business,
      ["longitude", "lng", "lon"],
      primarySource.longitude ?? null
    ),
    timezone: getExplicitValue(
      business,
      ["timezone"],
      primarySource.timezone || "America/Chicago"
    )
  };

  return [primaryLocation, ...suppliedLocations.slice(1)];
}
`;

  let output = insertAfterOnce(
    source,
    normalizeLocationEnd,
    locationHelpers,
    "BusinessRepository location helper insertion"
  );

  const oldLocationSelection = `    const locations = Array.isArray(business.locations) && business.locations.length
      ? business.locations
      : [business];`;

  const newLocationSelection = `    const locations = buildLocationsForSave(business);`;

  output = replaceOnce(
    output,
    oldLocationSelection,
    newLocationSelection,
    "BusinessRepository saveBusinessFull location selection"
  );

  return output;
}

function patchBusinessManager(source) {
  if (!source.includes("function clearInventoryBusinessMetadataCache()")) {
    const cacheDeclarations = `let businessCache = null;
let businessCacheLoadedAt = null;
`;

    const helper = `
function clearInventoryBusinessMetadataCache() {
  try {
    const inventoryManager = require("./inventoryManager");

    if (typeof inventoryManager.clearBusinessMetadataCache === "function") {
      inventoryManager.clearBusinessMetadataCache();
    }
  } catch (_) {
    // inventoryManager may not be initialized yet during application startup.
  }
}
`;

    source = insertAfterOnce(
      source,
      cacheDeclarations,
      helper,
      "businessManager dependent-cache helper insertion"
    );
  }

  const oldSetCache = `function setBusinessCache(businesses = []) {
  businessCache = Array.isArray(businesses) ? businesses : [];
  businessCacheLoadedAt = new Date().toISOString();
  return businessCache;
}`;

  const newSetCache = `function setBusinessCache(businesses = []) {
  businessCache = Array.isArray(businesses) ? businesses : [];
  businessCacheLoadedAt = new Date().toISOString();
  clearInventoryBusinessMetadataCache();
  return businessCache;
}`;

  if (!source.includes("clearInventoryBusinessMetadataCache();\n  return businessCache;")) {
    source = replaceOnce(
      source,
      oldSetCache,
      newSetCache,
      "businessManager setBusinessCache invalidation"
    );
  }

  return source;
}

function patchInventoryManager(source) {
  if (!source.includes("function clearBusinessMetadataCache()")) {
    const cacheDeclarations = `let cachedBusinessMetadataMap = null;
let cachedBusinessMetadataAt = 0;
`;

    const clearFunction = `
function clearBusinessMetadataCache() {
  cachedBusinessMetadataMap = null;
  cachedBusinessMetadataAt = 0;
}
`;

    source = insertAfterOnce(
      source,
      cacheDeclarations,
      clearFunction,
      "inventoryManager cache-clear helper insertion"
    );
  }

  const oldMetadataDeclaration = `  const businessName = row.businessName || row.business_name || "";
  const metadata = getBusinessMetadata(businessName);
`;

  const newMetadataDeclaration = `  const businessName = row.businessName || row.business_name || "";
  const metadata = getBusinessMetadata(businessName);
  const hasBusinessMetadata = Boolean(metadata.businessName);
`;

  if (!source.includes("const hasBusinessMetadata = Boolean(metadata.businessName);")) {
    source = replaceOnce(
      source,
      oldMetadataDeclaration,
      newMetadataDeclaration,
      "inventoryManager metadata authority flag"
    );
  }

  const oldCoordinates = `  const latitude =
    toNumber(row.latitude) ??
    toNumber(row.businessLatitude) ??
    toNumber(row.business_latitude) ??
    metadata.latitude ??
    null;

  const longitude =
    toNumber(row.longitude) ??
    toNumber(row.businessLongitude) ??
    toNumber(row.business_longitude) ??
    metadata.longitude ??
    null;`;

  const newCoordinates = `  const latitude = hasBusinessMetadata
    ? metadata.latitude ?? null
    : toNumber(row.latitude) ??
      toNumber(row.businessLatitude) ??
      toNumber(row.business_latitude) ??
      null;

  const longitude = hasBusinessMetadata
    ? metadata.longitude ?? null
    : toNumber(row.longitude) ??
      toNumber(row.businessLongitude) ??
      toNumber(row.business_longitude) ??
      null;`;

  if (!source.includes("const latitude = hasBusinessMetadata")) {
    source = replaceOnce(
      source,
      oldCoordinates,
      newCoordinates,
      "inventoryManager current coordinate precedence"
    );
  }

  const oldBusinessFlags = `    enabled:
      row.enabled !== undefined && row.enabled !== null
        ? row.enabled !== false
        : metadata.enabled !== false,
    businessEnabled:
      row.businessEnabled !== undefined && row.businessEnabled !== null
        ? row.businessEnabled !== false
        : metadata.businessEnabled !== false,`;

  const newBusinessFlags = `    enabled: hasBusinessMetadata
      ? metadata.enabled !== false
      : row.enabled !== undefined && row.enabled !== null
        ? row.enabled !== false
        : true,
    businessEnabled: hasBusinessMetadata
      ? metadata.businessEnabled !== false
      : row.businessEnabled !== undefined && row.businessEnabled !== null
        ? row.businessEnabled !== false
        : true,`;

  if (!source.includes("enabled: hasBusinessMetadata")) {
    source = replaceOnce(
      source,
      oldBusinessFlags,
      newBusinessFlags,
      "inventoryManager current enabled-state precedence"
    );
  }

  const oldLocationAndLogo = `    latitude,
    longitude,
    address: row.address || row.businessAddress || row.business_address || metadata.address || "",
    logoUrl: row.logoUrl || row.logo_url || metadata.logoUrl || "",
    logoAlt:
      row.logoAlt ||
      row.logo_alt ||
      metadata.logoAlt ||
      \`${"${businessName || \"Business\"}"} logo\`,`;

  const newLocationAndLogo = `    latitude,
    longitude,
    address: hasBusinessMetadata
      ? metadata.address || ""
      : row.address || row.businessAddress || row.business_address || "",
    logoUrl: hasBusinessMetadata
      ? metadata.logoUrl || ""
      : row.logoUrl || row.logo_url || "",
    logoAlt: hasBusinessMetadata
      ? metadata.logoAlt || \`${"${businessName || \"Business\"}"} logo\`
      : row.logoAlt || row.logo_alt || \`${"${businessName || \"Business\"}"} logo\`,`;

  if (!source.includes("address: hasBusinessMetadata")) {
    source = replaceOnce(
      source,
      oldLocationAndLogo,
      newLocationAndLogo,
      "inventoryManager current address and logo precedence"
    );
  }

  const oldExportsTail = `  normalizeInventoryRow,
  normalizeFilters,
  getAppointmentIdentityKey
};`;

  const newExportsTail = `  normalizeInventoryRow,
  normalizeFilters,
  getAppointmentIdentityKey,
  clearBusinessMetadataCache
};`;

  if (!source.includes("getAppointmentIdentityKey,\n  clearBusinessMetadataCache")) {
    source = replaceOnce(
      source,
      oldExportsTail,
      newExportsTail,
      "inventoryManager cache-clear export"
    );
  }

  return source;
}

function patchPublicApp(source) {
  if (!source.includes("function getAppointmentMapCoordinates(appointment = {})")) {
    const renderFunctionAnchor = `function renderMapMarkers(appointments) {`;

    const helpers = `function parseMapCoordinate(value, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    return null;
  }

  return number;
}

function getAppointmentMapCoordinates(appointment = {}) {
  const latitude = parseMapCoordinate(appointment.latitude, -90, 90);
  const longitude = parseMapCoordinate(appointment.longitude, -180, 180);

  if (latitude === null || longitude === null) {
    return null;
  }

  if (latitude === 0 && longitude === 0) {
    return null;
  }

  return { latitude, longitude };
}

`;

    source = replaceOnce(
      source,
      renderFunctionAnchor,
      helpers + renderFunctionAnchor,
      "public app map-coordinate helper insertion"
    );
  }

  const oldBusinessMap = `    .map((group) => {
      const firstAppointment = group.appointments[0];

      return {
        businessName: firstAppointment.businessName || "Unknown Business",
        address: firstAppointment.address || "",
        bookingUrl: firstAppointment.bookingUrl || "#",
        logoUrl: firstAppointment.logoUrl || "",
        verificationStatus:
          firstAppointment.verificationStatus || "unclaimed",
        latitude: Number(firstAppointment.latitude),
        longitude: Number(firstAppointment.longitude),
        appointments: group.appointments
      };
    })
    .filter((business) => {
      return Number.isFinite(business.latitude) && Number.isFinite(business.longitude);
    });`;

  const newBusinessMap = `    .map((group) => {
      const firstAppointment = Array.isArray(group.appointments)
        ? group.appointments[0]
        : null;
      const coordinates = getAppointmentMapCoordinates(firstAppointment || {});

      if (!firstAppointment || !coordinates) {
        return null;
      }

      return {
        businessName: firstAppointment.businessName || "Unknown Business",
        address: firstAppointment.address || "",
        bookingUrl: firstAppointment.bookingUrl || "#",
        logoUrl: firstAppointment.logoUrl || "",
        verificationStatus:
          firstAppointment.verificationStatus || "unclaimed",
        ...coordinates,
        appointments: group.appointments
      };
    })
    .filter(Boolean);`;

  if (!source.includes("const coordinates = getAppointmentMapCoordinates(firstAppointment);")) {
    source = replaceOnce(
      source,
      oldBusinessMap,
      newBusinessMap,
      "public app safe map-marker coordinate mapping"
    );
  }

  return source;
}

const PATCHERS = {
  "database/BusinessRepository.js": patchBusinessRepository,
  "businessManager.js": patchBusinessManager,
  "inventoryManager.js": patchInventoryManager,
  "public/app.js": patchPublicApp
};

function assertRepositoryRoot() {
  const packagePath = path.join(ROOT, "package.json");
  if (!fs.existsSync(packagePath)) {
    throw new Error("Run this script from the repository root; package.json was not found.");
  }

  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (packageJson.name !== "massage-click-script") {
    throw new Error(
      `Unexpected package name ${JSON.stringify(packageJson.name)}. Expected massage-click-script.`
    );
  }
}

function syntaxCheck(relativePath, content) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextappt-location-fix-"));
  const tempPath = path.join(tempDir, path.basename(relativePath));

  try {
    fs.writeFileSync(tempPath, content, "utf8");
    execFileSync(process.execPath, ["--check", tempPath], {
      stdio: "pipe"
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function main() {
  assertRepositoryRoot();

  const staged = [];

  for (const [relativePath, patcher] of Object.entries(PATCHERS)) {
    const absolutePath = path.join(ROOT, relativePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Required file not found: ${relativePath}`);
    }

    const original = fs.readFileSync(absolutePath, "utf8");
    const currentSha = gitBlobSha(original);
    const expectedSha = EXPECTED_GIT_BLOB_SHAS[relativePath];

    if (currentSha !== expectedSha && !ALLOW_SHA_MISMATCH) {
      const appearsPatched =
        original.includes("function buildLocationsForSave(business = {})") ||
        original.includes("function clearInventoryBusinessMetadataCache()") ||
        original.includes("function clearBusinessMetadataCache()") ||
        original.includes("function getAppointmentMapCoordinates(appointment = {})");

      if (!appearsPatched) {
        throw new Error(
          `${relativePath} does not match the reviewed main-branch version.\n` +
          `Expected blob SHA: ${expectedSha}\n` +
          `Current blob SHA:  ${currentSha}\n` +
          `Review local changes first, then rerun with --allow-sha-mismatch only if the patch anchors still apply.`
        );
      }
    }

    const updated = patcher(original);

    if (updated !== original) {
      syntaxCheck(relativePath, updated);
    }

    staged.push({ relativePath, absolutePath, original, updated });
  }

  const changed = staged.filter((item) => item.original !== item.updated);

  if (!changed.length) {
    console.log("Location fixes are already applied. No files changed.");
    return;
  }

  console.log(`Validated ${changed.length} updated file(s):`);
  changed.forEach((item) => console.log(`  - ${item.relativePath}`));

  if (DRY_RUN) {
    console.log("Dry run complete. No files were written.");
    return;
  }

  const backupRoot = path.join(
    ROOT,
    ".nextappt-location-fix-backup",
    timestampForPath()
  );

  for (const item of changed) {
    const backupPath = path.join(backupRoot, item.relativePath);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, item.original, "utf8");
  }

  try {
    for (const item of changed) {
      const tempPath = `${item.absolutePath}.nextappt-location-fix.tmp`;
      fs.writeFileSync(tempPath, item.updated, "utf8");
      fs.renameSync(tempPath, item.absolutePath);
    }
  } catch (error) {
    for (const item of changed) {
      const backupPath = path.join(backupRoot, item.relativePath);
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, item.absolutePath);
      }
    }
    throw error;
  }

  fs.writeFileSync(
    path.join(backupRoot, "BACKUP_INFO.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        repositoryRoot: ROOT,
        files: changed.map((item) => item.relativePath)
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log("\nLocation fixes applied successfully.");
  console.log(`Backups: ${path.relative(ROOT, backupRoot)}`);
  console.log("\nReview with:");
  console.log(
    "git diff -- database/BusinessRepository.js businessManager.js inventoryManager.js public/app.js"
  );
  const verifierPath = path.relative(
    ROOT,
    path.join(__dirname, "verify-location-fixes.js")
  ) || "verify-location-fixes.js";

  console.log("\nThen run:");
  console.log(`node ${verifierPath}`);
}

try {
  main();
} catch (error) {
  console.error(`\nLocation fix failed: ${error.message}`);
  process.exitCode = 1;
}