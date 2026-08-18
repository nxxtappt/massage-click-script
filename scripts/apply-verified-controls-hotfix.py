#!/usr/bin/env python3
# NextAppt verified ranking + public inventory controls HOTFIX.
# Run from repository root:
#   python3 scripts/apply-verified-controls-hotfix.py

from pathlib import Path
from datetime import datetime
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
STAMP = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
BACKUP_ROOT = ROOT / ".nextappt-verified-controls-hotfix-backup" / STAMP
MARKER = "NEXTAPPT VERIFIED CONTROLS HOTFIX V2"

FILES = [
    "database/BusinessRepository.js",
    "adminRoutes.js",
    "businessManager.js",
    "inventoryManager.js",
    "rankingEngine.js",
    "public/admin.js",
    "public/app.js",
    "public/styles.css",
    "public/admin.css",
]


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f"Patch target not found: {label}")
    return text.replace(old, new, 1)


def append_once(text, block, marker):
    if marker in text:
        return text
    if not text.endswith("\n"):
        text += "\n"
    return text + "\n" + block.strip() + "\n"


def patch_business_repository(text):
    marker = f"{MARKER}: BusinessRepository"
    if marker in text:
        return text

    text = replace_once(
        text,
        "function normalizeBusiness(input = {}) {",
        f'''// {marker}
function clampVerifiedControlInteger(value, fallback, min, max) {{
  const parsed = Number.parseInt(value, 10);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, safe));
}}

function normalizeVerifiedControlBoolean(value, fallback = true) {{
  if (value === undefined || value === null || value === "") return fallback;
  if (value === false || value === 0) return false;

  const normalized = String(value).trim().toLowerCase();

  if (["false", "0", "off", "no"].includes(normalized)) return false;
  if (["true", "1", "on", "yes"].includes(normalized)) return true;

  return fallback;
}}

function normalizeBusiness(input = {{}}) {{''',
        "BusinessRepository helper insertion",
    )

    text = replace_once(
        text,
        '''    enabled: input.enabled !== false,
    priority: input.priority || null,''',
        '''    enabled: input.enabled !== false,
    verified_rank: clampVerifiedControlInteger(
      input.verifiedRank ?? input.verified_rank,
      0,
      0,
      100
    ),
    public_inventory_visible: normalizeVerifiedControlBoolean(
      input.publicInventoryVisible ?? input.public_inventory_visible,
      true
    ),
    public_inventory_limit: clampVerifiedControlInteger(
      input.publicInventoryLimit ?? input.public_inventory_limit,
      4,
      1,
      20
    ),
    priority: input.priority || null,''',
        "BusinessRepository persisted controls",
    )

    text = replace_once(
        text,
        '''      "verificationStatus", "claimed", "claimedByEmail", "claimId",
      "enabled", "priority", "discoveryStatus", "adminNotes", "metro"''',
        '''      "verificationStatus", "claimed", "claimedByEmail", "claimId",
      "enabled", "verifiedRank", "publicInventoryVisible", "publicInventoryLimit",
      "priority", "discoveryStatus", "adminNotes", "metro"''',
        "BusinessRepository raw_json controls",
    )

    return text


def patch_admin_routes(text):
    marker = f"{MARKER}: adminRoutes"
    if marker in text:
        return text

    text = replace_once(
        text,
        '''function cleanNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}''',
        f'''// {marker}
function cleanNumberOrNull(value) {{
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}}

function clampAdminInteger(value, fallback, min, max) {{
  const parsed = Number.parseInt(value, 10);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, safe));
}}

function cleanAdminBoolean(value, fallback = true) {{
  if (value === undefined || value === null || value === "") return fallback;
  if (value === false || value === 0) return false;

  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "off", "no"].includes(normalized)) return false;
  if (["true", "1", "on", "yes"].includes(normalized)) return true;

  return fallback;
}}''',
        "adminRoutes helpers",
    )

    text = replace_once(
        text,
        '''    enabled:
      business.enabled === false || business.enabled === "false"
        ? false
        : true,
    latitude: cleanNumberOrNull(business.latitude),''',
        '''    enabled:
      business.enabled === false || business.enabled === "false"
        ? false
        : true,
    verifiedRank: clampAdminInteger(
      business.verifiedRank ?? business.verified_rank,
      0,
      0,
      100
    ),
    publicInventoryVisible: cleanAdminBoolean(
      business.publicInventoryVisible ?? business.public_inventory_visible,
      true
    ),
    publicInventoryLimit: clampAdminInteger(
      business.publicInventoryLimit ?? business.public_inventory_limit,
      4,
      1,
      20
    ),
    latitude: cleanNumberOrNull(business.latitude),''',
        "adminRoutes business normalization",
    )

    return text


