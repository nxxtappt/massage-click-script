const express = require("express");
const {
  loadAdminSettings,
  saveAdminSettings
} = require("./adminSettingsManager");

const { getCacheStats } = require("./cacheManager");

const router = express.Router();

const businessManager = require("./businessManager");
const serviceCategoryRepository = require("./database/serviceCategoryRepository");
const inventoryRepository = require("./database/inventoryRepository");
const runtimeStateRepository = require("./database/runtimeStateRepository");
const { loadClaims, getClaimStats } = require("./businessClaimManager");
const scrapeJobRepository = require("./database/scrapeJobRepository");
const { runDueSchedules } = require("./schedulerV2");
const {
  listMarketplaceMetros,
  getMarketplaceMetro,
  matchesMarketplaceMetro
} = require("./marketplaceMetros");


function resolveAdminMetro(
  value = ""
) {
  const requested =
    cleanText(value, 120);

  if (!requested) {
    return null;
  }

  const metro =
    getMarketplaceMetro(
      requested
    );

  if (!metro) {
    const error = new Error(
      `Unknown marketplace metro: ${requested}`
    );

    error.statusCode = 400;
    throw error;
  }

  return metro;
}

function getAdminMetroTerms(
  value = ""
) {
  return (
    resolveAdminMetro(
      value
    )?.searchTerms ||
    []
  );
}

function addArg(args, key, value) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return;
  args.push(`--${key}=${cleaned}`);
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
  addArg(args, "scrapeStartDate", body.scrapeStartDate);
  addArg(args, "scrapeEndDate", body.scrapeEndDate);
  addArg(args, "lookaheadHours", body.lookaheadHours);
  addArg(args, "daysForward", body.daysForward);
  addArg(args, "scrapeWindowMode", body.scrapeWindowMode);
  addArg(args, "integrationId", body.integrationId);
  addArg(args, "scheduleId", body.scheduleId);

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
  const rawAnchorServiceId = String(service.anchorServiceId || "").trim();
  const anchorServiceId = /^\d+$/.test(rawAnchorServiceId)
    ? Number(rawAnchorServiceId)
    : null;
  const anchorServiceKey =
    cleanText(service.anchorServiceKey, 500) ||
    (rawAnchorServiceId.startsWith("key:")
      ? cleanText(rawAnchorServiceId.slice(4), 500)
      : "");

  return {
    ...service,
    serviceName: cleanText(service.serviceName, 300),
    serviceType: cleanText(service.serviceType || service.serviceCategory, 120),
    categorySlug:
      serviceCategoryRepository.normalizeCategorySlug(
        service.categorySlug ||
        service.category_slug ||
        service.marketplaceCategory ||
        ""
      ),
    durationMinutes: cleanNumberOrNull(service.durationMinutes),
    price: cleanNumberOrNull(service.price),
    enabled: service.enabled !== false && service.enabled !== "false",
    scrapeDirectly:
      service.scrapeDirectly !== false && service.scrapeDirectly !== "false",
    inferenceEnabled:
      cleanBoolean(service.inferenceEnabled) || Boolean(inferenceRole),
    inferenceRole: inferenceRole || null,
    anchorServiceId,
    anchorServiceKey,
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
    metro: cleanText(
      business.metro ||
      business.market ||
      "",
      120
    ),
    enabled:
      business.enabled === false || business.enabled === "false"
        ? false
        : true,
    latitude: cleanNumberOrNull(business.latitude),
    longitude: cleanNumberOrNull(business.longitude),
    services
  };
}

async function validateAdminBusinessCategories(
  business = {}
) {
  const categorySlugs = [
    ...new Set(
      (Array.isArray(business.services)
        ? business.services
        : []
      )
        .map((service) =>
          serviceCategoryRepository
            .normalizeCategorySlug(
              service.categorySlug || ""
            )
        )
        .filter(Boolean)
    )
  ];

  for (const categorySlug of categorySlugs) {
    const category =
      await serviceCategoryRepository
        .getCategoryBySlug(categorySlug);

    if (!category) {
      const error = new Error(
        `Unknown or disabled service category: ${categorySlug}`
      );

      error.statusCode = 400;
      throw error;
    }
  }

  return business;
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
      "GET /api/admin/businesses/search",
      "GET /api/admin/businesses/facets",
      "GET /api/admin/businesses/:id",
      "GET /api/admin/service-categories",
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
      "POST /api/admin/scrape/targeted",
      "GET /api/admin/scrape/jobs",
      "GET /api/admin/scrape/jobs/:id",
      "POST /api/admin/scrape/jobs/:id/retry",
      "POST /api/admin/scrape/jobs/:id/cancel"
    ]
  });
});

router.get("/marketplace-metros", (req, res) => {
  res.json({
    success: true,
    metros:
      listMarketplaceMetros()
        .map((metro) => ({
          slug: metro.slug,
          name: metro.name,
          seoLabel:
            metro.seoLabel,
          stateCode:
            metro.stateCode,
          timezone:
            metro.timezone,
          latitude:
            metro.latitude,
          longitude:
            metro.longitude,
          mapZoom:
            metro.mapZoom,
          searchTerms:
            metro.searchTerms
        }))
  });
});

