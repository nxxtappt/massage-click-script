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

const router = express.Router();

const CLAIMS_FILE = path.join(__dirname, "secure", "business-portal-claims.json");
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
    credentialId: business.credentialId ? "connected" : ""
  };
}

function getBusinesses() {
  return readJson(BUSINESSES_FILE, []);
}

function saveBusinesses(businesses) {
  writeJson(BUSINESSES_FILE, businesses);
}

function updateBusinessPendingCredential({ businessName, apiProvider, credentialId }) {
  const businesses = getBusinesses();

  const index = businesses.findIndex((business) => {
    return String(business.businessName || business.name || "")
      .toLowerCase()
      .trim() === String(businessName || "").toLowerCase().trim();
  });

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
  const {
    businessName,
    ownerName,
    ownerEmail,
    ownerPhone,
    note
  } = req.body || {};

  if (!businessName || !ownerName || !ownerEmail) {
    return res.status(400).json({
      success: false,
      error: "businessName, ownerName, and ownerEmail are required."
    });
  }

  const claims = readJson(CLAIMS_FILE, []);

  const claim = {
    claimId: `claim-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    businessName,
    ownerName,
    ownerEmail,
    ownerPhone: ownerPhone || "",
    note: note || "",
    claimStatus: "claimed_pending",
    verificationStatus: "unverified",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  claims.unshift(claim);
  writeJson(CLAIMS_FILE, claims);

  res.json({
    success: true,
    claim
  });
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

    const credentialId =
      `${slugify(businessName)}-${slugify(apiProvider)}-main`;

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