def patch_business_manager(text):
    marker = f"{MARKER}: businessManager"
    if marker in text:
        return text

    text = replace_once(
        text,
        '''    claimId: business.claimId || business.claim_id || "",
    enabled: business.enabled !== false,
    priority: business.priority || "",''',
        f'''    claimId: business.claimId || business.claim_id || "",
    enabled: business.enabled !== false,

    // {marker}
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

    priority: business.priority || "",''',
        "businessManager normalized controls",
    )

    return text


def patch_inventory_manager(text):
    marker = f"{MARKER}: inventoryManager"
    if marker in text:
        return text

    text = replace_once(
        text,
        '''        enabled: business.enabled !== false,
        businessEnabled: business.enabled !== false,
        subscriptionPlan: business.subscriptionPlan || "",''',
        f'''        enabled: business.enabled !== false,
        businessEnabled: business.enabled !== false,

        // {marker}
        verifiedRank: Math.max(
          0,
          Math.min(100, Math.trunc(toNumber(business.verifiedRank) ?? 0))
        ),
        publicInventoryVisible: business.publicInventoryVisible !== false,
        publicInventoryLimit: Math.max(
          1,
          Math.min(20, Math.trunc(toNumber(business.publicInventoryLimit) ?? 4))
        ),

        subscriptionPlan: business.subscriptionPlan || "",''',
        "inventoryManager business metadata controls",
    )

    text = replace_once(
        text,
        '''    businessEnabled: hasBusinessMetadata
      ? metadata.businessEnabled !== false
      : row.businessEnabled !== undefined && row.businessEnabled !== null
        ? row.businessEnabled !== false
        : true,

    latitude,''',
        '''    businessEnabled: hasBusinessMetadata
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

    latitude,''',
        "inventoryManager normalized appointment controls",
    )

    text = replace_once(
        text,
        '''    includeDisabledBusinesses:
      filters.includeDisabledBusinesses === true ||
      String(filters.includeDisabledBusinesses) === "true",
    includeInferred:''',
        '''    includeDisabledBusinesses:
      filters.includeDisabledBusinesses === true ||
      String(filters.includeDisabledBusinesses) === "true",
    includeHiddenInventory:
      filters.includeHiddenInventory === true ||
      String(filters.includeHiddenInventory) === "true",
    includeInferred:''',
        "inventoryManager hidden inventory option",
    )

    text = replace_once(
        text,
        '''    if (!normalizedFilters.includeDisabledBusinesses && normalized.businessEnabled === false) {
      return false;
    }

    if (!normalizedFilters.includeInactive) {''',
        '''    if (!normalizedFilters.includeDisabledBusinesses && normalized.businessEnabled === false) {
      return false;
    }

    if (
      !normalizedFilters.includeHiddenInventory &&
      normalized.publicInventoryVisible === false
    ) {
      return false;
    }

    if (!normalizedFilters.includeInactive) {''',
        "inventoryManager public visibility filter",
    )

    return text


