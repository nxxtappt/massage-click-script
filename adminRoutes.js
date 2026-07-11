const express = require("express");
const { spawn } = require("child_process");

const {
  loadAdminSettings,
  saveAdminSettings
} = require("./adminSettingsManager");

const {
  clearAppointmentCache,
  getCacheStats,
  getCachedAppointments
} = require("./cacheManager");

const router = express.Router();

const businessManager = require("./businessManager");
const inventoryRepository = require("./database/inventoryRepository");
const runtimeStateRepository = require("./database/runtimeStateRepository");

let schedulerRunInProgress = false;
let scrapeRunInProgress = false;

function addArg(args, key, value) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return;
  args.push(`--${key}=${cleaned}`);
}

function runNodeScript(scriptName, args = []) {
  return new Promise((resolve) => {
    const child = spawn("node", [scriptName, ...args], {
      cwd: __dirname,
      shell: false,
      stdio: "ignore",
      detached: true
    });

    child.on("error", (error) => {
      resolve({ success: false, error: error.message });
    });

    child.unref();

    resolve({ success: true });
  });
}

function buildScrapeArgsFromBody(body = {}) {
  const args = [];

  addArg(args, "platform", body.platform);
  addArg(args, "business", body.business);
  addArg(args, "service", body.service);
  addArg(args, "serviceType", body.serviceType);
  addArg(args, "durationMinutes", body.durationMinutes);
  addArg(args, "businessServiceId", body.businessServiceId || body.serviceRowId);
  addArg(args, "platformServiceId", body.platformServiceId);
  addArg(args, "priority", body.priority);
  addArg(args, "discoveryStatus", body.discoveryStatus);
  addArg(args, "latitude", body.latitude);
  addArg(args, "longitude", body.longitude);
  addArg(args, "maxDistanceMiles", body.maxDistanceMiles);

  if (body.forceRefresh === true) args.push("--forceRefresh=true");
  if (body.forceDirectScrape === true) args.push("--forceDirectScrape=true");
  if (body.manual === true) args.push("--manual=true");
  if (body.ignoreServiceRules === true) args.push("--ignoreServiceRules=true");
  if (body.skipVagaroDiscovery === true) args.push("--skipVagaroDiscovery=true");

  return args;
}


function cleanNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item, 120)).filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(",").map((item) => cleanText(item, 120)).filter(Boolean);
  }

  return [];
}

function normalizeAdminService(service = {}) {
  const inferenceRole = cleanEnum(
    service.inferenceRole,
    ["", "anchor", "inferred"],
    ""
  );

  return {
    ...service,
    serviceName: cleanText(service.serviceName, 300),
    serviceType: cleanText(service.serviceType || service.serviceCategory, 120),
    durationMinutes: cleanNumberOrNull(service.durationMinutes),
    price: cleanNumberOrNull(service.price),
    enabled: service.enabled !== false && service.enabled !== "false",
    scrapeDirectly:
      service.scrapeDirectly !== false && service.scrapeDirectly !== "false",
    inferenceEnabled:
      cleanBoolean(service.inferenceEnabled) || Boolean(inferenceRole),
    inferenceRole: inferenceRole || null,
    anchorServiceId: cleanNumberOrNull(service.anchorServiceId),
    anchorServiceKey: cleanText(service.anchorServiceKey, 500),
    inferShorterDurations: cleanBoolean(service.inferShorterDurations),
    inferServiceTypes: cleanStringArray(service.inferServiceTypes),
    inferStartIntervalMinutes: cleanNumberOrNull(service.inferStartIntervalMinutes),
    inferenceConfidence: cleanNumberOrNull(service.inferenceConfidence),
    bookingIntervalMinutes: cleanNumberOrNull(service.bookingIntervalMinutes),
    daysForward: cleanNumberOrNull(service.daysForward),
    lookaheadHours: cleanNumberOrNull(service.lookaheadHours)
  };
}

function normalizeAdminBusiness(business = {}) {
  const services = Array.isArray(business.services)
    ? business.services.map(normalizeAdminService)
    : [];

  return {
    ...business,
    businessName: cleanText(business.businessName || business.name, 300),
    enabled:
      business.enabled === false || business.enabled === "false"
        ? false
        : true,
    latitude: cleanNumberOrNull(business.latitude),
    longitude: cleanNumberOrNull(business.longitude),
    services
  };
}

