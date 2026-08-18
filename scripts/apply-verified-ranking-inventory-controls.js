#!/usr/bin/env node
"use strict";

/**
 * NextAppt verified-business ranking + public inventory controls upgrade.
 *
 * Run from the repository with:
 *   node scripts/apply-verified-ranking-inventory-controls.js
 *
 * What it changes:
 * - database/BusinessRepository.js
 * - businessManager.js
 * - inventoryManager.js
 * - rankingEngine.js
 * - public/admin.js
 * - public/app.js
 * - public/styles.css
 *
 * The database migration is separate:
 *   node runMigration.js 017_verified_business_ranking_inventory_controls.sql
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BACKUP_ROOT = path.join(
  ROOT,
  ".nextappt-verified-ranking-backup",
  new Date().toISOString().replace(/[:.]/g, "-")
);

const MARKER = "NEXTAPPT VERIFIED RANKING + INVENTORY CONTROLS V1";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function backup(rel, original) {
  const target = path.join(BACKUP_ROOT, rel);
  ensureDir(target);
  fs.writeFileSync(target, original);
}

function write(rel, content, original) {
  if (content === original) {
    console.log(`[SKIP] ${rel} already compatible / no changes needed.`);
    return false;
  }

  backup(rel, original);
  fs.writeFileSync(path.join(ROOT, rel), content);
  console.log(`[PATCHED] ${rel}`);
  return true;
}

function replaceRequired(text, search, replacement, label) {
  if (!text.includes(search)) {
    throw new Error(`Could not locate required patch target: ${label}`);
  }
  return text.replace(search, replacement);
}

function replaceRegexRequired(text, regex, replacement, label) {
  if (!regex.test(text)) {
    throw new Error(`Could not locate required regex patch target: ${label}`);
  }
  regex.lastIndex = 0;
  return text.replace(regex, replacement);
}

function patchBusinessRepository(original) {
  if (original.includes(`${MARKER}: BusinessRepository`)) return original;

  let text = original;

  text = replaceRequired(
    text,
    'function normalizeBusiness(input = {}) {',
    `// ${MARKER}: BusinessRepository
function clampAdminInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, safe));
}

function adminBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === false || value === 0) return false;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "off", "no"].includes(normalized)) return false;
  if (["true", "1", "on", "yes"].includes(normalized)) return true;
  return fallback;
}

function normalizeBusiness(input = {}) {`,
    "BusinessRepository helper insertion"
  );

  text = replaceRequired(
    text,
    `    enabled: input.enabled !== false,
    priority: input.priority || null,`,
    `    enabled: input.enabled !== false,
    verified_rank: clampAdminInteger(
      input.verifiedRank ?? input.verified_rank,
      0,
      0,
      100
    ),
    public_inventory_visible: adminBoolean(
      input.publicInventoryVisible ?? input.public_inventory_visible,
      true
    ),
    public_inventory_limit: clampAdminInteger(
      input.publicInventoryLimit ?? input.public_inventory_limit,
      4,
      1,
      20
    ),
    priority: input.priority || null,`,
    "BusinessRepository persisted business controls"
  );

  text = replaceRequired(
    text,
    `      "verificationStatus", "claimed", "claimedByEmail", "claimId",
      "enabled", "priority", "discoveryStatus", "adminNotes", "metro"`,
    `      "verificationStatus", "claimed", "claimedByEmail", "claimId",
      "enabled", "verifiedRank", "publicInventoryVisible", "publicInventoryLimit",
      "priority", "discoveryStatus", "adminNotes", "metro"`,
    "BusinessRepository raw_json allowlist"
  );

  return text;
}

function patchBusinessManager(original) {
  if (original.includes(`${MARKER}: businessManager`)) return original;

  let text = original;

  text = replaceRequired(
    text,
    `    enabled: business.enabled !== false,
    priority: business.priority || "",`,
    `    enabled: business.enabled !== false,

    // ${MARKER}: businessManager
    verifiedRank: Math.max(
      0,
      Math.min(
        100,
        Math.trunc(
          toNumberOrNull(
            pick(
              business.verifiedRank,
              business.verified_rank
            )
          ) ?? 0
        )
      )
    ),
    publicInventoryVisible: ![
      false,
      0,
      "false",
      "0",
      "off",
      "no"
    ].includes(
      typeof pick(
        business.publicInventoryVisible,
        business.public_inventory_visible
      ) === "string"
        ? String(
            pick(
              business.publicInventoryVisible,
              business.public_inventory_visible
            )
          ).trim().toLowerCase()
        : pick(
            business.publicInventoryVisible,
            business.public_inventory_visible
          )
    ),
    publicInventoryLimit: Math.max(
      1,
      Math.min(
        20,
        Math.trunc(
          toNumberOrNull(
            pick(
              business.publicInventoryLimit,
              business.public_inventory_limit
            )
          ) ?? 4
        )
      )
    ),

    priority: business.priority || "",`,
    "businessManager normalized public controls"
  );

  // Also expose the controls to business page consumers for consistency.
  text = replaceRequired(
    text,
    `    verificationStatus:
      isVerified
        ? "verified"
        : item.verificationStatus ||
          "unclaimed",
    claimedByEmail:
      item.claimedByEmail || "",`,
    `    verificationStatus:
      isVerified
        ? "verified"
        : item.verificationStatus ||
          "unclaimed",
    verifiedRank:
      item.verifiedRank || 0,
    publicInventoryVisible:
      item.publicInventoryVisible !== false,
    publicInventoryLimit:
      item.publicInventoryLimit || 4,
    claimedByEmail:
      item.claimedByEmail || "",`,
    "businessManager business-page controls"
  );

  return text;
}

function patchInventoryManager(original) {
  if (original.includes(`${MARKER}: inventoryManager`)) return original;

  let text = original;

  text = replaceRequired(
    text,
    `        enabled: business.enabled !== false,
        businessEnabled: business.enabled !== false,
        subscriptionPlan: business.subscriptionPlan || "",`,
    `        enabled: business.enabled !== false,
        businessEnabled: business.enabled !== false,

        // ${MARKER}: inventoryManager
        verifiedRank: Math.max(
          0,
          Math.min(100, Math.trunc(toNumber(business.verifiedRank) ?? 0))
        ),
        publicInventoryVisible: business.publicInventoryVisible !== false,
        publicInventoryLimit: Math.max(
          1,
          Math.min(20, Math.trunc(toNumber(business.publicInventoryLimit) ?? 4))
        ),

        subscriptionPlan: business.subscriptionPlan || "",`,
    "inventoryManager business metadata"
  );

  text = replaceRequired(
    text,
    `    businessEnabled: hasBusinessMetadata
      ? metadata.businessEnabled !== false
      : row.businessEnabled !== undefined && row.businessEnabled !== null
        ? row.businessEnabled !== false
        : true,

    latitude,`,
    `    businessEnabled: hasBusinessMetadata
      ? metadata.businessEnabled !== false
      : row.businessEnabled !== undefined && row.businessEnabled !== null
        ? row.businessEnabled !== false
        : true,

    verifiedRank: hasBusinessMetadata
      ? metadata.verifiedRank || 0
      : Math.max(
          0,
          Math.min(
            100,
            Math.trunc(
              toNumber(row.verifiedRank ?? row.verified_rank) ?? 0
            )
          )
        ),
    publicInventoryVisible: hasBusinessMetadata
      ? metadata.publicInventoryVisible !== false
      : ![
          false,
          0,
          "false",
          "0",
          "off",
          "no"
        ].includes(
          typeof (row.publicInventoryVisible ?? row.public_inventory_visible) === "string"
            ? String(row.publicInventoryVisible ?? row.public_inventory_visible)
                .trim()
                .toLowerCase()
            : (row.publicInventoryVisible ?? row.public_inventory_visible)
        ),
    publicInventoryLimit: hasBusinessMetadata
      ? metadata.publicInventoryLimit || 4
      : Math.max(
          1,
          Math.min(
            20,
            Math.trunc(
              toNumber(row.publicInventoryLimit ?? row.public_inventory_limit) ?? 4
            )
          )
        ),

    latitude,`,
    "inventoryManager normalized appointment controls"
  );

  text = replaceRequired(
    text,
    `    includeDisabledBusinesses:
      filters.includeDisabledBusinesses === true ||
      String(filters.includeDisabledBusinesses) === "true",
    includeInferred:`,
    `    includeDisabledBusinesses:
      filters.includeDisabledBusinesses === true ||
      String(filters.includeDisabledBusinesses) === "true",
    includeHiddenInventory:
      filters.includeHiddenInventory === true ||
      String(filters.includeHiddenInventory) === "true",
    includeInferred:`,
    "inventoryManager hidden-inventory filter option"
  );

  text = replaceRequired(
    text,
    `    if (!normalizedFilters.includeDisabledBusinesses && normalized.businessEnabled === false) {
      return false;
    }

    if (!normalizedFilters.includeInactive) {`,
    `    if (!normalizedFilters.includeDisabledBusinesses && normalized.businessEnabled === false) {
      return false;
    }

    if (
      !normalizedFilters.includeHiddenInventory &&
      normalized.publicInventoryVisible === false
    ) {
      return false;
    }

    if (!normalizedFilters.includeInactive) {`,
    "inventoryManager public visibility enforcement"
  );

  return text;
}

function patchRankingEngine(original) {
  if (original.includes(`${MARKER}: rankingEngine`)) return original;

  let text = original;

  text = replaceRequired(
    text,
    `const DEFAULT_TIME_ZONE = "America/Chicago";`,
    `const DEFAULT_TIME_ZONE = "America/Chicago";

// ${MARKER}: rankingEngine
const VERIFIED_BUSINESS_SCORE_BOOST = 40;`,
    "rankingEngine marker/constants"
  );

  text = replaceRequired(
    text,
    `function scoreBusinessPriority(appointment = {}) {`,
    `function isVerifiedBusiness(appointment = {}) {
  const status = normalize(
    appointment.verificationStatus ||
      appointment.verification_status ||
      ""
  );

  return (
    appointment.claimed === true ||
    status === "verified" ||
    status === "claimed verified"
  );
}

function getVerifiedRank(appointment = {}) {
  if (!isVerifiedBusiness(appointment)) return 0;

  const raw =
    appointment.verifiedRank ??
    appointment.verified_rank ??
    0;

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed)) return 0;

  return Math.max(0, Math.min(100, parsed));
}

function scoreVerifiedPlacement(appointment = {}) {
  const verified = isVerifiedBusiness(appointment);
  const verifiedRank = verified ? getVerifiedRank(appointment) : 0;

  return {
    verified,
    verifiedRank,
    score: verified ? VERIFIED_BUSINESS_SCORE_BOOST + verifiedRank : 0
  };
}

function scoreBusinessPriority(appointment = {}) {`,
    "rankingEngine verified ranking helpers"
  );

  text = replaceRequired(
    text,
    `  const freshnessMinutes = getFreshnessMinutes(appointment);

  const score =
    scoreSoonness(soonnessMinutes) +
    scoreDistance(distanceMiles) +
    scoreFreshness(freshnessMinutes) +
    scoreServiceRelevance(appointment, query) +
    scoreBusinessPriority(appointment);`,
    `  const freshnessMinutes = getFreshnessMinutes(appointment);
  const verifiedPlacement = scoreVerifiedPlacement(appointment);

  const score =
    scoreSoonness(soonnessMinutes) +
    scoreDistance(distanceMiles) +
    scoreFreshness(freshnessMinutes) +
    scoreServiceRelevance(appointment, query) +
    scoreBusinessPriority(appointment) +
    verifiedPlacement.score;`,
    "rankingEngine score integration"
  );

  text = replaceRequired(
    text,
    `      freshnessMinutes,
      serviceType: normalizeServiceType(`,
    `      freshnessMinutes,
      isVerifiedBusiness: verifiedPlacement.verified,
      verifiedRank: verifiedPlacement.verifiedRank,
      verifiedBusinessScore: verifiedPlacement.score,
      serviceType: normalizeServiceType(`,
    "rankingEngine ranking metadata"
  );

  text = replaceRequired(
    text,
    `    .sort((a, b) => {
      const scoreDiff = Number(b.ranking?.score || 0) - Number(a.ranking?.score || 0);
      if (scoreDiff !== 0) return scoreDiff;`,
    `    .sort((a, b) => {
      // Verified businesses are a public-search tier above unverified businesses.
      const verifiedDiff =
        Number(b.ranking?.isVerifiedBusiness === true) -
        Number(a.ranking?.isVerifiedBusiness === true);
      if (verifiedDiff !== 0) return verifiedDiff;

      // Admin rank controls ordering inside the verified tier.
      if (
        a.ranking?.isVerifiedBusiness === true &&
        b.ranking?.isVerifiedBusiness === true
      ) {
        const rankDiff =
          Number(b.ranking?.verifiedRank || 0) -
          Number(a.ranking?.verifiedRank || 0);
        if (rankDiff !== 0) return rankDiff;
      }

      const scoreDiff = Number(b.ranking?.score || 0) - Number(a.ranking?.score || 0);
      if (scoreDiff !== 0) return scoreDiff;`,
    "rankingEngine sort tier"
  );

  text = replaceRequired(
    text,
    `  getAppointmentDistanceMiles,
  getSoonnessMinutes
};`,
    `  getAppointmentDistanceMiles,
  getSoonnessMinutes,
  isVerifiedBusiness,
  getVerifiedRank
};`,
    "rankingEngine exports"
  );

  return text;
}

function patchAdminJs(original) {
  if (original.includes(`${MARKER}: admin.js`)) return original;

  let text = original;

  text = replaceRequired(
    text,
    `  if (!Array.isArray(normalized.services)) {`,
    `  // ${MARKER}: admin.js
  normalized.verifiedRank = Math.max(
    0,
    Math.min(100, Math.trunc(Number(normalized.verifiedRank ?? normalized.verified_rank ?? 0) || 0))
  );
  normalized.publicInventoryVisible =
    normalized.publicInventoryVisible !== false &&
    normalized.public_inventory_visible !== false;
  normalized.publicInventoryLimit = Math.max(
    1,
    Math.min(20, Math.trunc(Number(normalized.publicInventoryLimit ?? normalized.public_inventory_limit ?? 4) || 4))
  );

  if (!Array.isArray(normalized.services)) {`,
    "admin business defaults"
  );

  text = replaceRequired(
    text,
    `    enabled: true,
    priority: "normal",`,
    `    enabled: true,
    verifiedRank: 0,
    publicInventoryVisible: true,
    publicInventoryLimit: 4,
    priority: "normal",`,
    "admin blank business defaults"
  );

  text = replaceRequired(
    text,
    `          <div class="admin-field checkbox-wrap">
            <span>Status</span>
            ${renderCheckbox("Business enabled", "enabled", business.enabled !== false, index)}
          </div>
          ${renderTextarea("Admin Notes", "adminNotes", business.adminNotes, index)}`,
    `          <div class="admin-field checkbox-wrap">
            <span>Status</span>
            ${renderCheckbox("Business enabled", "enabled", business.enabled !== false, index)}
          </div>

          ${renderInput(
            "Verified Search Rank (0-100)",
            "verifiedRank",
            business.verifiedRank ?? 0,
            index,
            "number"
          )}

          <div class="admin-field checkbox-wrap">
            <span>Public Inventory</span>
            ${renderCheckbox(
              "Show this business inventory publicly",
              "publicInventoryVisible",
              business.publicInventoryVisible !== false,
              index
            )}
          </div>

          ${renderInput(
            "Visible Times on Search Card (1-20)",
            "publicInventoryLimit",
            business.publicInventoryLimit ?? 4,
            index,
            "number"
          )}

          <div class="admin-field admin-field-full">
            <span>Search placement note</span>
            <small class="admin-muted">
              Verified businesses rank above unverified businesses. Higher Verified Search Rank values move a verified business higher within the verified tier. Public Inventory can be hidden without deleting stored inventory.
            </small>
          </div>

          ${renderTextarea("Admin Notes", "adminNotes", business.adminNotes, index)}`,
    "admin business control fields"
  );

  text = replaceRequired(
    text,
    `      if (field === "latitude" || field === "longitude") {
        value = value === "" ? null : Number(value);
      }

      businessesCache[index][field] = value;`,
    `      if (field === "latitude" || field === "longitude") {
        value = value === "" ? null : Number(value);
      }

      if (field === "verifiedRank") {
        value = Math.max(
          0,
          Math.min(100, Math.trunc(Number(value) || 0))
        );
      }

      if (field === "publicInventoryLimit") {
        value = Math.max(
          1,
          Math.min(20, Math.trunc(Number(value) || 4))
        );
      }

      businessesCache[index][field] = value;`,
    "admin numeric control normalization"
  );

  return text;
}

function patchPublicApp(original) {
  if (original.includes(`${MARKER}: public/app.js`)) return original;

  let text = original;

  text = replaceRequired(
    text,
    `function mergeAppointments(existingAppointments, incomingAppointments) {`,
    `// ${MARKER}: public/app.js
function isVerifiedAppointment(appointment = {}) {
  const status = String(
    appointment.verificationStatus ||
      appointment.verification_status ||
      ""
  )
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  return (
    appointment.claimed === true ||
    status === "verified" ||
    status === "claimed verified"
  );
}

function getVerifiedRank(appointment = {}) {
  if (!isVerifiedAppointment(appointment)) return 0;

  const parsed = Number.parseInt(
    appointment.verifiedRank ??
      appointment.verified_rank ??
      0,
    10
  );

  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, parsed));
}

function getPublicInventoryLimit(appointment = {}) {
  const parsed = Number.parseInt(
    appointment.publicInventoryLimit ??
      appointment.public_inventory_limit ??
      4,
    10
  );

  if (!Number.isFinite(parsed)) return 4;
  return Math.max(1, Math.min(20, parsed));
}

function compareRankedAppointments(a = {}, b = {}) {
  const verifiedDiff =
    Number(isVerifiedAppointment(b)) -
    Number(isVerifiedAppointment(a));

  if (verifiedDiff !== 0) return verifiedDiff;

  if (
    isVerifiedAppointment(a) &&
    isVerifiedAppointment(b)
  ) {
    const rankDiff =
      getVerifiedRank(b) -
      getVerifiedRank(a);

    if (rankDiff !== 0) return rankDiff;
  }

  const aScore = Number(a.ranking?.score || 0);
  const bScore = Number(b.ranking?.score || 0);

  if (aScore !== bScore) return bScore - aScore;

  const aSort = Number(a.localSortable || 999999999999);
  const bSort = Number(b.localSortable || 999999999999);

  if (aSort !== bSort) return aSort - bSort;

  return String(a.businessName || "").localeCompare(
    String(b.businessName || "")
  );
}

function mergeAppointments(existingAppointments, incomingAppointments) {`,
    "public app ranking helpers"
  );

  text = replaceRegexRequired(
    text,
    /return \[\.\.\.mapByKey\.values\(\)\]\.sort\(\(a, b\) => \{[\s\S]*?\n  \}\);/,
    `return [...mapByKey.values()].sort(compareRankedAppointments);`,
    "public app merged appointment comparator"
  );

  text = replaceRequired(
    text,
    `          const serviceSummary = getServiceSummary(group.appointments);
          const topAppointments = group.appointments.slice(0, 4);`,
    `          const serviceSummary = getServiceSummary(group.appointments);
          const isVerifiedBusiness = isVerifiedAppointment(firstAppointment);
          const topAppointments = group.appointments.slice(
            0,
            getPublicInventoryLimit(firstAppointment)
          );`,
    "live search visible inventory limit"
  );

  text = replaceRequired(
    text,
    `<article class="live-result-card">`,
    `<article class="live-result-card ${isVerifiedBusiness ? "verified-business-card" : ""}">`,
    "live search verified outline class"
  );

  text = replaceRequired(
    text,
    `    const verificationStatus =
      firstAppointment.verificationStatus || "unclaimed";

    const isVerifiedBusiness = verificationStatus === "verified";`,
    `    const verificationStatus =
      firstAppointment.verificationStatus || "unclaimed";

    const isVerifiedBusiness = isVerifiedAppointment(firstAppointment);`,
    "main card verified detection"
  );

  text = replaceRequired(
    text,
    `    const nextAppointments = group.appointments.slice(0, 4);`,
    `    const nextAppointments = group.appointments.slice(
      0,
      getPublicInventoryLimit(firstAppointment)
    );`,
    "main card visible inventory limit"
  );

  text = replaceRequired(
    text,
    `    card.className = businessUrl
      ? "business-card clickable-business-card"
      : "business-card";`,
    `    card.className = [
      "business-card",
      businessUrl ? "clickable-business-card" : "",
      isVerifiedBusiness ? "verified-business-card" : ""
    ]
      .filter(Boolean)
      .join(" ");`,
    "main card verified outline class"
  );

  text = replaceRegexRequired(
    text,
    /const sortedAppointments = \[\.\.\.appointments\]\.sort\(\(a, b\) => \{[\s\S]*?\n  \}\);/,
    `const sortedAppointments = [...appointments].sort(compareRankedAppointments);`,
    "groupAppointmentsByBusiness comparator"
  );

  return text;
}

function patchStyles(original) {
  if (original.includes(`${MARKER}: styles`)) return original;

  let text = original;

  text = replaceRequired(
    text,
    `.business-card.verified-business-card {
  border: 2px solid #002b49;
  box-shadow: 0 18px 40px rgba(0, 43, 73, 0.18);
  background: linear-gradient(180deg, #ffffff 0%, #f4f9fc 100%);
}`,
    `/* ${MARKER}: styles
   Pure visual outline: no layout, background, typography, or content changes. */
