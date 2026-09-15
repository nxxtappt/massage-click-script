const express = require("express");

const {
  createBusinessClaim,
  approveClaim,
  rejectClaim,
  getPendingClaims,
  loadClaims,
  getClaimStats,
  findClaimById
} = require("./businessClaimManager");

const businessManager = require("./businessManager");

const router = express.Router();

// This legacy endpoint wrote credentials to a local file and trusted caller-supplied
// business names. It must stay unavailable even if an old dashboard is cached.
router.use("/credentials", (req, res) => {
  res.status(410).json({
    success: false,
    error: "The legacy credential endpoint is closed. Sign in to the business dashboard to connect a CRM."
  });
});

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function safeBusinessPublicView(business = {}) {
  return {
    businessName: business.businessName || business.name || "",
    platform: business.platform || "",
    apiProvider: business.apiProvider || "",
    integrationType: business.integrationType || "",
    claimStatus: business.claimStatus || "unclaimed",
    verificationStatus: business.verificationStatus || "unverified",
    apiConnectionStatus: business.apiConnectionStatus || "not_connected",
    address: business.address || "",
    credentialId: business.credentialId ? "connected" : "",
    pendingCredentialId: business.pendingCredentialId ? "submitted" : ""
  };
}

function safeClaimPublicView(claim = {}) {
  return {
    claimId: claim.claimId,
    businessId: claim.businessId || "",
    businessName: claim.businessName || "",
    ownerName: claim.ownerName || "",
    email: claim.email || claim.ownerEmail || "",
    phone: claim.phone || claim.ownerPhone || "",
    website: claim.website || "",
    status: claim.status || claim.claimStatus || "claimed_pending",
    requestedAt: claim.requestedAt || claim.createdAt || "",
    updatedAt: claim.updatedAt || "",
    verification: claim.verification || {},
    apiProviders: Array.isArray(claim.apiProviders) ? claim.apiProviders : [],
    notes: claim.notes || claim.note || ""
  };
}

async function getBusinesses() {
  return businessManager.getAllBusinesses({ includeDisabled: true });
}

async function findBusinessByName(businessName) {
  const businesses = await getBusinesses();
  const target = normalize(businessName);

  return (
    businesses.find((business) => {
      return normalize(business.businessName || business.name || "") === target;
    }) || null
  );
}

async function saveBusinessMerge(businessName, updates = {}) {
  const existingBusiness = await findBusinessByName(businessName);

  if (!existingBusiness) {
    return null;
  }

  const mergedBusiness = {
    ...existingBusiness,
    ...updates,
    businessId: existingBusiness.businessId || existingBusiness.id,
    businessName: existingBusiness.businessName || existingBusiness.name || businessName,
    updatedAt: new Date().toISOString()
  };

  return businessManager.saveBusiness(mergedBusiness);
}

async function updateBusinessClaimStatus({ businessName, claimStatus, verificationStatus }) {
  return saveBusinessMerge(businessName, {
    claimStatus,
    verificationStatus
  });
}

async function updateBusinessApprovedCredential({ businessName }) {
  const existingBusiness = await findBusinessByName(businessName);

  if (!existingBusiness) {
    return null;
  }

  return saveBusinessMerge(businessName, {
    claimStatus: "claimed_verified",
    verificationStatus: "verified",
    // Claim approval must never activate a credential submitted before
    // verification. Only a successful owner-initiated API test can do that.
    apiConnectionStatus: existingBusiness.apiConnectionStatus || "not_connected",
    pendingCredentialId: ""
  });
}

router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "businessPortalRoutes.js loaded"
  });
});

router.get("/businesses", async (req, res) => {
  try {
    const businesses = await getBusinesses();

    res.json({
      success: true,
      businesses: businesses.map(safeBusinessPublicView)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/claim", async (req, res) => {
  try {
    const {
      businessName,
      businessId,
      ownerName,
      ownerEmail,
      email,
      ownerPhone,
      phone,
      website,
      note,
      notes
    } = req.body || {};

    const claim = createBusinessClaim({
      businessName,
      businessId,
      ownerName,
      email: email || ownerEmail,
      phone: phone || ownerPhone,
      website,
      notes: notes || note
    });

    const updatedBusiness = await updateBusinessClaimStatus({
      businessName: claim.businessName,
      claimStatus: "claimed_pending",
      verificationStatus: "unverified"
    });

    res.json({
      success: true,
      claim: safeClaimPublicView(claim),
      business: updatedBusiness ? safeBusinessPublicView(updatedBusiness) : null
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/claims", (req, res) => {
  try {
    const claims = loadClaims();

    res.json({
      success: true,
      stats: getClaimStats(),
      claims: claims.map(safeClaimPublicView)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/claims/pending", (req, res) => {
  try {
    const claims = getPendingClaims();

    res.json({
      success: true,
      claims: claims.map(safeClaimPublicView)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/claims/:claimId/approve", async (req, res) => {
  try {
    const { claimId } = req.params;

    const approvedClaim = approveClaim(claimId, {
      reviewedBy: req.body?.reviewedBy || "admin"
    });

    const updatedBusiness = await updateBusinessApprovedCredential({
      businessName: approvedClaim.businessName
    });

    res.json({
      success: true,
      claim: safeClaimPublicView(approvedClaim),
      business: updatedBusiness ? safeBusinessPublicView(updatedBusiness) : null
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/claims/:claimId/reject", async (req, res) => {
  try {
    const { claimId } = req.params;
    const existingClaim = findClaimById(claimId);

    const rejectedClaim = rejectClaim(claimId, {
      reviewedBy: req.body?.reviewedBy || "admin",
      reason: req.body?.reason || ""
    });

    const updatedBusiness = await updateBusinessClaimStatus({
      businessName: rejectedClaim.businessName || existingClaim?.businessName,
      claimStatus: "claimed_rejected",
      verificationStatus: "rejected"
    });

    res.json({
      success: true,
      claim: safeClaimPublicView(rejectedClaim),
      business: updatedBusiness ? safeBusinessPublicView(updatedBusiness) : null
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
