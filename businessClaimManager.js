const fs = require("fs");
const crypto = require("crypto");

const {
  storagePath,
  writeJsonAtomic
} = require("./storagePaths");

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
    businessId: businessId || normalize(businessName).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
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
  }

  claims[index] = updatedClaim;
  saveClaims(claims);

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
  getClaimStats
};