.business-card.verified-business-card,
.live-result-card.verified-business-card {
  outline: 4px solid #002b49;
  outline-offset: -4px;
}`,
    "verified card 4px outline"
  );

  text = replaceRequired(
    text,
    `.business-card.verified-business-card .business-title-row h2 {
  color: #002b49;
  font-weight: 900;
}

`,
    ``,
    "remove prior verified-card typography override"
  );

  return text;
}

const patchers = [
  ["database/BusinessRepository.js", patchBusinessRepository],
  ["businessManager.js", patchBusinessManager],
  ["inventoryManager.js", patchInventoryManager],
  ["rankingEngine.js", patchRankingEngine],
  ["public/admin.js", patchAdminJs],
  ["public/app.js", patchPublicApp],
  ["public/styles.css", patchStyles]
];

function main() {
  console.log("Applying NextAppt verified ranking + inventory controls...");
  console.log(`Repository root: ${ROOT}`);

  // Transform everything first. If any expected current-code target is missing,
  // abort before touching the repository.
  const planned = patchers.map(([rel, patcher]) => {
    const original = read(rel);
    return { rel, original, patched: patcher(original) };
  });

  let changed = 0;
  for (const item of planned) {
    if (write(item.rel, item.patched, item.original)) changed += 1;
  }

  console.log("");
  console.log(`Done. ${changed} source file(s) changed.`);
  if (changed) {
    console.log(`Backups: ${BACKUP_ROOT}`);
  }
  console.log("");
  console.log("Next:");
  console.log("  node runMigration.js 017_verified_business_ranking_inventory_controls.sql");
  console.log("  node scripts/verify-verified-ranking-inventory-controls.js");
}

try {
  main();
} catch (error) {
  console.error("");
  console.error("Upgrade aborted:", error.message);
  console.error("No partial source-file writes occur before all patch targets validate.");
  process.exit(1);
}