router.get("/service-categories", async (req, res) => {
  try {
    const categories =
      await serviceCategoryRepository
        .listCategories();

    res.json({
      success: true,
      source: "postgres",
      categories: categories.map(
        (category) => ({
          slug: category.slug,
          displayName:
            category.display_name,
          description:
            category.description || "",
          enabled:
            category.enabled !== false,
          sortOrder:
            Number(
              category.sort_order || 0
            )
        })
      )
    });
  } catch (error) {
    console.error(
      "[ADMIN SERVICE CATEGORIES ERROR]",
      error
    );

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/businesses", async (req, res) => {
  try {
    const metro =
      resolveAdminMetro(
        req.query.metro
      );

    const businesses =
      await businessManager
        .getAllBusinesses({
          includeDisabled: true
        });

    const filteredBusinesses =
      metro
        ? businesses.filter(
            (business) =>
              matchesMarketplaceMetro(
                business,
                metro
              )
          )
        : businesses;

    res.json({
      success: true,
      metro:
        metro?.slug || "",
      businesses:
        filteredBusinesses
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.get("/businesses/search", async (req, res) => {
  try {
    const enabledValue = String(req.query.enabled || "").trim().toLowerCase();
    const enabled = enabledValue === "true"
      ? true
      : enabledValue === "false"
        ? false
        : undefined;

    const metro =
      resolveAdminMetro(
        req.query.metro
      );

    const result = await businessManager.searchBusinesses({
      name: req.query.name || req.query.business || "",
      industry: req.query.industry || req.query.businessCategory || "",
      metro:
        metro?.slug || "",
      metroTerms:
        metro?.searchTerms || [],
      platform: req.query.platform || "",
      enabled,
      page: req.query.page,
      limit: req.query.limit
    });

    res.json({ success: true, source: "postgres", ...result });
  } catch (error) {
    console.error("[ADMIN BUSINESS SEARCH ERROR]", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/businesses/facets", async (req, res) => {
  try {
    const facets = await businessManager.getBusinessSearchFacets();
    res.json({ success: true, source: "postgres", facets });
  } catch (error) {
    console.error("[ADMIN BUSINESS FACETS ERROR]", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/businesses/:id", async (req, res, next) => {
  if (["search", "facets"].includes(String(req.params.id || "").toLowerCase())) {
    return next();
  }

  try {
    const business = await businessManager.getBusinessDetails(req.params.id);

    if (!business) {
      return res.status(404).json({ success: false, error: "Business not found." });
    }

    res.json({ success: true, source: "postgres", business });
  } catch (error) {
    console.error("[ADMIN BUSINESS DETAIL ERROR]", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/business-subscriptions/search", async (req, res) => {
  try {
    const metro =
      resolveAdminMetro(
        req.query.metro
      );

    const result = await businessManager.searchBusinessSubscriptions({
      name: req.query.name || req.query.business || "", industry: req.query.industry || "",
      metro:
        metro?.slug || "",
      metroTerms:
        metro?.searchTerms || [],
      plan: req.query.plan || "", status: req.query.status || "",
      page: req.query.page, limit: req.query.limit
    });
    res.json({ success: true, source: "postgres", ...result });
  } catch (error) {
    console.error("[ADMIN SUBSCRIPTION SEARCH ERROR]", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/claims/search", (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20) || 20));
    const name = cleanText(req.query.business || req.query.name, 300).toLowerCase();
    const owner = cleanText(req.query.owner, 300).toLowerCase();
    const email = cleanText(req.query.email, 300).toLowerCase();
    const status = cleanText(req.query.status, 80).toLowerCase();
    const filtered = loadClaims().filter((claim) => {
      if (name && !String(claim.businessName || "").toLowerCase().includes(name)) return false;
      if (owner && !String(claim.ownerName || "").toLowerCase().includes(owner)) return false;
      if (email && !String(claim.email || claim.ownerEmail || "").toLowerCase().includes(email)) return false;
      if (status && String(claim.status || "").toLowerCase() !== status) return false;
      return true;
    });
    const total = filtered.length;
    const start = (page - 1) * limit;
    res.json({ success: true, claims: filtered.slice(start, start + limit), stats: getClaimStats(), page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
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

    await validateAdminBusinessCategories(
      business
    );

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
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});


router.post("/businesses/:id/save", async (req, res) => {
  try {
    const normalizedBusiness = normalizeAdminBusiness(req.body?.business || req.body || {});
    const routeId = String(req.params.id || "").trim();

    if (!normalizedBusiness.businessName) {
      return res.status(400).json({ success: false, error: "businessName is required." });
    }

    if (!normalizedBusiness.businessId && routeId && routeId !== "new") {
      normalizedBusiness.businessId = routeId;
    }

    await validateAdminBusinessCategories(
      normalizedBusiness
    );

    const business = await businessManager.saveBusiness(normalizedBusiness);
    res.json({ success: true, source: "postgres", business });
  } catch (error) {
    console.error("[ADMIN SINGLE BUSINESS SAVE ERROR]", error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
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

      await validateAdminBusinessCategories(
        normalizedBusiness
      );

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

    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/results", async (req, res) => {
  try {
    const metro =
      resolveAdminMetro(
        req.query.metro
      );

    const result = await inventoryRepository.searchInventory({
      metroTerms:
        metro?.searchTerms || [],
      businessName: req.query.business || req.query.businessName || "", platform: req.query.platform || "",
      serviceName: req.query.service || req.query.serviceName || "", serviceCategory: req.query.serviceType || req.query.serviceCategory || "",
      targetLocalDateKey: req.query.date || "", sourceType: req.query.sourceType || "", status: req.query.status || "",
      showPast: String(req.query.showPast || "false") === "true", includeInactive: String(req.query.includeInactive || "false") === "true",
      page: req.query.page, limit: req.query.limit
    });
    res.json({ success: true, source: "postgres", ...result });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get("/errors", async (req, res) => {
  try {
    const metro =
      resolveAdminMetro(
        req.query.metro
      );

    const errors =
      await runtimeStateRepository
        .getScrapeErrors(
          500,
          {
            metroTerms:
              metro?.searchTerms ||
              []
          }
        );

    res.json({
      success: true,
      source: "postgres",
      metro:
        metro?.slug || "",
      errors
    });
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
  res.json({
    success: true,
    source: "postgres",
    count: 0,
    items: [],
    message: "The legacy file appointment cache is disabled. PostgreSQL inventory is authoritative."
  });
});

router.post("/cache/clear", async (req, res) => {
  res.json({
    success: true,
    source: "postgres",
    message: "No file cache exists to clear. PostgreSQL appointment inventory was not deleted."
  });
});

router.post("/scheduler/run-once", async (req, res) => {
  const results = await runDueSchedules({
    force: req.body?.force === true,
    requestedBy: "admin-legacy-route"
  });
  const jobsQueued = results.reduce(
    (sum, result) => sum + Number(result.jobsQueued || 0),
    0
  );

  res.status(202).json({
    success: true,
    message: `${jobsQueued} scheduled scrape job(s) queued for the background worker.`,
    jobsQueued,
    results
  });
});

router.post("/scrape/run-once", async (req, res) => {
  const body = req.body || {};
  const args = buildScrapeArgsFromBody(body);
  const settings = loadAdminSettings();

  const job = await scrapeJobRepository.enqueueJob({
    source: "admin_run_once",
    scriptName: "scrape.js",
    args,
    priority: body.queuePriority || 200,
    maxAttempts: body.maxAttempts || settings.scheduler?.jobMaxAttempts || 3,
    timeoutSeconds:
      body.timeoutSeconds || settings.scheduler?.jobTimeoutSeconds || 1800,
    requestedBy: "admin",
    requestPayload: body
  });

  res.status(202).json({
    success: true,
    message: "Scrape queued for the background worker.",
    jobId: job.id,
    job,
    args
  });
});

router.post("/scrape/targeted", async (req, res) => {
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

  const args = buildScrapeArgsFromBody({
    ...body,
    manual: body.manual !== false,
    forceRefresh: body.forceRefresh !== false
  });
  const settings = loadAdminSettings();

  const job = await scrapeJobRepository.enqueueJob({
    source: "admin_targeted",
    scriptName: "scrape.js",
    args,
    priority: body.queuePriority || 300,
    maxAttempts: body.maxAttempts || settings.scheduler?.jobMaxAttempts || 3,
    timeoutSeconds:
      body.timeoutSeconds || settings.scheduler?.jobTimeoutSeconds || 1800,
    requestedBy: "admin",
    requestPayload: body
  });

  res.status(202).json({
    success: true,
    message: "Targeted scrape queued for the background worker.",
    jobId: job.id,
    job,
    args
  });
});

router.get("/scrape/jobs", async (req, res) => {
  const jobs = await scrapeJobRepository.listJobs({
    status: req.query.status,
    source: req.query.source,
    scheduleId: req.query.scheduleId,
    limit: req.query.limit
  });
  res.json({ success: true, jobs });
});

router.get("/scrape/jobs/:id", async (req, res) => {
  const job = await scrapeJobRepository.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, error: "Scrape job not found." });
  }
  res.json({ success: true, job });
});

router.post("/scrape/jobs/:id/retry", async (req, res) => {
  const job = await scrapeJobRepository.retryJob(req.params.id);
  if (!job) {
    return res.status(409).json({
      success: false,
      error: "Only failed or cancelled scrape jobs can be retried."
    });
  }
  res.json({ success: true, job });
});

router.post("/scrape/jobs/:id/cancel", async (req, res) => {
  const job = await scrapeJobRepository.requestJobCancellation(req.params.id);
  if (!job) {
    return res.status(409).json({
      success: false,
      error: "Only queued or running scrape jobs can be cancelled."
    });
  }
  res.json({ success: true, job });
});

module.exports = router;