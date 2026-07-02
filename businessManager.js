const fs = require("fs");
const path = require("path");

const {
  storagePath,
  readJson,
  writeJsonAtomic
} = require("./storagePaths");

const BUSINESSES_FILE = path.join(__dirname, "businesses.json");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value = "") {
  return String(value || "business")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 90) || "business";
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error("[BUSINESS MANAGER] Failed to read JSON:", error.message);
    return fallback;
  }
}

function loadBusinesses() {
  const businesses = readJsonFile(BUSINESSES_FILE, []);

  if (!Array.isArray(businesses)) {
    return [];
  }

  return businesses.map(normalizeBusiness);
}

function saveBusinesses(businesses = []) {
  fs.writeFileSync(BUSINESSES_FILE, JSON.stringify(businesses, null, 2));
}

function normalizeBusiness(business = {}) {
  const businessName =
    business.businessName ||
    business.name ||
    "Unknown Business";

  const businessSlug =
    business.businessSlug ||
    business.slug ||
    slugify(businessName);

  return {
    ...business,
    businessName,
    businessSlug,
    publicPageEnabled: business.publicPageEnabled !== false,
    verificationStatus:
      business.verificationStatus ||
      business.claimStatus ||
      "unclaimed",
    claimed: business.claimed === true,
    publicProfile: {
      shortDescription:
        business.publicProfile?.shortDescription ||
        business.shortDescription ||
        "",
      bio:
        business.publicProfile?.bio ||
        business.bio ||
        "",
      specialties:
        business.publicProfile?.specialties ||
        business.specialties ||
        [],
      amenities:
        business.publicProfile?.amenities ||
        business.amenities ||
        []
    },
    activeDeal: {
      enabled: business.activeDeal?.enabled === true,
      title: business.activeDeal?.title || "",
      body: business.activeDeal?.body || "",
      promoCode: business.activeDeal?.promoCode || "",
      expiresAt: business.activeDeal?.expiresAt || ""
    }
  };
}

function findBusinessByName(businessName = "") {
  const target = normalize(businessName);

  return (
    loadBusinesses().find((business) => {
      return normalize(business.businessName || business.name) === target;
    }) || null
  );
}

function findBusinessBySlug(slug = "") {
  const target = normalize(slug);

  return (
    loadBusinesses().find((business) => {
      return normalize(business.businessSlug || slugify(business.businessName)) === target;
    }) || null
  );
}

function findBusinessIndexBySlug(businesses = [], slug = "") {
  const target = normalize(slug);

  return businesses.findIndex((business) => {
    const businessSlug =
      business.businessSlug ||
      business.slug ||
      slugify(business.businessName || business.name);

    return normalize(businessSlug) === target;
  });
}

function isVerifiedBusiness(business = {}) {
  return (
    business.verificationStatus === "verified" ||
    business.claimStatus === "claimed_verified" ||
    business.status === "claimed_verified" ||
    business.claimed === true
  );
}

function getBusinessCardData(business = {}) {
  const normalized = normalizeBusiness(business);

  return {
    businessName: normalized.businessName,
    businessSlug: normalized.businessSlug,
    businessUrl: `/business/${normalized.businessSlug}`,
    address: normalized.address || "",
    latitude: normalized.latitude ?? null,
    longitude: normalized.longitude ?? null,
    logoUrl: normalized.logoUrl || "",
    logoAlt: normalized.logoAlt || `${normalized.businessName} logo`,
    verificationStatus: normalized.verificationStatus,
    claimed: normalized.claimed,
    isVerified: isVerifiedBusiness(normalized),
    activeDeal: getActiveDeal(normalized)
  };
}

function getBusinessPageData(slug = "") {
  const business = findBusinessBySlug(slug);

  if (!business || business.publicPageEnabled === false) {
    return null;
  }

  const verified = isVerifiedBusiness(business);

  return {
    ...getBusinessCardData(business),
    publicPageEnabled: business.publicPageEnabled !== false,
    isVerified: verified,
    publicProfile: verified
      ? business.publicProfile
      : {
          shortDescription: "",
          bio: "",
          specialties: [],
          amenities: []
        },
    activeDeal: verified ? getActiveDeal(business) : null,
    unverifiedMessage: verified
      ? ""
      : "This business has not claimed its NextAppt profile yet."
  };
}

function getActiveDeal(business = {}) {
  const deal = business.activeDeal || {};

  if (deal.enabled !== true) {
    return null;
  }

  if (deal.expiresAt) {
    const expiresAt = new Date(deal.expiresAt).getTime();

    if (!Number.isNaN(expiresAt) && expiresAt < Date.now()) {
      return null;
    }
  }

  return {
    enabled: true,
    title: deal.title || "",
    body: deal.body || "",
    promoCode: deal.promoCode || "",
    expiresAt: deal.expiresAt || ""
  };
}

function updateBusinessProfile(slug = "", profile = {}) {
  const businesses = readJsonFile(BUSINESSES_FILE, []);

  if (!Array.isArray(businesses)) {
    throw new Error("businesses.json must be an array.");
  }

  const index = findBusinessIndexBySlug(businesses, slug);

  if (index < 0) {
    throw new Error("Business not found.");
  }

  businesses[index] = normalizeBusiness({
    ...businesses[index],
    publicProfile: {
      ...(businesses[index].publicProfile || {}),
      shortDescription: String(profile.shortDescription || "").trim(),
      bio: String(profile.bio || "").trim(),
      specialties: Array.isArray(profile.specialties)
        ? profile.specialties
        : [],
      amenities: Array.isArray(profile.amenities)
        ? profile.amenities
        : []
    },
    updatedAt: new Date().toISOString()
  });

  saveBusinesses(businesses);

  return businesses[index];
}

function updateBusinessDeal(slug = "", deal = {}) {
  const businesses = readJsonFile(BUSINESSES_FILE, []);

  if (!Array.isArray(businesses)) {
    throw new Error("businesses.json must be an array.");
  }

  const index = findBusinessIndexBySlug(businesses, slug);

  if (index < 0) {
    throw new Error("Business not found.");
  }

  businesses[index] = normalizeBusiness({
    ...businesses[index],
    activeDeal: {
      enabled: deal.enabled === true,
      title: String(deal.title || "").trim(),
      body: String(deal.body || "").trim(),
      promoCode: String(deal.promoCode || "").trim(),
      expiresAt: String(deal.expiresAt || "").trim()
    },
    updatedAt: new Date().toISOString()
  });

  saveBusinesses(businesses);

  return businesses[index];
}

module.exports = {
  normalize,
  slugify,
  loadBusinesses,
  saveBusinesses,
  normalizeBusiness,
  findBusinessByName,
  findBusinessBySlug,
  isVerifiedBusiness,
  getBusinessCardData,
  getBusinessPageData,
  getActiveDeal,
  updateBusinessProfile,
  updateBusinessDeal
};