def patch_ranking_engine(text):
    marker = f"{MARKER}: rankingEngine"
    if marker in text:
        return text

    text = replace_once(
        text,
        'const DEFAULT_TIME_ZONE = "America/Chicago";',
        f'''const DEFAULT_TIME_ZONE = "America/Chicago";

// {marker}''',
        "rankingEngine marker",
    )

    text = replace_once(
        text,
        "function scoreBusinessPriority(appointment = {}) {",
        '''function isVerifiedBusiness(appointment = {}) {
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

  const parsed = Number.parseInt(
    appointment.verifiedRank ??
      appointment.verified_rank ??
      0,
    10
  );

  if (!Number.isFinite(parsed)) return 0;

  return Math.max(0, Math.min(100, parsed));
}

function scoreBusinessPriority(appointment = {}) {''',
        "rankingEngine verified helper",
    )

    text = replace_once(
        text,
        '''    .sort((a, b) => {
      const scoreDiff = Number(b.ranking?.score || 0) - Number(a.ranking?.score || 0);
      if (scoreDiff !== 0) return scoreDiff;''',
        '''    .sort((a, b) => {
      const verifiedDiff =
        Number(isVerifiedBusiness(b)) -
        Number(isVerifiedBusiness(a));

      if (verifiedDiff !== 0) return verifiedDiff;

      if (isVerifiedBusiness(a) && isVerifiedBusiness(b)) {
        const rankDiff =
          getVerifiedRank(b) -
          getVerifiedRank(a);

        if (rankDiff !== 0) return rankDiff;
      }

      const scoreDiff = Number(b.ranking?.score || 0) - Number(a.ranking?.score || 0);
      if (scoreDiff !== 0) return scoreDiff;''',
        "rankingEngine verified tier sort",
    )

    text = replace_once(
        text,
        '''      freshnessMinutes,
      serviceType: normalizeServiceType(''',
        '''      freshnessMinutes,
      isVerifiedBusiness: isVerifiedBusiness(appointment),
      verifiedRank: getVerifiedRank(appointment),
      serviceType: normalizeServiceType(''',
        "rankingEngine ranking metadata",
    )

    text = replace_once(
        text,
        '''  getAppointmentDistanceMiles,
  getSoonnessMinutes
};''',
        '''  getAppointmentDistanceMiles,
  getSoonnessMinutes,
  isVerifiedBusiness,
  getVerifiedRank
};''',
        "rankingEngine exports",
    )

    return text


def patch_admin_js(text):
    marker = f"{MARKER}: public/admin.js"
    if marker in text:
        return text

    text = replace_once(
        text,
        '''  const normalized = {
    enabled: business.enabled !== false,
    adminNotes: business.adminNotes || "",
    ...business
  };

  if (!Array.isArray(normalized.services)) {''',
        f'''  const normalized = {{
    enabled: business.enabled !== false,
    adminNotes: business.adminNotes || "",
    ...business
  }};

  // {marker}
  normalized.verifiedRank = Math.max(
    0,
    Math.min(
      100,
      Math.trunc(
        Number(
          normalized.verifiedRank ??
          normalized.verified_rank ??
          0
        ) || 0
      )
    )
  );

  normalized.publicInventoryVisible =
    normalized.publicInventoryVisible !== false &&
    normalized.public_inventory_visible !== false;

  normalized.publicInventoryLimit = Math.max(
    1,
    Math.min(
      20,
      Math.trunc(
        Number(
          normalized.publicInventoryLimit ??
          normalized.public_inventory_limit ??
          4
        ) || 4
      )
    )
  );

  if (!Array.isArray(normalized.services)) {{''',
        "admin.js normalized business defaults",
    )

    text = replace_once(
        text,
        '''    integrationStatus: "active",
    enabled: true,
    priority: "normal",''',
        '''    integrationStatus: "active",
    enabled: true,
    verifiedRank: 0,
    publicInventoryVisible: true,
    publicInventoryLimit: 4,
    priority: "normal",''',
        "admin.js blank business controls",
    )

    text = replace_once(
        text,
        '''      </div>

      <details class="business-details">''',
        '''      </div>

      <section class="admin-search-inventory-controls">
        <div class="admin-search-inventory-controls-heading">
          <div>
            <strong>Search &amp; Inventory Controls</strong>
            <small>
              Verified rank only affects verified businesses. Inventory visibility does not delete stored appointments.
            </small>
          </div>
        </div>

        <div class="business-edit-grid admin-search-inventory-controls-grid">
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
              "Show appointments publicly",
              "publicInventoryVisible",
              business.publicInventoryVisible !== false,
              index
            )}
          </div>

          ${renderInput(
            "Visible Appointment Times (1-20)",
            "publicInventoryLimit",
            business.publicInventoryLimit ?? 4,
            index,
            "number"
          )}
        </div>
      </section>

      <details class="business-details">''',
        "admin.js always-visible search/inventory controls",
    )

    text = replace_once(
        text,
        '''      if (field === "latitude" || field === "longitude") {
        value = value === "" ? null : Number(value);
      }

      businessesCache[index][field] = value;''',
        '''      if (field === "latitude" || field === "longitude") {
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

      businessesCache[index][field] = value;''',
        "admin.js numeric control clamping",
    )

    return text


