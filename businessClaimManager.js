const fs = require("fs");
const crypto = require("crypto");

const {
  storagePath,
  writeJsonAtomic
} = require("./storagePaths");

let businessManager = null;

try {
  businessManager = require("./businessManager");
} catch (error) {
  console.warn("[BUSINESS CLAIMS] businessManager unavailable:", error.message);
}

const SECURE_DIR = storagePath("secure");
const CLAIMS_FILE = storagePath("secure", "business-claims.json");

const VALID_CLAIM_STATUSES = [
  "claimed_pending",
  "claimed_verified",
  "claimed_rejected"
];

function ensureClaimsFileExists() {
  if (!fs.existsSync(SECURE_DIR)) {
    fs.mkdirSync(SECURE_DIR, { recursive: true });
  }

  if (!fs.existsSync(CLAIMS_FILE)) {
    fs.writeFileSync(CLAIMS_FILE, JSON.stringify([], null, 2));
  }
}

function loadClaims() {
  ensureClaimsFileExists();

  try {
    const raw = fs.readFileSync(CLAIMS_FILE, "utf8");
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[BUSINESS CLAIMS] Failed to load claims:", error.message);
    return [];
  }
}

function saveClaims(claims = []) {
  ensureClaimsFileExists();
  writeJsonAtomic(CLAIMS_FILE, claims);
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function createId(prefix = "claim") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function findClaimById(claimId) {
  const claims = loadClaims();
  return claims.find((claim) => claim.claimId === claimId) || null;
}

function findClaimByBusinessName(businessName) {
  const target = normalize(businessName);
  const claims = loadClaims();

  return (
    claims.find((claim) => normalize(claim.businessName) === target) || null
  );
}

function findActiveClaimByBusinessName(businessName) {
  const target = normalize(businessName);
  const claims = loadClaims();

  return (
    claims.find((claim) => {
      return (
        normalize(claim.businessName) === target &&
        ["claimed_pending", "claimed_verified"].includes(claim.status)
      );
    }) || null
  );
}

function createBusinessClaim(payload = {}) {
  const businessName = String(payload.businessName || "").trim();
  const ownerName = String(payload.ownerName || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const phone = String(payload.phone || "").trim();
  const website = String(payload.website || "").trim();
  const businessId = String(payload.businessId || "").trim();

  if (!businessName) {
    throw new Error("Business name is required.");
  }

  if (!ownerName) {
    throw new Error("Owner name is required.");
  }

  if (!email) {
    throw new Error("Email is required.");
  }

  const existingActiveClaim = findActiveClaimByBusinessName(businessName);

  if (existingActiveClaim) {
    throw new Error(
      `This business already has an active claim with status: ${existingActiveClaim.status}`
    );
  }

  const claims = loadClaims();

  const now = new Date().toISOString();

  const claim = {
    claimId: createId("claim"),
    businessId: businessId || slugify(businessName),
    businessName,
    ownerName,
    email,
    phone,
    website,
    status: "claimed_pending",
    requestedAt: now,
    updatedAt: now,
    verification: {
      emailVerified: false,
      manualReviewed: false,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: ""
    },
    apiProviders: Array.isArray(payload.apiProviders) ? payload.apiProviders : [],
    notes: String(payload.notes || "").trim()
  };

  claims.unshift(claim);
  saveClaims(claims);

  return claim;
}

async function persistClaimToBusiness(updatedClaim, options = {}) {
  if (!businessManager || typeof businessManager.saveBusiness !== "function") {
    return null;
  }

  const businessName = updatedClaim.businessName || "";
  if (!businessName) return null;

  let currentBusiness = null;

  if (typeof businessManager.getBusinessByName === "function") {
    currentBusiness = await businessManager.getBusinessByName(businessName, {
      includeDisabled: true,
      source: options.source
    }).catch(() => null);
  }

  if (!currentBusiness && typeof businessManager.getAllBusinesses === "function") {
    const businesses = await businessManager.getAllBusinesses({
      includeDisabled: true,
      source: options.source
    }).catch(() => []);

    currentBusiness = businesses.find((business) => {
      return normalize(business.businessName || business.name) === normalize(businessName);
    }) || null;
  }

  if (!currentBusiness) {
    return null;
  }

  const isVerified = updatedClaim.status === "claimed_verified";
  const isRejected = updatedClaim.status === "claimed_rejected";

  return businessManager.saveBusiness({
    ...currentBusiness,
    businessName: currentBusiness.businessName || businessName,
    businessId: currentBusiness.businessId || currentBusiness.id || updatedClaim.businessId || slugify(businessName),
    claimStatus: updatedClaim.status,
    verificationStatus: isVerified ? "verified" : isRejected ? "rejected" : "pending",
    claimed: isVerified,
    claimedByEmail: isVerified ? updatedClaim.email || currentBusiness.claimedByEmail || "" : "",
    claimId: updatedClaim.claimId,
    ownerEmail: isVerified ? updatedClaim.email || currentBusiness.ownerEmail || "" : currentBusiness.ownerEmail || "",
    phone: currentBusiness.phone || updatedClaim.phone || "",
    website: currentBusiness.website || updatedClaim.website || "",
    updatedAt: new Date().toISOString()
  }, {
    source: options.source
  });
}

function updateClaimStatus(claimId, status, options = {}) {
  if (!VALID_CLAIM_STATUSES.includes(status)) {
    throw new Error(`Invalid claim status: ${status}`);
  }

  const claims = loadClaims();
  const index = claims.findIndex((claim) => claim.claimId === claimId);

  if (index < 0) {
    throw new Error("Claim not found.");
  }

  const now = new Date().toISOString();

  const updatedClaim = {
    ...claims[index],
    status,
    updatedAt: now,
    verification: {
      ...(claims[index].verification || {}),
      manualReviewed: true
    }
  };

  if (status === "claimed_verified") {
    updatedClaim.verification.approvedBy = options.reviewedBy || "admin";
    updatedClaim.verification.approvedAt = now;
    updatedClaim.verification.rejectedBy = null;
    updatedClaim.verification.rejectedAt = null;
    updatedClaim.verification.rejectionReason = "";
  }

  if (status === "claimed_rejected") {
    updatedClaim.verification.rejectedBy = options.reviewedBy || "admin";
    updatedClaim.verification.rejectedAt = now;
    updatedClaim.verification.rejectionReason = options.reason || "";
    updatedClaim.verification.approvedBy = null;
    updatedClaim.verification.approvedAt = null;
  }

  claims[index] = updatedClaim;
  saveClaims(claims);

  persistClaimToBusiness(updatedClaim, options).catch((error) => {
    console.error("[BUSINESS CLAIMS] Failed to persist claim status to business:", error.message);
  });

  return updatedClaim;
}

function approveClaim(claimId, options = {}) {
  return updateClaimStatus(claimId, "claimed_verified", options);
}

function rejectClaim(claimId, options = {}) {
  return updateClaimStatus(claimId, "claimed_rejected", options);
}

function getPendingClaims() {
  return loadClaims().filter((claim) => claim.status === "claimed_pending");
}

function getVerifiedClaims() {
  return loadClaims().filter((claim) => claim.status === "claimed_verified");
}

function getRejectedClaims() {
  return loadClaims().filter((claim) => claim.status === "claimed_rejected");
}

function getClaimStats() {
  const claims = loadClaims();

  return {
    total: claims.length,
    pending: claims.filter((claim) => claim.status === "claimed_pending").length,
    verified: claims.filter((claim) => claim.status === "claimed_verified").length,
    rejected: claims.filter((claim) => claim.status === "claimed_rejected").length
  };
}

module.exports = {
  loadClaims,
  saveClaims,
  createBusinessClaim,
  updateClaimStatus,
  approveClaim,
  rejectClaim,
  findClaimById,
  findClaimByBusinessName,
  findActiveClaimByBusinessName,
  getPendingClaims,
  getVerifiedClaims,
  getRejectedClaims,
  getClaimStats,
  persistClaimToBusiness
};