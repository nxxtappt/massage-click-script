const fs = require("fs");
const path = require("path");

let BusinessRepository = null;

try {
  BusinessRepository = require("./database/BusinessRepository");
} catch (error) {
  console.warn("[BUSINESS MANAGER] PostgreSQL repository unavailable:", error.message);
}

let loadBusinessSubscriptions = null;

try {
  ({ loadBusinessSubscriptions } = require("./businessSubscriptionManager"));
} catch (error) {
  loadBusinessSubscriptions = null;
}

const BUSINESS_FILE = path.join(__dirname, "businesses.json");

let businessCache = null;
let businessCacheLoadedAt = null;

function usePostgres(options = {}) {
  if (options.source === "json") return false;
  if (options.source === "postgres") return true;
  if (process.env.BUSINESS_SOURCE === "json") return false;
  if (process.env.BUSINESS_SOURCE === "postgres") return true;
  return Boolean(BusinessRepository && (process.env.DATABASE_URL || process.env.POSTGRES_URL));
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(value = "") {
  return String(value || "business")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 90) || "business";
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function setBusinessCache(businesses = []) {
  businessCache = Array.isArray(businesses) ? businesses : [];
  businessCacheLoadedAt = new Date().toISOString();
  return businessCache;
}

function writeJsonBusinesses(businesses = []) {
  fs.writeFileSync(BUSINESS_FILE, JSON.stringify(businesses, null, 2));
  setBusinessCache(businesses);
  return businesses;
}

function getCachedBusinesses() {
  if (Array.isArray(businessCache)) return businessCache;
  return setBusinessCache(readJsonBusinesses().map(normalizeBusinessShape));
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function getSubscriptionKey(businessName = "") {
  return String(businessName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getSubscriptionForBusiness(businessName = "") {
  if (typeof loadBusinessSubscriptions !== "function") return null;

  try {
    const subscriptions = loadBusinessSubscriptions() || {};
    return subscriptions[getSubscriptionKey(businessName)] || null;
  } catch (error) {
    console.warn("[BUSINESS MANAGER] Failed to load subscription data:", error.message);
    return null;
  }
}

function mergeSubscriptionData(business = {}) {
  const businessName = business.businessName || business.business_name || business.name || "";
  const subscription = getSubscriptionForBusiness(businessName);

  if (!subscription) return business;

  const subscriptionProfile = subscription.businessProfile || {};
  const subscriptionDeal = subscription.cardPromotion || {};
  const subscriptionWidget = subscription.bookingWidget || {};

  const publicProfile = {
    ...(business.publicProfile || {}),
    shortDescription:
      (business.publicProfile && business.publicProfile.shortDescription) ||
      business.shortDescription ||
      subscriptionProfile.shortDescription ||
      "",
    bio:
      (business.publicProfile && business.publicProfile.bio) ||
      business.bio ||
      subscriptionProfile.bio ||
      "",
    websiteUrl:
      (business.publicProfile && business.publicProfile.websiteUrl) ||
      subscriptionProfile.websiteUrl ||
      business.website ||
      ""
  };

  const activeDeal = {
    ...(business.activeDeal || {}),
    ...(subscriptionDeal || {})
  };

  const bookingIntegration = {
    ...(business.bookingIntegration || {}),
    ...(subscriptionWidget || {})
  };

  return {
    ...business,
    subscriptionPlan: subscription.plan || business.subscriptionPlan || "",
    subscriptionStatus: subscription.subscriptionStatus || business.subscriptionStatus || "",
    publicProfile,
    activeDeal,
    bookingIntegration
  };
}

function normalizeBusinessShape(business = {}) {
  business = mergeSubscriptionData(business || {});

  const businessName = business.businessName || business.business_name || business.name || business.displayName || business.display_name || "";
  const businessId = business.businessId || business.business_id || business.id || slugify(businessName);
  const businessSlug = business.businessSlug || business.business_slug || business.slug || slugify(businessName);
  const latitude = toNumberOrNull(pick(business.latitude, business.lat, business.location?.latitude));
  const longitude = toNumberOrNull(pick(business.longitude, business.lng, business.lon, business.location?.longitude));

  return {
    ...business,
    id: businessId,
    businessId,
    business_id: business.business_id || businessId,
    businessName,
    name: business.name || businessName,
    displayName: business.displayName || business.display_name || businessName,
    businessSlug,
    slug: business.slug || businessSlug,
    businessUrl: business.businessUrl || business.business_url || `/business/${businessSlug}`,
    businessCategory: business.businessCategory || business.business_category || "wellness",
    platform: business.platform || "",
    bookingUrl: business.bookingUrl || business.booking_url || "",
    website: business.website || business.businessWebsite || "",
    phone: business.phone || business.businessPhone || "",
    email: business.email || "",
    ownerEmail: business.ownerEmail || business.owner_email || "",
    address: business.address || business.location?.address || "",
    latitude,
    longitude,
    logoUrl: business.logoUrl || business.logo_url || "",
    logoAlt: business.logoAlt || business.logo_alt || (businessName ? `${businessName} logo` : ""),
    verificationStatus: business.verificationStatus || business.verification_status || business.claimStatus || "unclaimed",
    claimed: business.claimed === true || business.verificationStatus === "verified" || business.verification_status === "verified",
    claimedByEmail: business.claimedByEmail || business.claimed_by_email || "",
    claimId: business.claimId || business.claim_id || "",
    enabled: business.enabled !== false,
    priority: business.priority || "",
    discoveryStatus: business.discoveryStatus || business.discovery_status || "",
    publicProfile: business.publicProfile && typeof business.publicProfile === "object" ? business.publicProfile : {},
    activeDeal: business.activeDeal && typeof business.activeDeal === "object" ? business.activeDeal : {},
    bookingIntegration: business.bookingIntegration && typeof business.bookingIntegration === "object" ? business.bookingIntegration : {},
    services: Array.isArray(business.services) ? business.services : [],
    searchAliases: Array.isArray(business.searchAliases) ? business.searchAliases : [],
    amenities: Array.isArray(business.amenities) ? business.amenities : [],
    specialties: Array.isArray(business.specialties) ? business.specialties : [],
    updatedAt: business.updatedAt || business.updated_at || ""
  };
}

function toLegacyBusiness(row = {}) {
  const raw = row.raw_json && typeof row.raw_json === "object" ? row.raw_json : {};
  return normalizeBusinessShape({
    ...raw,
    id: row.business_id || raw.id || raw.businessId,
    businessId: row.business_id || raw.businessId || raw.id,
    businessName: row.business_name || raw.businessName || raw.name,
    displayName: row.display_name || raw.displayName,
    businessCategory: row.business_category || raw.businessCategory || "wellness",
    platform: row.platform || raw.platform,
    bookingUrl: row.booking_url || raw.bookingUrl,
    website: row.website || raw.website,
    phone: row.phone || raw.phone,
    email: row.email || raw.email,
    ownerEmail: row.owner_email || raw.ownerEmail,
    address: row.address || raw.address,
    latitude: pick(row.latitude, raw.latitude),
    longitude: pick(row.longitude, raw.longitude),
    logoUrl: row.logo_url || raw.logoUrl,
    logoAlt: row.logo_alt || raw.logoAlt,
    verificationStatus: row.verification_status || raw.verificationStatus || "unclaimed",
    claimed: row.claimed === true || raw.claimed === true || row.verification_status === "verified" || raw.verificationStatus === "verified",
    claimedByEmail: row.claimed_by_email || raw.claimedByEmail,
    claimId: row.claim_id || raw.claimId,
    enabled: row.enabled !== false && raw.enabled !== false,
    priority: row.priority || raw.priority,
    discoveryStatus: row.discovery_status || raw.discoveryStatus,
    businessSlug: row.business_slug || raw.businessSlug || raw.slug,
    businessUrl: row.business_url || raw.businessUrl,
    publicProfile: raw.publicProfile || {},
    activeDeal: raw.activeDeal || {},
    bookingIntegration: raw.bookingIntegration || {},
    services: raw.services || [],
    searchAliases: raw.searchAliases || [],
    amenities: raw.amenities || [],
    specialties: raw.specialties || []
  });
}

function findBusinessInList(idOrBusinessName, businesses = []) {
  const target = normalize(idOrBusinessName);
  if (!target) return null;

  return businesses.find((business) => {
    const item = normalizeBusinessShape(business);
    return normalize(item.businessId) === target || normalize(item.id) === target || normalize(item.businessName) === target || normalize(item.name) === target || normalize(item.businessSlug) === target || normalize(item.slug) === target;
  }) || null;
}

function matchesSlugOrName(business = {}, slugOrName = "") {
  const item = normalizeBusinessShape(business);
  const target = normalize(slugOrName);
  const slugTarget = target.replace(/\s+/g, "-");
  return normalize(item.businessSlug) === target || normalize(item.slug) === target || normalize(item.businessId) === target || normalize(item.id) === target || normalize(item.businessName) === target || slugify(item.businessName) === slugTarget;
}

async function getAllBusinesses(options = {}) {
  if (usePostgres(options) && BusinessRepository?.getAllBusinesses) {
    try {
      const rows = await BusinessRepository.getAllBusinesses({ includeDisabled: options.includeDisabled === true });
      return setBusinessCache(rows.map(toLegacyBusiness));
    } catch (error) {
      console.error("[BUSINESS MANAGER] PostgreSQL read failed, falling back to JSON:", error.message);
    }
  }
  return setBusinessCache(readJsonBusinesses().map(normalizeBusinessShape));
}

function getAllBusinessesSync(options = {}) {
  const cached = getCachedBusinesses();
  return options.includeDisabled === true ? cached : cached.filter((business) => business.enabled !== false);
}

async function getBusinessByName(businessName, options = {}) {
  if (!businessName) return null;

  if (usePostgres(options) && BusinessRepository?.getBusinessByName) {
    try {
      const row = await BusinessRepository.getBusinessByName(businessName);
      if (row) return toLegacyBusiness(row);
    } catch (error) {
      console.error("[BUSINESS MANAGER] PostgreSQL getBusinessByName failed:", error.message);
    }
  }

  return findBusinessInList(businessName, await getAllBusinesses({ ...options, includeDisabled: true }));
}

async function getBusinessBySlug(slugOrName, options = {}) {
  const businesses = await getAllBusinesses({ ...options, includeDisabled: true });
  return businesses.find((business) => matchesSlugOrName(business, slugOrName)) || null;
}

function getBusinessBySlugSync(slugOrName) {
  return getCachedBusinesses().find((business) => matchesSlugOrName(business, slugOrName)) || null;
}

async function createBusiness(business = {}, options = {}) {
  const normalizedBusiness = normalizeBusinessShape(business);

  if (usePostgres(options) && BusinessRepository?.createBusiness) {
    const row = await BusinessRepository.createBusiness(normalizedBusiness);
    const saved = toLegacyBusiness(row);
    await getAllBusinesses({ source: "postgres", includeDisabled: true }).catch(() => null);
    return saved;
  }

  const businesses = readJsonBusinesses();
  businesses.push(normalizedBusiness);
  writeJsonBusinesses(businesses);
  return normalizedBusiness;
}

async function updateBusiness(idOrBusinessName, updates = {}, options = {}) {
  const existing = await getBusinessByName(idOrBusinessName, { ...options, includeDisabled: true }) || findBusinessInList(idOrBusinessName, getCachedBusinesses()) || {};
  const merged = normalizeBusinessShape({
    ...existing,
    ...updates,
    publicProfile: { ...(existing.publicProfile || {}), ...(updates.publicProfile || {}) },
    activeDeal: { ...(existing.activeDeal || {}), ...(updates.activeDeal || {}) },
    bookingIntegration: { ...(existing.bookingIntegration || {}), ...(updates.bookingIntegration || {}) },
    updatedAt: new Date().toISOString()
  });

  if (usePostgres(options)) {
    if (BusinessRepository?.saveBusinessFull) {
      const row = await BusinessRepository.saveBusinessFull(merged);
      const saved = toLegacyBusiness(row);
      await getAllBusinesses({ source: "postgres", includeDisabled: true }).catch(() => null);
      return saved;
    }

    if (BusinessRepository?.updateBusiness) {
      const row = await BusinessRepository.updateBusiness(idOrBusinessName, merged);
      const saved = toLegacyBusiness(row);
      await getAllBusinesses({ source: "postgres", includeDisabled: true }).catch(() => null);
      return saved;
    }
  }

  const businesses = readJsonBusinesses();
  const target = normalize(idOrBusinessName);
  const index = businesses.findIndex((business) => {
    const item = normalizeBusinessShape(business);
    return normalize(item.businessId) === target || normalize(item.id) === target || normalize(item.businessName) === target || normalize(item.name) === target || normalize(item.businessSlug) === target;
  });

  if (index < 0) throw new Error("Business not found.");

  businesses[index] = merged;
  writeJsonBusinesses(businesses);
  return merged;
}

async function saveBusiness(business = {}, options = {}) {
  const normalizedBusiness = normalizeBusinessShape(business);
  const idOrName = normalizedBusiness.businessId || normalizedBusiness.id || normalizedBusiness.businessName || normalizedBusiness.name;

  const existing =
    findBusinessInList(idOrName, await getAllBusinesses({ ...options, includeDisabled: true })) ||
    findBusinessInList(normalizedBusiness.businessName, await getAllBusinesses({ ...options, includeDisabled: true }));

  return existing
    ? updateBusiness(existing.businessId || existing.id || existing.businessName, normalizedBusiness, options)
    : createBusiness(normalizedBusiness, options);
}

function buildBusinessPageData(business = {}) {
  if (!business) return null;
  const item = normalizeBusinessShape(business);
  const businessName = item.businessName || item.name || "Business";

  const isVerified =
    item.claimed === true ||
    item.verificationStatus === "verified" ||
    item.verificationStatus === "claimed_verified";

  const publicProfile = {
    ...(item.publicProfile || {}),
    specialties:
      (item.publicProfile && Array.isArray(item.publicProfile.specialties)
        ? item.publicProfile.specialties
        : item.specialties) || [],
    amenities:
      (item.publicProfile && Array.isArray(item.publicProfile.amenities)
        ? item.publicProfile.amenities
        : item.amenities) || []
  };

  return {
    businessId: item.businessId,
    businessName,
    name: businessName,
    displayName: item.displayName || businessName,
    businessSlug: item.businessSlug,
    slug: item.businessSlug,
    businessUrl: item.businessUrl || `/business/${item.businessSlug}`,
    businessCategory: item.businessCategory || "wellness",
    platform: item.platform || "",
    bookingUrl: item.bookingUrl || "",
    website: item.website || "",
    phone: item.phone || "",
    email: item.email || "",
    address: item.address || "",
    latitude: item.latitude,
    longitude: item.longitude,
    logoUrl: item.logoUrl || "",
    logoAlt: item.logoAlt || `${businessName} logo`,
    claimed: isVerified,
    isVerified,
    verificationStatus: isVerified ? "verified" : item.verificationStatus || "unclaimed",
    claimedByEmail: item.claimedByEmail || "",
    claimId: item.claimId || "",
    publicProfile,
    activeDeal: item.activeDeal && item.activeDeal.enabled === false ? null : item.activeDeal || {},
    bookingIntegration: item.bookingIntegration || {},
    services: Array.isArray(item.services) ? item.services : [],
    amenities: Array.isArray(item.amenities) ? item.amenities : [],
    specialties: Array.isArray(item.specialties) ? item.specialties : []
  };
}

function getBusinessPageData(slugOrName) {
  return buildBusinessPageData(getBusinessBySlugSync(slugOrName));
}

async function getBusinessPageDataAsync(slugOrName, options = {}) {
  return buildBusinessPageData(await getBusinessBySlug(slugOrName, options));
}

function getCacheInfo() {
  return {
    loaded: Array.isArray(businessCache),
    count: Array.isArray(businessCache) ? businessCache.length : 0,
    loadedAt: businessCacheLoadedAt
  };
}

module.exports = {
  getAllBusinesses,
  getAllBusinessesSync,
  readJsonBusinesses,
  writeJsonBusinesses,
  toLegacyBusiness,
  getBusinessByName,
  getBusinessBySlug,
  getBusinessBySlugSync,
  createBusiness,
  updateBusiness,
  saveBusiness,
  getBusinessPageData,
  getBusinessPageDataAsync,
  buildBusinessPageData,
  normalizeBusinessShape,
  slugify,
  getCacheInfo
};