def patch_public_app(text):
    marker = f"{MARKER}: public/app.js"
    if marker in text:
        return text

    text = replace_once(
        text,
        "function mergeAppointments(existingAppointments, incomingAppointments) {",
        f'''// {marker}
function isVerifiedSearchBusiness(appointment = {{}}) {{
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
}}

function getVerifiedSearchRank(appointment = {{}}) {{
  if (!isVerifiedSearchBusiness(appointment)) return 0;

  const parsed = Number.parseInt(
    appointment.verifiedRank ??
      appointment.verified_rank ??
      0,
    10
  );

  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(100, parsed))
    : 0;
}}

function getPublicInventoryLimit(appointment = {{}}) {{
  const parsed = Number.parseInt(
    appointment.publicInventoryLimit ??
      appointment.public_inventory_limit ??
      4,
    10
  );

  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(20, parsed))
    : 4;
}}

function compareSearchAppointments(a = {{}}, b = {{}}) {{
  const verifiedDiff =
    Number(isVerifiedSearchBusiness(b)) -
    Number(isVerifiedSearchBusiness(a));

  if (verifiedDiff !== 0) return verifiedDiff;

  if (
    isVerifiedSearchBusiness(a) &&
    isVerifiedSearchBusiness(b)
  ) {{
    const rankDiff =
      getVerifiedSearchRank(b) -
      getVerifiedSearchRank(a);

    if (rankDiff !== 0) return rankDiff;
  }}

  const aScore = Number(a.ranking?.score || 0);
  const bScore = Number(b.ranking?.score || 0);

  if (aScore !== bScore) return bScore - aScore;

  const aSort = Number(a.localSortable || 999999999999);
  const bSort = Number(b.localSortable || 999999999999);

  if (aSort !== bSort) return aSort - bSort;

  return String(a.businessName || "").localeCompare(
    String(b.businessName || "")
  );
}}

function mergeAppointments(existingAppointments, incomingAppointments) {{''',
        "public app ranking helpers",
    )

    text = replace_once(
        text,
        '''  return [...mapByKey.values()].sort((a, b) => {
    const aScore = Number(a.ranking?.score || 0);
    const bScore = Number(b.ranking?.score || 0);

    if (aScore !== bScore) return bScore - aScore;

    const aSort = Number(a.localSortable || 999999999999);
    const bSort = Number(b.localSortable || 999999999999);

    if (aSort !== bSort) return aSort - bSort;

    return String(a.businessName || "").localeCompare(
      String(b.businessName || "")
    );
  });''',
        '''  return [...mapByKey.values()].sort(compareSearchAppointments);''',
        "public app merge comparator",
    )

    text = replace_once(
        text,
        '''          const serviceSummary = getServiceSummary(group.appointments);
          const topAppointments = group.appointments.slice(0, 4);''',
        '''          const serviceSummary = getServiceSummary(group.appointments);
          const topAppointments = group.appointments.slice(
            0,
            getPublicInventoryLimit(firstAppointment)
          );''',
        "public app live-result visible-time limit",
    )

    text = replace_once(
        text,
        '''    const verificationStatus =
      firstAppointment.verificationStatus || "unclaimed";

    const isVerifiedBusiness = verificationStatus === "verified";''',
        '''    const verificationStatus =
      firstAppointment.verificationStatus || "unclaimed";

    const isVerifiedBusiness =
      isVerifiedSearchBusiness(firstAppointment);''',
        "public app verified business detection",
    )

    text = replace_once(
        text,
        '''    const profile = firstAppointment.publicProfile || {};
    const nextAppointments = group.appointments.slice(0, 4);''',
        '''    const profile = firstAppointment.publicProfile || {};
    const nextAppointments = group.appointments.slice(
      0,
      getPublicInventoryLimit(firstAppointment)
    );''',
        "public app left-card visible-time limit",
    )

    text = replace_once(
        text,
        '''    const card = document.createElement("article");
    card.className = businessUrl
      ? "business-card clickable-business-card"
      : "business-card";''',
        '''    const card = document.createElement("article");
    card.className = [
      "business-card",
      businessUrl ? "clickable-business-card" : "",
      isVerifiedBusiness ? "verified-business-card" : ""
    ]
      .filter(Boolean)
      .join(" ");''',
        "public app left-card verified class",
    )

    text = replace_once(
        text,
        '''  const sortedAppointments = [...appointments].sort((a, b) => {
    const aScore = Number(a.ranking?.score || 0);
    const bScore = Number(b.ranking?.score || 0);

    if (aScore !== bScore) return bScore - aScore;

    const aSort = Number(a.localSortable || 999999999999);
    const bSort = Number(b.localSortable || 999999999999);

    if (aSort !== bSort) return aSort - bSort;

    return String(a.businessName || "").localeCompare(
      String(b.businessName || "")
    );
  });''',
        '''  const sortedAppointments =
    [...appointments].sort(compareSearchAppointments);''',
        "public app group comparator",
    )

    return text


