const express = require("express");
const fs = require("fs");
const path = require("path");

const {
  saveApiCredential,
  listApiCredentialSummaries
} = require("./apiCredentialManager");

const {
  testMindbodyConnection
} = require("./mindbodyApiClient");

const {
  createBusinessClaim,
  approveClaim,
  rejectClaim,
  getPendingClaims,
  loadClaims,
  getClaimStats,
  findClaimById
} = require("./businessClaimManager");

const router = express.Router();

const BUSINESSES_FILE = path.join(__dirname, "businesses.json");

function ensureFile(filePath, fallback) {
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
  }
}

function readJson(filePath, fallback) {
  ensureFile(filePath, fallback);

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureFile(filePath, Array.isArray(data) ? [] : {});
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function safeBusinessPublicView(business) {
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

function safeClaimPublicView(claim) {
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

function getBusinesses() {
  return readJson(BUSINESSES_FILE, []);
}

function saveBusinesses(businesses) {
  writeJson(BUSINESSES_FILE, businesses);
}

function findBusinessIndexByName(businesses, businessName) {
  return businesses.findIndex((business) => {
    return String(business.businessName || business.name || "")
      .toLowerCase()
      .trim() === String(businessName || "").toLowerCase().trim();
  });
}

function updateBusinessClaimStatus({ businessName, claimStatus, verificationStatus }) {
  const businesses = getBusinesses();
  const index = findBusinessIndexByName(businesses, businessName);

  if (index < 0) {
    return null;
  }

  businesses[index] = {
    ...businesses[index],
    claimStatus,
    verificationStatus,
    updatedAt: new Date().toISOString()
  };

  saveBusinesses(businesses);

  return businesses[index];
}

function updateBusinessPendingCredential({ businessName, apiProvider, credentialId }) {
  const businesses = getBusinesses();
  const index = findBusinessIndexByName(businesses, businessName);

  if (index < 0) {
    return null;
  }

  businesses[index] = {
    ...businesses[index],
    claimStatus: businesses[index].claimStatus || "claimed_pending",
    verificationStatus: businesses[index].verificationStatus || "unverified",
    apiProvider,
    pendingCredentialId: credentialId,
    apiConnectionStatus: "credential_submitted",
    updatedAt: new Date().toISOString()
  };

  saveBusinesses(businesses);

  return businesses[index];
}

function updateBusinessApprovedCredential({ businessName }) {
  const businesses = getBusinesses();
  const index = findBusinessIndexByName(businesses, businessName);

  if (index < 0) {
    return null;
  }

  businesses[index] = {
    ...businesses[index],
    claimStatus: "claimed_verified",
    verificationStatus: "verified",
    apiConnectionStatus:
      businesses[index].apiConnectionStatus === "credential_submitted"
        ? "api_pending_verification"
        : businesses[index].apiConnectionStatus || "not_connected",
    credentialId: businesses[index].pendingCredentialId || businesses[index].credentialId || "",
    pendingCredentialId: "",
    updatedAt: new Date().toISOString()
  };

  saveBusinesses(businesses);

  return businesses[index];
}

router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "businessPortalRoutes.js loaded"
  });
});

router.get("/businesses", (req, res) => {
  const businesses = getBusinesses();

  res.json({
    success: true,
    businesses: businesses.map(safeBusinessPublicView)
  });
});

router.post("/claim", (req, res) => {
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

    const updatedBusiness = updateBusinessClaimStatus({
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

router.post("/claims/:claimId/approve", (req, res) => {
  try {
    const { claimId } = req.params;

    const approvedClaim = approveClaim(claimId, {
      reviewedBy: req.body?.reviewedBy || "admin"
    });

    const updatedBusiness = updateBusinessApprovedCredential({
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

router.post("/claims/:claimId/reject", (req, res) => {
  try {
    const { claimId } = req.params;
    const existingClaim = findClaimById(claimId);

    const rejectedClaim = rejectClaim(claimId, {
      reviewedBy: req.body?.reviewedBy || "admin",
      reason: req.body?.reason || ""
    });

    const updatedBusiness = updateBusinessClaimStatus({
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

router.post("/credentials", async (req, res) => {
  try {
    const {
      businessName,
      ownerEmail,
      apiProvider,
      credentialType = "api_key",
      apiKey,
      siteId,
      locationId,
      label = "Primary API Credential",
      metadata = {}
    } = req.body || {};

    if (!businessName || !ownerEmail || !apiProvider || !apiKey) {
      return res.status(400).json({
        success: false,
        error: "businessName, ownerEmail, apiProvider, and apiKey are required."
      });
    }

    const credentialId = `${slugify(businessName)}-${slugify(apiProvider)}-main`;

    const credentialMetadata = {
      ...metadata,
      ownerEmail,
      siteId: siteId || metadata.siteId || "",
      locationId:
        locationId !== undefined && locationId !== ""
          ? Number(locationId)
          : metadata.locationId || undefined
    };

    const savedCredential = saveApiCredential({
      credentialId,
      businessName,
      platform: apiProvider,
      label,
      credentialType,
      value: apiKey,
      metadata: credentialMetadata
    });

    const updatedBusiness = updateBusinessPendingCredential({
      businessName,
      apiProvider,
      credentialId
    });

    let testResult = {
      tested: false,
      success: null,
      message: "No CRM test implemented for this provider yet."
    };

    if (apiProvider === "mindbody") {
      try {
        await testMindbodyConnection(credentialId);

        testResult = {
          tested: true,
          success: true,
          message: "Mindbody credential decrypted and connected successfully."
        };
      } catch (error) {
        testResult = {
          tested: true,
          success: false,
          message: error.message
        };
      }
    }

    res.json({
      success: true,
      credential: savedCredential,
      business: updatedBusiness ? safeBusinessPublicView(updatedBusiness) : null,
      testResult
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/credentials", (req, res) => {
  const summaries = listApiCredentialSummaries();

  res.json({
    success: true,
    credentials: summaries
  });
});

module.exports = router;