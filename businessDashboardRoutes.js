const express = require("express");
const fs = require("fs");
const path = require("path");

const {
  getBusinessClickSummary
} = require("./analyticsManager");

const {
  createLoginCode,
  verifyLoginCode,
  validateSession,
  destroySession
} = require("./businessAuthManager");

const {
  sendBusinessLoginCode
} = require("./emailManager");

const router = express.Router();

const {
  storagePath
} = require("./storagePaths");

const LOGO_UPLOAD_DIR = storagePath(
  "public",
  "uploads",
  "business-logos"
);

function ensureLogoUploadDir() {
  if (!fs.existsSync(LOGO_UPLOAD_DIR)) {
    fs.mkdirSync(LOGO_UPLOAD_DIR, {
      recursive: true
    });
  }
}

function readJsonFile(fileName, fallback) {
  const filePath = path.join(__dirname, fileName);

  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`[BUSINESS DASHBOARD] Failed to read ${fileName}:`, error.message);
    return fallback;
  }
}

function writeJsonFile(fileName, data) {
  const filePath = path.join(__dirname, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return String(value || "business")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "business";
}

function getSessionToken(req) {
  return (
    req.headers["x-business-session"] ||
    req.query.sessionToken ||
    req.body?.sessionToken ||
    ""
  );
}

function requireBusinessSession(req, res, next) {
  try {
    const token = getSessionToken(req);
    const session = validateSession(token);

    if (!session) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired business session."
      });
    }

    req.businessSession = session;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: error.message
    });
  }
}

function findBusinessForSession(session) {
  const businesses = readJsonFile("businesses.json", []);

  if (!Array.isArray(businesses)) {
    return null;
  }

  const businessIndex = findBusinessIndexForSession(session, businesses);

  if (businessIndex < 0) {
    return null;
  }

  return businesses[businessIndex];
}

function findBusinessIndexForSession(session, businesses = []) {
  const sessionBusinessId = normalize(session.businessId);
  const sessionBusinessName = normalize(session.businessName);
  const sessionEmail = normalize(session.email);

  return businesses.findIndex((business) => {
    return (
      normalize(business.businessId || business.id) === sessionBusinessId ||
      normalize(business.businessName || business.name) === sessionBusinessName ||
      normalize(
        business.ownerEmail ||
          business.email ||
          business.contactEmail ||
          business.claimedByEmail
      ) === sessionEmail
    );
  });
}

function findLatestResultForBusiness(businessName) {
  const results = readJsonFile("results.json", []);

  if (!Array.isArray(results)) {
    return null;
  }

  const targetName = normalize(businessName);

  const matches = results.filter((result) => {
    return normalize(result.businessName || result.name) === targetName;
  });

  if (!matches.length) {
    return null;
  }

  matches.sort((a, b) => {
    const aTime = new Date(a.lastChecked || a.cachedAt || 0).getTime();
    const bTime = new Date(b.lastChecked || b.cachedAt || 0).getTime();
    return bTime - aTime;
  });

  return matches[0];
}

function findLatestCacheForBusiness(businessName) {
  const cache = readJsonFile(path.join("cache", "appointment-cache.json"), []);

  if (!Array.isArray(cache)) {
    return null;
  }

  const targetName = normalize(businessName);

  const matches = cache.filter((entry) => {
    return normalize(entry.businessName) === targetName;
  });

  if (!matches.length) {
    return null;
  }

  matches.sort((a, b) => {
    const aTime = new Date(a.lastChecked || a.cachedAt || 0).getTime();
    const bTime = new Date(b.lastChecked || b.cachedAt || 0).getTime();
    return bTime - aTime;
  });

  return matches[0];
}

function getVerificationStatus(session, business) {
  return (
    business?.verificationStatus ||
    business?.claimStatus ||
    business?.status ||
    session.verificationStatus ||
    "verified"
  );
}

function getConnectedProvider(business) {
  return (
    business?.connectedProvider ||
    business?.provider ||
    business?.platform ||
    "Not connected"
  );
}

function getIntegrationStatus(business) {
  if (!business) {
    return "Needs setup";
  }

  if (business.integrationStatus) {
    return business.integrationStatus;
  }

  if (business.apiIntegrationEnabled || business.hasApiCredentials) {
    return "API connected";
  }

  if (business.platform) {
    return "Scraper connected";
  }

  return "Needs setup";
}

