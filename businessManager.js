const fs = require("fs");
const path = require("path");

let BusinessRepository = null;

try {
  BusinessRepository = require("./database/BusinessRepository");
} catch (error) {
  console.warn("[BUSINESS MANAGER] PostgreSQL repository unavailable:", error.message);
}

const BUSINESS_FILE = path.join(__dirname, "businesses.json");

function usePostgres(options = {}) {
  return (
    process.env.BUSINESS_SOURCE === "postgres" ||
    options.source === "postgres"
  );
}

function readJsonBusinesses() {
  if (!fs.existsSync(BUSINESS_FILE)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(BUSINESS_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[BUSINESS MANAGER] Failed to read businesses.json:", error.message);
    return [];
  }
}

function writeJsonBusinesses(businesses = []) {
  fs.writeFileSync(BUSINESS_FILE, JSON.stringify(businesses, null, 2));
  return businesses;
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
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
  if (usePostgres(options) && BusinessRepository?.getAllBusinesses) {
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

async function createBusiness(business = {}, options = {}) {
  if (usePostgres(options) && BusinessRepository?.createBusiness) {
    const row = await BusinessRepository.createBusiness(business);
    return toLegacyBusiness(row);
  }

  const businesses = readJsonBusinesses();
  businesses.push(business);
  writeJsonBusinesses(businesses);
  return business;
}

async function updateBusiness(idOrBusinessName, updates = {}, options = {}) {
  if (usePostgres(options) && BusinessRepository?.updateBusiness) {
    const row = await BusinessRepository.updateBusiness(idOrBusinessName, updates);
    return toLegacyBusiness(row);
  }

  const businesses = readJsonBusinesses();
  const target = normalize(idOrBusinessName);

  const index = businesses.findIndex((business) => {
    return (
      normalize(business.businessId || business.id) === target ||
      normalize(business.businessName || business.name) === target
    );
  });

  if (index < 0) {
    throw new Error("Business not found.");
  }

  businesses[index] = {
    ...businesses[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  writeJsonBusinesses(businesses);
  return businesses[index];
}

async function saveBusiness(business = {}, options = {}) {
  if (usePostgres(options) && BusinessRepository?.saveBusinessFull) {
    const row = await BusinessRepository.saveBusinessFull(business);
    return toLegacyBusiness(row);
  }

  const idOrName = business.businessId || business.id || business.businessName || business.name;

  try {
    return await updateBusiness(idOrName, business, options);
  } catch {
    return createBusiness(business, options);
  }
}

module.exports = {
  getAllBusinesses,
  getAllBusinessesSync,
  readJsonBusinesses,
  writeJsonBusinesses,
  toLegacyBusiness,

  createBusiness,
  updateBusiness,
  saveBusiness
};
