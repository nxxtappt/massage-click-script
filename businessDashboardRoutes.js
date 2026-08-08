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

const {
  getBusinessPlan
} = require("./businessPlanManager");

const businessManager = require("./businessManager");

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

async function findBusinessForSession(session) {
  const businesses = await businessManager.getAllBusinesses({
    includeDisabled: true,
    source: "postgres"
  });

  if (!Array.isArray(businesses)) {
    return null;
  }

  const businessIndex = findBusinessIndexForSession(session, businesses);

  if (businessIndex < 0) {
    return null;
  }

  const matchedBusiness = businesses[businessIndex];
  const businessName =
    matchedBusiness.businessName ||
    matchedBusiness.name ||
    session.businessName ||
    "";

  if (!businessName) {
    return matchedBusiness;
  }

  try {
    return (
      (await businessManager.getBusinessByName(businessName, {
        includeDisabled: true,
        source: "postgres"
      })) || matchedBusiness
    );
  } catch (error) {
    console.warn(
      "[BUSINESS DASHBOARD] Failed to load subscription-aware business:",
      error.message
    );
    return matchedBusiness;
  }
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

function getBusinessIdentity(business = {}, session = {}) {
  return (
    business.businessId ||
    business.id ||
    business.businessName ||
    business.name ||
    session.businessId ||
    session.businessName ||
    ""
  );
}

function getSubscriptionWriteBase(business = {}) {
  const planInfo = getBusinessPlan(business);

  return {
    plan: planInfo.plan || "verified_basic",
    subscriptionStatus: planInfo.subscriptionStatus || "active",
    billingProvider: planInfo.billingProvider || "manual_admin"
  };
}

async function buildDashboard(session) {
  const business = await findBusinessForSession(session);

  const businessName =
    business?.businessName ||
    business?.name ||
    session.businessName ||
    "Unknown Business";

  const latestResult = findLatestResultForBusiness(businessName);
  const latestCache = findLatestCacheForBusiness(businessName);
  const planInfo = getBusinessPlan(business || {});

  const publicProfile = {
    ...(planInfo.publicProfile || {}),
    ...(business?.publicProfile || {}),
    shortDescription:
      business?.publicProfile?.shortDescription ||
      planInfo.publicProfile?.shortDescription ||
      business?.shortDescription ||
      "",
    bio:
      business?.publicProfile?.bio ||
      planInfo.publicProfile?.bio ||
      business?.bio ||
      business?.businessBio ||
      ""
  };

  const activeDeal = {
    ...(planInfo.activeDeal || {}),
    ...(business?.activeDeal || {})
  };

  const bookingIntegration = {
    ...(planInfo.bookingIntegration || {}),
    ...(business?.bookingIntegration || {})
  };

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
    businessId:
      business?.businessId ||
      business?.id ||
      session.businessId,
    businessName,
    email: session.email,
    sessionExpiresAt: session.expiresAt,

    plan: planInfo.plan,
    subscriptionStatus: planInfo.subscriptionStatus,
    isPremium: planInfo.isPremium,
    entitlements: planInfo.entitlements,

    profile: {
      businessName,
      verificationStatus: getVerificationStatus(session, business),
      connectedProvider: getConnectedProvider(business),
      integrationStatus: getIntegrationStatus(business),
      lastSyncTimestamp,
      logoUrl: business?.logoUrl || "",
      logoAlt: business?.logoAlt || `${businessName} logo`,
      phone: business?.phone || business?.businessPhone || "",
      website: business?.website || business?.businessWebsite || "",
      publicProfile,
      activeDeal,
      bookingIntegration: {
        enabled: bookingIntegration.enabled === true,
        provider:
          bookingIntegration.provider ||
          business?.platform ||
          "other",
        widgetType:
          bookingIntegration.widgetType ||
          bookingIntegration.type ||
          (bookingIntegration.widgetUrl ? "iframe" : "url"),
        embedCode:
          bookingIntegration.embedCode ||
          bookingIntegration.code ||
          bookingIntegration.html ||
          "",
        iframeUrl:
          bookingIntegration.iframeUrl ||
          bookingIntegration.widgetUrl ||
          "",
        bookingUrl:
          bookingIntegration.bookingUrl ||
          bookingIntegration.url ||
          business?.bookingUrl ||
          ""
      },
      bookingWidgetUrl:
        bookingIntegration.widgetUrl ||
        bookingIntegration.iframeUrl ||
        bookingIntegration.url ||
        "",
      bookingWidgetEnabled: bookingIntegration.enabled === true
    },

    inventoryHealth: {
      lastScrape: lastScrape || "Not scraped yet",
      lastApiSync: lastApiSync || "No API sync yet",
      providerHealth: latestResult?.status || latestCache?.status || "unknown"
    },

    analytics: await getBusinessClickSummary(
      businessName,
      {
        days: 30,
        businessSlug:
          business?.businessSlug ||
          business?.slug ||
          slugify(businessName)
      }
    )
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

router.post("/profile", requireBusinessSession, async (req, res) => {
  try {
    const currentBusiness = await findBusinessForSession(req.businessSession);

    if (!currentBusiness) {
      return res.status(404).json({
        success: false,
        error: "Business not found for this session."
      });
    }

    const requestedLogoUrl = String(req.body?.logoUrl || "").trim();
    const requestedLogoAlt = String(req.body?.logoAlt || "").trim();

    const logoUrl =
      requestedLogoUrl ||
      currentBusiness.logoUrl ||
      "";

    const phone =
      String(req.body?.phone || "").trim() ||
      currentBusiness.phone ||
      currentBusiness.businessPhone ||
      "";

    const website =
      String(req.body?.website || "").trim() ||
      currentBusiness.website ||
      currentBusiness.businessWebsite ||
      "";
    const shortDescription = String(req.body?.shortDescription || "").trim();
    const bio = String(req.body?.bio || "").trim();

    if (website && !/^https?:\/\/.+/i.test(website)) {
      return res.status(400).json({
        success: false,
        error: "Website must start with http:// or https://"
      });
    }

    if (shortDescription.length > 220) {
      return res.status(400).json({
        success: false,
        error: "Short description must be 220 characters or less."
      });
    }

    if (bio.length > 2500) {
      return res.status(400).json({
        success: false,
        error: "Business bio must be 2500 characters or less."
      });
    }

    const businessName =
      currentBusiness.businessName ||
      currentBusiness.name ||
      req.businessSession.businessName ||
      "Business";

    const resolvedLogoAlt =
      requestedLogoAlt ||
      currentBusiness.logoAlt ||
      `${businessName} logo`;

    const updatedBusiness = await businessManager.saveBusiness(
      {
        ...currentBusiness,
        logoUrl,
        logoAlt: resolvedLogoAlt,
        phone,
        website,
        updatedAt: new Date().toISOString()
      },
      {
        source: "postgres"
      }
    );

    const publicProfile = {
      ...(currentBusiness.publicProfile || {}),
      shortDescription,
      bio
    };

    const savedSubscription =
      await businessManager.saveBusinessSubscription(
        getBusinessIdentity(currentBusiness, req.businessSession),
        {
          ...getSubscriptionWriteBase(currentBusiness),
          publicProfile
        },
        {
          source: "postgres"
        }
      );

    res.json({
      success: true,
      message: "Business profile saved.",
      profile: {
        businessName,
        logoUrl: updatedBusiness.logoUrl || logoUrl || "",
        logoAlt:
          updatedBusiness.logoAlt ||
          resolvedLogoAlt,
        phone: updatedBusiness.phone || phone || "",
        website: updatedBusiness.website || website || "",
        publicProfile:
          savedSubscription.publicProfile ||
          publicProfile
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

router.post("/booking-widget", requireBusinessSession, async (req, res) => {
  try {
    const currentBusiness = await findBusinessForSession(req.businessSession);

    if (!currentBusiness) {
      return res.status(404).json({
        success: false,
        error: "Business not found for this session."
      });
    }

    const previousIntegration = currentBusiness.bookingIntegration || {};

    const enabled = req.body?.enabled === true || req.body?.bookingWidgetEnabled === true;
    const provider = String(req.body?.provider || previousIntegration.provider || currentBusiness.platform || "other").trim() || "other";
    const widgetType = String(
      req.body?.widgetType ||
      req.body?.type ||
      previousIntegration.widgetType ||
      previousIntegration.type ||
      (req.body?.bookingWidgetUrl ? "iframe" : "url")
    ).trim();

    const embedCode = String(req.body?.embedCode || req.body?.code || "").trim();
    const iframeUrl = String(req.body?.iframeUrl || req.body?.bookingWidgetUrl || "").trim();
    const bookingUrl = String(req.body?.bookingUrl || "").trim();

    const allowedWidgetTypes = ["html", "iframe", "url"];

    if (!allowedWidgetTypes.includes(widgetType)) {
      return res.status(400).json({
        success: false,
        error: "Widget type must be html, iframe, or url."
      });
    }

    if (embedCode.length > 12000) {
      return res.status(400).json({
        success: false,
        error: "Embed code is too long. Maximum length is 12,000 characters."
      });
    }

    if (iframeUrl && !/^https:\/\/.+/i.test(iframeUrl)) {
      return res.status(400).json({
        success: false,
        error: "Iframe URL must start with https://"
      });
    }

    if (bookingUrl && !/^https:\/\/.+/i.test(bookingUrl)) {
      return res.status(400).json({
        success: false,
        error: "Booking URL must start with https://"
      });
    }

    if (widgetType === "html" && enabled && !embedCode) {
      return res.status(400).json({
        success: false,
        error: "Paste embed code or disable the widget before saving."
      });
    }

    if (widgetType === "iframe" && enabled && !iframeUrl) {
      return res.status(400).json({
        success: false,
        error: "Iframe URL is required when iframe widget is enabled."
      });
    }

    if (widgetType === "url" && enabled && !bookingUrl) {
      return res.status(400).json({
        success: false,
        error: "Booking URL is required when booking link widget is enabled."
      });
    }

    const bookingIntegration = {
      ...previousIntegration,
      mode: "widget",
      enabled,
      provider,
      widgetType,
      type: widgetType,
      embedCode,
      code: embedCode,
      iframeUrl,
      widgetUrl: iframeUrl,
      bookingUrl
    };

    await businessManager.saveBusinessSubscription(
      getBusinessIdentity(currentBusiness, req.businessSession),
      {
        ...getSubscriptionWriteBase(currentBusiness),
        bookingIntegration
      },
      {
        source: "postgres"
      }
    );

    res.json({
      success: true,
      message: "Booking widget saved.",
      bookingIntegration
    });
  } catch (error) {
    console.error("[BOOKING WIDGET SAVE ERROR]", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/deal", requireBusinessSession, async (req, res) => {
  try {
    const currentBusiness = await findBusinessForSession(req.businessSession);

    if (!currentBusiness) {
      return res.status(404).json({
        success: false,
        error: "Business not found for this session."
      });
    }

    const enabled = req.body?.enabled === true;
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    const promoCode = String(req.body?.promoCode || "").trim();
    const expiresAt = String(req.body?.expiresAt || "").trim();

    if (title.length > 80) {
      return res.status(400).json({
        success: false,
        error: "Deal title must be 80 characters or less."
      });
    }

    if (body.length > 260) {
      return res.status(400).json({
        success: false,
        error: "Deal text must be 260 characters or less."
      });
    }

    const activeDeal = {
      ...(currentBusiness.activeDeal || {}),
      enabled,
      title,
      body,
      promoCode,
      expiresAt,
      updatedAt: new Date().toISOString()
    };

    await businessManager.saveBusinessSubscription(
      getBusinessIdentity(currentBusiness, req.businessSession),
      {
        ...getSubscriptionWriteBase(currentBusiness),
        activeDeal
      },
      {
        source: "postgres"
      }
    );

    res.json({
      success: true,
      message: "Deal saved.",
      activeDeal
    });
  } catch (error) {
    console.error("[BUSINESS DEAL SAVE ERROR]", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/profile/logo-upload", requireBusinessSession, async (req, res) => {
  try {
    ensureLogoUploadDir();

    const currentBusiness = await findBusinessForSession(req.businessSession);

    if (!currentBusiness) {
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
      currentBusiness.businessName ||
      currentBusiness.name ||
      req.businessSession.businessName ||
      "Business";

    const safeSlug = slugify(businessName);
    const fileName = `${safeSlug}-${Date.now()}${extension}`;
    const filePath = path.join(LOGO_UPLOAD_DIR, fileName);

    fs.writeFileSync(filePath, file.buffer);

    const logoUrl = `/uploads/business-logos/${fileName}`;
    const logoAlt =
      currentBusiness.logoAlt ||
      `${businessName} logo`;

    await businessManager.saveBusiness(
      {
        ...currentBusiness,
        logoUrl,
        logoAlt,
        updatedAt: new Date().toISOString()
      },
      {
        source: "postgres"
      }
    );

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

router.get("/analytics", requireBusinessSession, async (req, res) => {
  try {
    const business = await findBusinessForSession(
      req.businessSession
    );

    const businessName =
      business?.businessName ||
      business?.name ||
      req.businessSession.businessName ||
      "";

    if (!businessName) {
      return res.status(404).json({
        success: false,
        error: "Business not found."
      });
    }

    const analytics =
      await getBusinessClickSummary(
        businessName,
        {
          days:
            req.query.days ||
            30,
          businessSlug:
            business?.businessSlug ||
            business?.slug ||
            slugify(
              businessName
            )
        }
      );

    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error(
      "[BUSINESS DASHBOARD ANALYTICS ERROR]",
      error
    );

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/dashboard", requireBusinessSession, async (req, res) => {
  try {
    res.json({
      success: true,
      dashboard: await buildDashboard(req.businessSession)
    });
  } catch (error) {
    console.error("[BUSINESS DASHBOARD LOAD ERROR]", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;