def patch_styles(text):
    marker = f"{MARKER}: public/styles.css"
    if marker in text:
        return text

    text = replace_once(
        text,
        '''.business-card.verified-business-card {
  border: 2px solid #002b49;
  box-shadow: 0 18px 40px rgba(0, 43, 73, 0.18);
  background: linear-gradient(180deg, #ffffff 0%, #f4f9fc 100%);
}''',
        f'''/* {marker}
   Only the LEFT-SIDE LIST CARD changes. Map-pin styles below are intentionally untouched. */
.business-card.verified-business-card {{
  outline: 4px solid #002b49;
  outline-offset: -4px;
}}''',
        "public styles verified left-card outline",
    )

    text = replace_once(
        text,
        '''.business-card.verified-business-card .business-title-row h2 {
  color: #002b49;
  font-weight: 900;
}

''',
        "",
        "public styles remove old verified title override",
    )

    return text


def patch_admin_css(text):
    marker = f"{MARKER}: public/admin.css"
    block = f'''
/* {marker} */
.admin-search-inventory-controls {{
  margin: 14px 0;
  padding: 14px;
  border: 2px solid #d6e5ef;
  border-radius: 14px;
  background: #f8fbfd;
}}

.admin-search-inventory-controls-heading {{
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}}

.admin-search-inventory-controls-heading strong {{
  display: block;
  color: #002b49;
  font-size: 15px;
}}

.admin-search-inventory-controls-heading small {{
  display: block;
  margin-top: 4px;
  color: #64748b;
  line-height: 1.35;
}}

.admin-search-inventory-controls-grid {{
  margin-top: 0;
}}
'''
    return append_once(text, block, marker)


PATCHERS = {
    "database/BusinessRepository.js": patch_business_repository,
    "adminRoutes.js": patch_admin_routes,
    "businessManager.js": patch_business_manager,
    "inventoryManager.js": patch_inventory_manager,
    "rankingEngine.js": patch_ranking_engine,
    "public/admin.js": patch_admin_js,
    "public/app.js": patch_public_app,
    "public/styles.css": patch_styles,
    "public/admin.css": patch_admin_css,
}


def main():
    missing = [rel for rel in FILES if not (ROOT / rel).exists()]
    if missing:
        raise RuntimeError("Missing repository files: " + ", ".join(missing))

    originals = {rel: read(rel) for rel in FILES}
    patched = {}

    # Validate/transform every file in memory first. No partial writes.
    for rel in FILES:
        patched[rel] = PATCHERS[rel](originals[rel])

    changes = [rel for rel in FILES if patched[rel] != originals[rel]]

    if not changes:
        print("Hotfix already applied; no source changes required.")
        return

    for rel in changes:
        backup = BACKUP_ROOT / rel
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, backup)

    for rel in changes:
        (ROOT / rel).write_text(patched[rel], encoding="utf-8")
        print(f"[PATCHED] {rel}")

    print()
    print(f"Patched {len(changes)} file(s).")
    print(f"Backups: {BACKUP_ROOT}")
    print()
    print("Next run:")
    print("  node scripts/verify-verified-controls-hotfix.js")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"HOTFIX ABORTED: {exc}", file=sys.stderr)
        print("No application source files were written unless all patch targets validated.", file=sys.stderr)
        sys.exit(1)