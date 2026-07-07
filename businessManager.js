const fs = require("fs");
const path = require("path");

let BusinessRepository = null;

try {
  BusinessRepository = require("./database/BusinessRepository");
} catch (error) {
  console.warn("[BUSINESS MANAGER] PostgreSQL repository unavailable:", error.message);
}

function readJsonBusinesses() {
  const filePath = path.join(__dirname, "businesses.json");

  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[BUSINESS MANAGER] Failed to read businesses.json:", error.message);
    return [];
  }
}

function toLegacyBusiness(row = {}) {
  const raw = row.raw_json && typeof row.raw_json === "object" ? row.raw_json : {};

  return {
    ...raw,
    id: row.business_id || raw.id,
    businessId: row.business_id || raw.businessId,
    businessName: row.business_name || raw.businessName || raw.name,
    displayName: row.display_name || raw.displayName,
    businessCategory: row.business_category || raw.businessCategory || "wellness",
    platform: row.platform || raw.platform,
    bookingUrl: row.booking_url || raw.bookingUrl,
    website: row.website || raw.website,
    phone: row.phone || raw.phone,
    email: row.email || raw.email,
    ownerEmail: row.owner_email || raw.ownerEmail,
    verificationStatus: row.verification_status || raw.verificationStatus || "unclaimed",
    claimed: row.claimed === true || raw.claimed === true,
    claimedByEmail: row.claimed_by_email || raw.claimedByEmail,
    claimId: row.claim_id || raw.claimId,
    enabled: row.enabled !== false,
    priority: row.priority || raw.priority,
    discoveryStatus: row.discovery_status || raw.discoveryStatus
  };
}

async function getAllBusinesses(options = {}) {
  const usePostgres =
    process.env.BUSINESS_SOURCE === "postgres" ||
    options.source === "postgres";

  if (usePostgres && BusinessRepository?.getAllBusinesses) {
    try {
      const rows = await BusinessRepository.getAllBusinesses({
        includeDisabled: options.includeDisabled === true
      });

      return rows.map(toLegacyBusiness);
    } catch (error) {
      console.error("[BUSINESS MANAGER] PostgreSQL read failed, falling back to JSON:", error.message);
    }
  }

  return readJsonBusinesses();
}

function getAllBusinessesSync() {
  return readJsonBusinesses();
}

module.exports = {
  getAllBusinesses,
  getAllBusinessesSync,
  readJsonBusinesses,
  toLegacyBusiness
};