function buildDashboard(session) {
  const business = findBusinessForSession(session);

  const businessName =
    business?.businessName ||
    business?.name ||
    session.businessName ||
    "Unknown Business";

  const latestResult = findLatestResultForBusiness(businessName);
  const latestCache = findLatestCacheForBusiness(businessName);

  const lastScrape =
    latestResult?.lastChecked ||
    latestResult?.cachedAt ||
    null;

  const lastApiSync =
    business?.lastApiSync ||
    business?.lastSyncAt ||
    null;

  const lastSyncTimestamp =
    lastApiSync ||
    lastScrape ||
    latestCache?.lastChecked ||
    latestCache?.cachedAt ||
    "Not synced yet";

  return {
    businessId: session.businessId,
    businessName,
    email: session.email,
    sessionExpiresAt: session.expiresAt,

    profile: {
      businessName,
      verificationStatus: getVerificationStatus(session, business),
      connectedProvider: getConnectedProvider(business),
      integrationStatus: getIntegrationStatus(business),
      lastSyncTimestamp,
      logoUrl: business?.logoUrl || "",
      logoAlt: business?.logoAlt || `${businessName} logo`
    },

    inventoryHealth: {
      lastScrape: lastScrape || "Not scraped yet",
      lastApiSync: lastApiSync || "No API sync yet",
      providerHealth: latestResult?.status || latestCache?.status || "unknown"
    },

    analytics: getBusinessClickSummary(businessName)
  };
}

function getRequestBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", reject);
  });
}

function parseMultipartFile(req, buffer) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

  if (!boundaryMatch) {
    throw new Error("Missing multipart boundary.");
  }

  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = [];

  let start = buffer.indexOf(boundaryBuffer);

  while (start !== -1) {
    const next = buffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);

    if (next === -1) {
      break;
    }

    const part = buffer.slice(start + boundaryBuffer.length, next);
    parts.push(part);
    start = next;
  }

  for (const rawPart of parts) {
    let part = rawPart;

    if (part.slice(0, 2).toString() === "\r\n") {
      part = part.slice(2);
    }

    if (part.slice(-2).toString() === "\r\n") {
      part = part.slice(0, -2);
    }

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));

    if (headerEnd === -1) {
      continue;
    }

    const headerText = part.slice(0, headerEnd).toString("utf8");
    const body = part.slice(headerEnd + 4);

    const dispositionMatch = headerText.match(
      /Content-Disposition:\s*form-data;[^\r\n]*/i
    );

    if (!dispositionMatch) {
      continue;
    }

    const disposition = dispositionMatch[0];
    const nameMatch = disposition.match(/name="([^"]+)"/i);
    const filenameMatch = disposition.match(/filename="([^"]*)"/i);
    const typeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);

    const fieldName = nameMatch ? nameMatch[1] : "";
    const originalName = filenameMatch ? filenameMatch[1] : "";

    if (fieldName !== "logoFile" || !originalName) {
      continue;
    }

    return {
      fieldName,
      originalName,
      mimeType: typeMatch ? typeMatch[1].trim() : "",
      buffer: body
    };
  }

  return null;
}

function getLogoExtension(file) {
  const mimeType = String(file.mimeType || "").toLowerCase();
  const originalName = String(file.originalName || "").toLowerCase();

  if (mimeType === "image/png" || originalName.endsWith(".png")) {
    return ".png";
  }

  if (
    mimeType === "image/jpeg" ||
    mimeType === "image/jpg" ||
    originalName.endsWith(".jpg") ||
    originalName.endsWith(".jpeg")
  ) {
    return ".jpg";
  }

  if (mimeType === "image/webp" || originalName.endsWith(".webp")) {
    return ".webp";
  }

  if (mimeType === "image/gif" || originalName.endsWith(".gif")) {
    return ".gif";
  }

  return "";
}

router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "businessDashboardRoutes.js loaded"
  });
});