function cleanText(value, maxLength = 5000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanUrl(value) {
  const raw = cleanText(value, 2000);
  if (!raw) return "";

  try {
    const parsed = new URL(raw);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function cleanBoolean(value) {
  return value === true || value === "true";
}

function cleanEnum(value, allowed, fallback) {
  const cleaned = cleanText(value, 80);
  return allowed.includes(cleaned) ? cleaned : fallback;
}

function cleanBookingWidget(rawWidget = {}) {
  const widget = rawWidget && typeof rawWidget === "object" ? rawWidget : {};
  const type = cleanEnum(widget.type, ["url", "iframe", "html", "link"], "url");
  const provider = cleanText(widget.provider || "other", 80) || "other";

  return {
    enabled: cleanBoolean(widget.enabled),
    provider,
    type,
    title: cleanText(widget.title || "Book online", 160),
    url: cleanUrl(widget.url),
    html: cleanText(widget.html || widget.code || "", 20000)
  };
}

function cleanBusinessProfile(rawProfile = {}) {
  const profile = rawProfile && typeof rawProfile === "object" ? rawProfile : {};

  return {
    bio: cleanText(profile.bio, 3000),
    shortDescription: cleanText(profile.shortDescription, 300),
    websiteUrl: cleanUrl(profile.websiteUrl)
  };
}

function cleanCardPromotion(rawPromotion = {}) {
  const promotion = rawPromotion && typeof rawPromotion === "object" ? rawPromotion : {};

  return {
    enabled: cleanBoolean(promotion.enabled),
    title: cleanText(promotion.title, 120),
    body: cleanText(promotion.body, 400),
    ctaText: cleanText(promotion.ctaText || "Learn More", 80),
    ctaUrl: cleanUrl(promotion.ctaUrl),
    expiresAt: cleanText(promotion.expiresAt, 40)
  };
}

function cleanSubscriptionPayload(body = {}) {
  return {
    plan: cleanEnum(body.plan, ["verified_basic", "premium"], "verified_basic"),
    subscriptionStatus: cleanEnum(
      body.subscriptionStatus,
      ["active", "trialing", "inactive", "past_due", "canceled"],
      "active"
    ),
    billingProvider: "manual_admin",
    notes: cleanText(body.notes, 2000),
    bookingWidget: cleanBookingWidget(body.bookingWidget),
    businessProfile: cleanBusinessProfile(body.businessProfile),
    cardPromotion: cleanCardPromotion(body.cardPromotion)
  };
}

router.get("/debug/routes", (req, res) => {
  res.json({
    success: true,
    message: "adminRoutes.js is loaded correctly",
    file: __filename,
    routes: [
      "GET /api/admin/businesses",
      "POST /api/admin/businesses/create",
      "POST /api/admin/businesses/save",
      "GET /api/admin/business-subscriptions",
      "POST /api/admin/business-subscriptions",
      "GET /api/admin/results",
      "GET /api/admin/errors",
      "GET /api/admin/settings",
      "POST /api/admin/settings/save",
      "GET /api/admin/cache/stats",
      "GET /api/admin/cache/items",
      "POST /api/admin/cache/clear",
      "POST /api/admin/scheduler/run-once",
      "POST /api/admin/scrape/run-once",
      "POST /api/admin/scrape/targeted"
    ]
  });
});

router.get("/businesses", async (req, res) => {
  try {
    const businesses = await businessManager.getAllBusinesses({
      includeDisabled: true
    });

    res.json({
      success: true,
      businesses
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/business-subscriptions", async (req, res) => {
  try {
    const subscriptions =
      await businessManager.getBusinessSubscriptionMap();

    res.json({
      success: true,
      source: "postgres",
      subscriptions
    });
  } catch (error) {
    console.error("[ADMIN SUBSCRIPTIONS GET ERROR]", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/business-subscriptions", async (req, res) => {
  try {
    const { businessName } = req.body || {};

    if (!businessName) {
      return res.status(400).json({
        success: false,
        error: "businessName is required."
      });
    }

    const payload = cleanSubscriptionPayload(req.body || {});

    const business = await businessManager.getBusinessByName(businessName);

    if (!business) {
      return res.status(404).json({
        success: false,
        error: "Business not found."
      });
    }

    const bookingWidget = payload.bookingWidget || {};

    const bookingIntegration = {
      ...bookingWidget,
      widgetType: bookingWidget.type || "url",
      bookingUrl:
        bookingWidget.type === "url" || bookingWidget.type === "link"
          ? bookingWidget.url || ""
          : "",
      iframeUrl:
        bookingWidget.type === "iframe"
          ? bookingWidget.url || ""
          : "",
      embedCode:
        bookingWidget.type === "html"
          ? bookingWidget.html || ""
          : ""
    };

    const subscription =
      await businessManager.saveBusinessSubscription(
        business.businessId || business.id || businessName,
        {
          plan: payload.plan,
          subscriptionStatus: payload.subscriptionStatus,
          billingProvider:
            payload.billingProvider || "manual_admin",
          notes: payload.notes || "",
          publicProfile: payload.businessProfile || {},
          activeDeal: payload.cardPromotion || {},
          bookingIntegration
        }
      );

    res.json({
      success: true,
      source: "postgres",
      message:
        "Business subscription and premium features saved.",
      businessName: business.businessName,
      subscription: {
        ...subscription,
        businessProfile: subscription.publicProfile,
        cardPromotion: subscription.activeDeal,
        bookingWidget: subscription.bookingIntegration
      }
    });
  } catch (error) {
    console.error("[ADMIN SUBSCRIPTION SAVE ERROR]", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/businesses/create", async (req, res) => {
  try {
    const business = normalizeAdminBusiness(req.body?.business || req.body || {});

    if (!business.businessName) {
      return res.status(400).json({ success: false, error: "businessName is required." });
    }

    const existing = await businessManager.getBusinessByName(business.businessName);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "A business with this name already exists. Use Save Businesses to edit it."
      });
    }

    const savedBusiness = await businessManager.saveBusiness(business);
    const businesses = await businessManager.getAllBusinesses({ includeDisabled: true });

    res.status(201).json({
      success: true,
      source: "postgres",
      business: savedBusiness,
      businesses
    });
  } catch (error) {
    console.error("[ADMIN BUSINESS CREATE ERROR]", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/businesses/save", async (req, res) => {
  try {
    const body = req.body || {};
    const businesses = Array.isArray(body.businesses)
      ? body.businesses
      : body.business && typeof body.business === "object"
        ? [body.business]
        : body.businessName
          ? [body]
          : [];

    if (!Array.isArray(businesses) || businesses.length === 0) {
      return res.status(400).json({
        success: false,
        error: "businesses must be a non-empty array or business must be an object"
      });
    }

    const savedBusinesses = [];

    for (const business of businesses) {
      const normalizedBusiness = normalizeAdminBusiness(business);

      if (!normalizedBusiness.businessName) {
        return res.status(400).json({
          success: false,
          error: "Every business must have a businessName."
        });
      }

      savedBusinesses.push(await businessManager.saveBusiness(normalizedBusiness));
    }

    const refreshedBusinesses = await businessManager.getAllBusinesses({
      includeDisabled: true
    });

    res.json({
      success: true,
      count: savedBusinesses.length,
      businesses: refreshedBusinesses,
      savedBusinesses
    });
  } catch (error) {
    console.error("[ADMIN BUSINESS SAVE ERROR]", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/results", async (req, res) => {
  try {
    const results = await inventoryRepository.getInventory({ showPast: true, includeInactive: true, limit: 2000 });
    res.json({ success: true, source: "postgres", results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/errors", async (req, res) => {
  try {
    const errors = await runtimeStateRepository.getScrapeErrors(500);
    res.json({ success: true, source: "postgres", errors });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/settings", (req, res) => {
  res.json({
    success: true,
    settings: loadAdminSettings()
  });
});

router.post("/settings/save", async (req, res) => {
  const settings = req.body?.settings;

  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return res.status(400).json({
      success: false,
      error: "settings must be an object"
    });
  }

  res.json({
    success: true,
    settings: await saveAdminSettings(settings)
  });
});

router.get("/cache/stats", (req, res) => {
  res.json({
    success: true,
    stats: getCacheStats()
  });
});

router.get("/cache/items", (req, res) => {
  const items = getCachedAppointments(req.query || {});

  res.json({
    success: true,
    count: items.length,
    items
  });
});

router.post("/cache/clear", async (req, res) => {
  await clearAppointmentCache();

  res.json({
    success: true,
    message: "Appointment cache cleared."
  });
});

router.post("/scheduler/run-once", async (req, res) => {
  if (schedulerRunInProgress) {
    return res.status(409).json({
      success: false,
      error: "A scheduler run is already being started."
    });
  }

  schedulerRunInProgress = true;

  try {
    const result = await runNodeScript("scheduler.js", ["--once"]);

    res.json({
      success: result.success,
      message: result.success ? "Scheduler run started." : "Scheduler failed to start.",
      error: result.error || null
    });
  } finally {
    setTimeout(() => {
      schedulerRunInProgress = false;
    }, 5000);
  }
});

router.post("/scrape/run-once", async (req, res) => {
  if (scrapeRunInProgress) {
    return res.status(409).json({
      success: false,
      error: "A scrape run is already being started."
    });
  }

  scrapeRunInProgress = true;

  try {
    const args = buildScrapeArgsFromBody(req.body || {});
    const result = await runNodeScript("scrape.js", args);

    res.json({
      success: result.success,
      message: result.success ? "Scrape run started." : "Scrape failed to start.",
      args,
      error: result.error || null
    });
  } finally {
    setTimeout(() => {
      scrapeRunInProgress = false;
    }, 5000);
  }
});

router.post("/scrape/targeted", async (req, res) => {
  if (scrapeRunInProgress) {
    return res.status(409).json({
      success: false,
      error: "A scrape run is already being started."
    });
  }

  const body = req.body || {};

  if (
    !body.platform &&
    !body.business &&
    !body.service &&
    !body.serviceType &&
    !body.durationMinutes
  ) {
    return res.status(400).json({
      success: false,
      error: "Choose at least one target: platform, business, service, service type, or duration."
    });
  }

  scrapeRunInProgress = true;

  try {
    const args = buildScrapeArgsFromBody({
      ...body,
      manual: body.manual !== false,
      forceRefresh: body.forceRefresh !== false
    });

    const result = await runNodeScript("scrape.js", args);

    res.json({
      success: result.success,
      message: result.success ? "Targeted scrape started." : "Targeted scrape failed to start.",
      args,
      error: result.error || null
    });
  } finally {
    setTimeout(() => {
      scrapeRunInProgress = false;
    }, 5000);
  }
});

module.exports = router;