router.post("/auth/request-code", async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required."
      });
    }

    const loginCode = createLoginCode(email);

    await sendBusinessLoginCode({
      to: loginCode.email,
      code: loginCode.code,
      businessName: loginCode.businessName,
      expiresAt: loginCode.expiresAt
    });

    res.json({
      success: true,
      message: "Login code sent.",
      expiresAt: loginCode.expiresAt
    });
  } catch (error) {
    console.error("[BUSINESS LOGIN EMAIL ERROR]", error.message);

    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/auth/verify-code", (req, res) => {
  try {
    const { email, code } = req.body || {};

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: "Email and code are required."
      });
    }

    const session = verifyLoginCode({
      email,
      code
    });

    res.json({
      success: true,
      session
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/auth/session", (req, res) => {
  try {
    const token = getSessionToken(req);
    const session = validateSession(token);

    if (!session) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired session."
      });
    }

    res.json({
      success: true,
      session
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/auth/logout", (req, res) => {
  try {
    const token = getSessionToken(req);

    destroySession(token);

    res.json({
      success: true,
      message: "Logged out."
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/profile", requireBusinessSession, (req, res) => {
  try {
    const businesses = readJsonFile("businesses.json", []);

    if (!Array.isArray(businesses)) {
      return res.status(500).json({
        success: false,
        error: "businesses.json is not a valid array."
      });
    }

    const businessIndex = findBusinessIndexForSession(
      req.businessSession,
      businesses
    );

    if (businessIndex < 0) {
      return res.status(404).json({
        success: false,
        error: "Business not found for this session."
      });
    }

    const logoUrl = String(req.body?.logoUrl || "").trim();
    const logoAlt = String(req.body?.logoAlt || "").trim();

    const businessName =
      businesses[businessIndex].businessName ||
      businesses[businessIndex].name ||
      req.businessSession.businessName ||
      "Business";

    businesses[businessIndex] = {
      ...businesses[businessIndex],
      logoUrl,
      logoAlt: logoAlt || `${businessName} logo`,
      updatedAt: new Date().toISOString()
    };

    writeJsonFile("businesses.json", businesses);

    res.json({
      success: true,
      message: "Business profile saved.",
      profile: {
        businessName,
        logoUrl: businesses[businessIndex].logoUrl || "",
        logoAlt: businesses[businessIndex].logoAlt || ""
      }
    });
  } catch (error) {
    console.error("[BUSINESS DASHBOARD PROFILE SAVE ERROR]", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/profile/logo-upload", requireBusinessSession, async (req, res) => {
  try {
    ensureLogoUploadDir();

    const businesses = readJsonFile("businesses.json", []);

    if (!Array.isArray(businesses)) {
      return res.status(500).json({
        success: false,
        error: "businesses.json is not a valid array."
      });
    }

    const businessIndex = findBusinessIndexForSession(
      req.businessSession,
      businesses
    );

    if (businessIndex < 0) {
      return res.status(404).json({
        success: false,
        error: "Business not found for this session."
      });
    }

    const buffer = await getRequestBuffer(req);
    const file = parseMultipartFile(req, buffer);

    if (!file) {
      return res.status(400).json({
        success: false,
        error: "No logo file uploaded. The file input must be named logoFile."
      });
    }

    const maxBytes = 3 * 1024 * 1024;

    if (file.buffer.length > maxBytes) {
      return res.status(400).json({
        success: false,
        error: "Logo file is too large. Maximum size is 3MB."
      });
    }

    const extension = getLogoExtension(file);

    if (!extension) {
      return res.status(400).json({
        success: false,
        error: "Unsupported logo file type. Use PNG, JPG, WEBP, or GIF."
      });
    }

    const businessName =
      businesses[businessIndex].businessName ||
      businesses[businessIndex].name ||
      req.businessSession.businessName ||
      "Business";

    const safeSlug = slugify(businessName);
    const fileName = `${safeSlug}-${Date.now()}${extension}`;
    const filePath = path.join(LOGO_UPLOAD_DIR, fileName);

    fs.writeFileSync(filePath, file.buffer);

    const logoUrl = `/uploads/business-logos/${fileName}`;
    const logoAlt =
      businesses[businessIndex].logoAlt ||
      `${businessName} logo`;

    businesses[businessIndex] = {
      ...businesses[businessIndex],
      logoUrl,
      logoAlt,
      updatedAt: new Date().toISOString()
    };

    writeJsonFile("businesses.json", businesses);

    res.json({
      success: true,
      message: "Logo uploaded successfully.",
      profile: {
        businessName,
        logoUrl,
        logoAlt
      }
    });
  } catch (error) {
    console.error("[BUSINESS DASHBOARD LOGO UPLOAD ERROR]", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/dashboard", requireBusinessSession, (req, res) => {
  res.json({
    success: true,
    dashboard: buildDashboard(req.businessSession)
  });
});

module.exports = router;