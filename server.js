require("dotenv").config();
const aiSearchRoutes = require("./api/aiSearchRoutes");
const { initializeAdminSettings, loadAdminSettings } = require("./adminSettingsManager");
const express = require("express");
const path = require("path");
const seoRoutes = require("./seoRoutes");
const austinSearchRoutes = require("./austinSearchRoutes");
const businessManager = require("./businessManager");
const { spawn } = require("child_process");
const { storagePath } = require("./storagePaths");
const adminRoutes = require("./adminRoutes");
const adminV2Routes = require("./api/adminV2Routes");
const businessPortalRoutes = require("./businessPortalRoutes");
const businessDashboardRoutes = require("./businessDashboardRoutes");
const analyticsRoutes = require("./analyticsRoutes");
const {
  dedupeBusinesses,
  dedupeAppointments,
  normalizeServiceType,
  normalizeBusinessesToAppointments,
  normalizeBusinessResultToAppointments
} = require("./normalizationUtils");

const { sortAppointmentsByRanking } = require("./rankingEngine");
const {
  buildSearchIntent
} = require("./searchIntentEngine");

const searchExecutionManager = null;
const {
  syncBusinessViaApi
} = safeRequire("./apiSyncRouter") || {};

const inventoryManager = require("./inventoryManager");
const serviceCategoryRepository = require("./database/serviceCategoryRepository");
const {
  getMarketplaceMetro,
  listMarketplaceMetros,
  getMarketplaceTimeZone,
  matchesMarketplaceMetro
} = require("./marketplaceMetros");
const userRepository = require("./database/userRepository");
const userRoutes = require("./userRoutes");
const adminUserRoutes = require("./adminUserRoutes");
const { startUserAlertMatcher } = require("./userAlertMatcher");
const {
  createFeedbackEntry
} = require("./chatbotFeedbackManager");
const {
  getBusinessPageDataAsync
} = require("./businessManager");
const app = express();
const PORT = 3000;
const APPOINTMENT_TIME_ZONE = "America/Chicago";

let liveSearchRunning = false;

function requireAdminAuth(req, res, next) {
  const adminUser = process.env.ADMIN_USER || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    console.error("[ADMIN AUTH] ADMIN_PASSWORD is not set.");
    return res.status(500).send("Admin password is not configured.");
  }

  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="NextAppt Admin"');
    return res.status(401).send("Admin login required.");
  }

  const encoded = authHeader.replace("Basic ", "");
  const decoded = Buffer.from(encoded, "base64").toString("utf8");

  const separatorIndex = decoded.indexOf(":");
  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  if (username !== adminUser || password !== adminPassword) {
    res.setHeader("WWW-Authenticate", 'Basic realm="NextAppt Admin"');
    return res.status(401).send("Invalid admin login.");
  }

  next();
}

app.use(express.json({ limit: "10mb" }));
app.use("/api/ai", aiSearchRoutes);
app.use(seoRoutes);
app.use(austinSearchRoutes);

app.use(
  [
    "/admin",
    "/admin.html",
    "/api/admin"
  ],
  requireAdminAuth
);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "landing.html"));
});

app.get("/ai", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ai.html"));
});

app.post("/api/email-capture", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const source = String(req.body?.source || "unknown").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: "Please enter a valid email." });
    }
    const consent =
      req.body?.consent && typeof req.body.consent === "object"
        ? req.body.consent
        : {};

    await userRepository.captureEmail({
      email,
      source,
      productUpdatesEnabled: consent.productUpdates === true
    });

    res.json({ success: true, message: "Email saved." });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use("/uploads", express.static(storagePath("public", "uploads")));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/admin/v2", adminV2Routes);
app.use("/api/admin/users", adminUserRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/user", userRoutes);
app.use("/api/business", businessPortalRoutes);
app.use("/api/business-dashboard", businessDashboardRoutes);
app.use("/api/analytics", analyticsRoutes);

app.get("/account", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "account.html"));
});

app.get("/business", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "business.html"));
});

app.get("/api/business-pages/:slug", async (req, res) => {
  try {
const businessPage = await businessManager.getBusinessPageData(
  req.params.slug,
  {
    source: "postgres"
  }
);

    if (!businessPage) {
      return res.status(404).json({
        success: false,
        error: "Business page not found."
      });
    }

    res.json({
      success: true,
      businessPage
    });
  } catch (error) {
    console.error("[BUSINESS PAGE API ERROR]", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/business/:slug", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "business-page.html"));
});

app.get("/admin", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/business-dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "business-dashboard.html"));
});
function pad2(value) {
  return String(value).padStart(2, "0");
}

function safeRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      console.warn(`[OPTIONAL MODULE] ${modulePath} not found. Legacy flow will be used.`);
      return null;
    }

    console.warn(`[OPTIONAL MODULE] ${modulePath} failed to load:`, error.message);
    return null;
  }
}

function getExecuteSearchFunction() {
  if (!searchExecutionManager) return null;

  if (typeof searchExecutionManager === "function") {
    return searchExecutionManager;
  }

  if (typeof searchExecutionManager.executeSearch === "function") {
    return searchExecutionManager.executeSearch;
  }

  if (typeof searchExecutionManager.runSearch === "function") {
    return searchExecutionManager.runSearch;
  }

  if (typeof searchExecutionManager.search === "function") {
    return searchExecutionManager.search;
  }

  return null;
}

function getBusinessConfigByName(businessName) {
  const businesses = businessManager.getAllBusinessesSync();

  if (!Array.isArray(businesses)) {
    return null;
  }

  const target = normalizeBusinessKey(businessName);

  return (
    businesses.find((business) => {
      return normalizeBusinessKey(
        business.businessName || business.name
      ) === target;
    }) || null
  );
}

function applyInferenceToAppointments(appointments = [], options = {}) {
  const inventory = Array.isArray(appointments) ? appointments : [];

  if (options.includeInferred === false) {
    return inventory.filter(
      (appointment) =>
        String(appointment.sourceType || "").toLowerCase() !== "inferred"
    );
  }

  return inventory;
}

function mergeBusinessesForNormalization(primaryBusinesses, cacheBusinesses) {
  const combined = [];

  const pushBusiness = (business) => {
    if (!business || typeof business !== "object") return;
    combined.push(business);
  };

  (Array.isArray(primaryBusinesses) ? primaryBusinesses : []).forEach(pushBusiness);
  (Array.isArray(cacheBusinesses) ? cacheBusinesses : []).forEach(pushBusiness);

  return combined;
}

function normalizeBusinessKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function slugifyBusinessName(value = "") {
  return String(value || "business")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 90) || "business";
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function businessMatchesSearch(business = {}, businessSearch = "") {
  const target = normalizeSearchText(businessSearch);

  if (!target) {
    return true;
  }

  const businessName = normalizeSearchText(
    business.businessName || business.name || ""
  );

  const aliases = Array.isArray(business.searchAliases)
    ? business.searchAliases.map(normalizeSearchText)
    : [];

  const searchableText = normalizeSearchText(
    [
      business.businessName,
      business.name,
      business.displayName,
      business.publicName,
      business.shortName,
      business.brandName,
      business.keywords,
      business.address,
      ...aliases
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (!businessName && !searchableText) {
    return false;
  }

  if (searchableText.includes(target)) {
    return true;
  }

  if (businessName && target.includes(businessName)) {
    return true;
  }

  const genericWords = new Set([
    "massage",
    "massages",
    "wellness",
    "therapy",
    "therapies",
    "spa",
    "studio",
    "lab",
    "clinic",
    "center",
    "centre",
    "athletic",
    "athlete",
    "the",
    "and",
    "austin",
    "tx",
    "texas"
  ]);

  const targetWords = target
    .split(" ")
    .filter((word) => word.length > 2)
    .filter((word) => !genericWords.has(word));

  if (!targetWords.length) {
    return false;
  }

  return targetWords.some((word) => searchableText.includes(word));
}
function buildBusinessMetadataMap() {
  const businessConfig = businessManager.getAllBusinessesSync({ includeDisabled: true });
  const map = {};

  if (!Array.isArray(businessConfig)) {
    return map;
  }

  businessConfig.forEach((business) => {
    const key = normalizeBusinessKey(business.businessName || business.name);

    if (!key) return;

     map[key] = {
  address: business.address || "",
  metro:
    business.metro ||
    business.market ||
    business.region ||
    "",
  city: business.city || "",
  state: business.state || "",
  postalCode:
    business.postalCode ||
    business.postal_code ||
    "",
  timezone:
    business.timezone ||
    "America/Chicago",
  platform: business.platform || "",
  bookingUrl: business.bookingUrl || "",
  latitude:
    business.latitude !== undefined &&
    business.latitude !== null &&
    business.latitude !== ""
      ? Number(business.latitude)
      : null,
  longitude:
    business.longitude !== undefined &&
    business.longitude !== null &&
    business.longitude !== ""
      ? Number(business.longitude)
      : null,
  logoUrl: business.logoUrl || "",
  logoAlt: business.logoAlt || "",
  claimed: business.claimed === true,
  verificationStatus: business.verificationStatus || "unclaimed",
  claimedByEmail: business.claimedByEmail || "",
  claimId: business.claimId || "",
  businessCategory: business.businessCategory || "wellness",

  businessSlug:
    business.businessSlug ||
    business.slug ||
    slugifyBusinessName(business.businessName || business.name || ""),

  enabled: business.enabled !== false,
  businessEnabled: business.enabled !== false,
  subscriptionPlan: business.subscriptionPlan || "",
  subscriptionStatus: business.subscriptionStatus || "",

  businessUrl:
    business.businessUrl ||
    `/business/${
      business.businessSlug ||
      business.slug ||
      slugifyBusinessName(business.businessName || business.name || "")
    }`,
  reviewSummary: business.reviewSummary || null,
  activeDeal: business.activeDeal || null,
  publicProfile: business.publicProfile || null
};
  });

  return map;
}

function getNowPartsInAppointmentTimezone(
  timeZone = APPOINTMENT_TIME_ZONE
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const map = {};

  parts.forEach((part) => {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  });

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute)
  };
}

function getCurrentLocalSortable(
  timeZone = APPOINTMENT_TIME_ZONE
) {
  const now =
    getNowPartsInAppointmentTimezone(
      timeZone
    );

  return Number(
    `${now.year}${pad2(now.month)}${pad2(now.day)}${pad2(now.hour)}${pad2(now.minute)}`
  );
}

function parseTimeToParts(timeText) {
  if (!timeText) return null;

  const cleaned = String(timeText).trim();

  const normalMatch = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (normalMatch) {
    let hour = Number(normalMatch[1]);
    const minute = Number(normalMatch[2]);
    const ampm = normalMatch[3].toUpperCase();

    if (ampm === "PM" && hour !== 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;

    return { hour, minute };
  }

  const isoMatch = cleaned.match(/T(\d{1,2}):(\d{2})/);
  if (isoMatch) {
    return {
      hour: Number(isoMatch[1]),
      minute: Number(isoMatch[2])
    };
  }

  return null;
}

function formatTimeDisplay(hour, minute) {
  const suffix = hour >= 12 ? "PM" : "AM";
  let displayHour = hour % 12;

  if (displayHour === 0) displayHour = 12;

  return `${displayHour}:${pad2(minute)} ${suffix}`;
}

function formatDisplayDateFromParts(year, month, day) {
  const dateObj = new Date(year, month - 1, day);

  return dateObj.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function parseDateToParts(dateText, platform = "") {
  if (!dateText) return null;

  const cleaned = String(dateText).trim();

  if (cleaned.includes("T")) {
    const dateOnly = cleaned.split("T")[0];
    const parts = dateOnly.split("-");

    if (parts.length === 3) {
      return {
        year: Number(parts[0]),
        month: Number(parts[1]),
        day: Number(parts[2])
      };
    }
  }

  if (platform === "axl3" && /^\d{1,2}$/.test(cleaned)) {
    const now = getNowPartsInAppointmentTimezone();

    let year = now.year;
    let month = now.month;
    const day = Number(cleaned);

    if (day < now.day - 7) {
      month += 1;

      if (month > 12) {
        month = 1;
        year += 1;
      }
    }

    return { year, month, day };
  }

  const parsed = new Date(cleaned);

  if (!Number.isNaN(parsed.getTime())) {
    return {
      year: parsed.getFullYear(),
      month: parsed.getMonth() + 1,
      day: parsed.getDate()
    };
  }

  return null;
}

function buildLocalFields(dateText, timeText, platform = "") {
  const dateParts = parseDateToParts(dateText, platform);
  const timeParts = parseTimeToParts(timeText);

  if (!dateParts || !timeParts) {
  return {
    localDateKey: "",
    localTimeKey: "",
    localSortable: null,
    displayDate: dateParts ? dateText || "" : "",
    displayTime: timeText || "",
    startTime: ""
  };
}

  const localDateKey = `${dateParts.year}-${pad2(dateParts.month)}-${pad2(
    dateParts.day
  )}`;
  const localTimeKey = `${pad2(timeParts.hour)}:${pad2(timeParts.minute)}`;

  const localSortable = Number(
    `${dateParts.year}${pad2(dateParts.month)}${pad2(dateParts.day)}${pad2(
      timeParts.hour
    )}${pad2(timeParts.minute)}`
  );

  return {
    localDateKey,
    localTimeKey,
    localSortable,
    displayDate: formatDisplayDateFromParts(
      dateParts.year,
      dateParts.month,
      dateParts.day
    ),
    displayTime: formatTimeDisplay(timeParts.hour, timeParts.minute),
    startTime: `${localDateKey}T${localTimeKey}:00`
  };
}

function extractDurationMinutes(serviceName = "") {
  const match = String(serviceName).match(/(\d+)\s*(minute|min)/i);
  return match ? Number(match[1]) : null;
}

function determineServiceCategory(serviceName = "") {
  const text = String(serviceName).toLowerCase();

  if (text.includes("swedish")) return "swedish";
  if (text.includes("deep tissue") || text.includes("deep")) return "deep_tissue";
  if (text.includes("sports")) return "sports";
  if (text.includes("prenatal") || text.includes("pregnancy")) return "prenatal";
  if (text.includes("ashiatsu")) return "ashiatsu";
  if (text.includes("lomi")) return "lomi_lomi";
  if (text.includes("relaxation")) return "relaxation";
  if (text.includes("massage")) return "massage";
  if (text.includes("haircut") || text.includes("hair")) return "hair";
  if (text.includes("facial")) return "facial";

  return "other";
}

function mergeBusinessMetadata(business, metadataMap) {
  const key = normalizeBusinessKey(business.businessName || business.name);
  const metadata = metadataMap[key] || {};

  return {
    ...business,
    address: business.address || metadata.address || "",
    latitude:
      business.latitude !== undefined &&
      business.latitude !== null &&
      business.latitude !== ""
        ? Number(business.latitude)
        : metadata.latitude ?? null,
    longitude:
      business.longitude !== undefined &&
      business.longitude !== null &&
      business.longitude !== ""
        ? Number(business.longitude)
        : metadata.longitude ?? null,
       logoUrl: business.logoUrl || metadata.logoUrl || "",
    logoAlt:
      business.logoAlt ||
      metadata.logoAlt ||
      business.businessName ||
      business.name ||
      "",
    claimed:
      business.claimed === true || metadata.claimed === true,
    verificationStatus:
      business.verificationStatus ||
      metadata.verificationStatus ||
      "unclaimed",
    claimedByEmail:
      business.claimedByEmail || metadata.claimedByEmail || "",
    claimId:
      business.claimId || metadata.claimId || "",
businessCategory:
  business.businessCategory || metadata.businessCategory || "wellness",

businessSlug:
  business.businessSlug ||
  metadata.businessSlug ||
  slugifyBusinessName(business.businessName || business.name || ""),

businessUrl:
  business.businessUrl ||
  metadata.businessUrl ||
  `/business/${
    business.businessSlug ||
    metadata.businessSlug ||
    slugifyBusinessName(business.businessName || business.name || "")
  }`,

reviewSummary:
  business.reviewSummary || metadata.reviewSummary || null,

activeDeal:
  business.activeDeal || metadata.activeDeal || null,

publicProfile:
  business.publicProfile || metadata.publicProfile || null,

enabled:
  business.enabled !== undefined ? business.enabled !== false : metadata.enabled !== false,
businessEnabled:
  business.businessEnabled !== undefined ? business.businessEnabled !== false : metadata.businessEnabled !== false,
subscriptionPlan:
  business.subscriptionPlan || metadata.subscriptionPlan || "",
subscriptionStatus:
  business.subscriptionStatus || metadata.subscriptionStatus || ""
  };
}

function normalizeExistingAppointment(business, appointment = {}) {
  return {
    ...appointment,

    businessName:
      appointment.businessName ||
      business.businessName ||
      business.name ||
      "Unknown Business",

    businessCategory:
      appointment.businessCategory ||
      business.businessCategory ||
      "wellness",

    platform:
      appointment.platform ||
      business.platform ||
      "unknown",

    bookingUrl:
      appointment.bookingUrl ||
      business.bookingUrl ||
      "",

    address:
      appointment.address ||
      business.address ||
      "",

    latitude:
      appointment.latitude ?? business.latitude ?? null,

    longitude:
      appointment.longitude ?? business.longitude ?? null,

    logoUrl:
      appointment.logoUrl ||
      business.logoUrl ||
      "",

    logoAlt:
      appointment.logoAlt ||
      business.logoAlt ||
      appointment.businessName ||
      business.businessName ||
      business.name ||
      "",

    claimed:
      appointment.claimed === true || business.claimed === true,

    verificationStatus:
      appointment.verificationStatus ||
      business.verificationStatus ||
      "unclaimed",

    claimedByEmail:
      appointment.claimedByEmail ||
      business.claimedByEmail ||
      "",

    claimId:
      appointment.claimId ||
      business.claimId ||
      "",

    businessSlug:
      appointment.businessSlug ||
      business.businessSlug ||
      "",

    businessUrl:
      appointment.businessUrl ||
      business.businessUrl ||
      "",

    reviewSummary:
      appointment.reviewSummary ||
      business.reviewSummary ||
      null,

    activeDeal:
      appointment.activeDeal ||
      business.activeDeal ||
      null,

    publicProfile:
      appointment.publicProfile ||
      business.publicProfile ||
      null,

    enabled:
      appointment.enabled !== undefined ? appointment.enabled !== false : business.enabled !== false,
    businessEnabled:
      appointment.businessEnabled !== undefined ? appointment.businessEnabled !== false : business.businessEnabled !== false,
    subscriptionPlan:
      appointment.subscriptionPlan || business.subscriptionPlan || "",
    subscriptionStatus:
      appointment.subscriptionStatus || business.subscriptionStatus || ""
  };
}

function normalizeOpeningResult(business, opening) {
  const platform = business.platform || opening.platform || "unknown";

  const rawDate =
    opening.date || opening.appointmentDate || business.date || "";

  const rawTime =
    opening.time || opening.startTime || opening.appointmentTime || "";

  const serviceName =
    opening.serviceName ||
    opening.service ||
    business.serviceName ||
    business.service ||
    "";

  const local = buildLocalFields(rawDate, rawTime, platform);

  return {
    businessName: business.businessName || business.name || "Unknown Business",
    businessCategory: business.businessCategory || "wellness",
    platform,
    bookingUrl: business.bookingUrl || opening.bookingUrl || "",
    serviceName,
    serviceCategory:
      business.serviceType ||
      opening.serviceType ||
      determineServiceCategory(serviceName),
    durationMinutes:
      business.durationMinutes ||
      opening.durationMinutes ||
      extractDurationMinutes(serviceName),
    therapistName:
      opening.therapistName ||
      opening.staffName ||
      opening.employeeName ||
      opening.providerName ||
      business.provider ||
      business.providerText ||
      "",
    date: local.displayDate,
    time: local.displayTime,
    startTime: local.startTime,
    endTime: opening.endTime || "",
    price: opening.price || business.price || null,
    latitude: business.latitude ?? null,
    longitude: business.longitude ?? null,
    address: business.address || "",
    logoUrl: business.logoUrl || "",
    logoAlt: business.logoAlt || "",
    claimed: business.claimed === true,
    verificationStatus: business.verificationStatus || "unclaimed",
    claimedByEmail: business.claimedByEmail || "",
    claimId: business.claimId || "",
    businessSlug: business.businessSlug || "",
    businessUrl: business.businessUrl || "",
    reviewSummary: business.reviewSummary || null,
    activeDeal: business.activeDeal || null,
    publicProfile: business.publicProfile || null,
    sourceStatus: business.status || "unknown",
    localDateKey: local.localDateKey,
    localTimeKey: local.localTimeKey,
    localSortable: local.localSortable,
    rawDate,
    rawTime
  };
}

function normalizeTimesResult(business, time) {
  const platform = business.platform || "unknown";
  const serviceName = business.serviceName || business.service || "";

  const businessDate =
    typeof business.date === "string"
      ? business.date.trim()
      : "";

  const businessDateLooksLikeTime =
    /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(businessDate);

  const safeBusinessDate =
    businessDateLooksLikeTime ? "" : businessDate;

  const local = buildLocalFields(safeBusinessDate, time, platform);

  return {
    businessName: business.businessName || business.name || "Unknown Business",
    businessCategory: business.businessCategory || "wellness",
    platform,
    bookingUrl: business.bookingUrl || "",
    serviceName,
    serviceCategory: business.serviceType || determineServiceCategory(serviceName),
    durationMinutes:
      business.durationMinutes || extractDurationMinutes(serviceName),
    therapistName: business.provider || business.providerText || "",
    date: local.displayDate,
    time: local.displayTime,
    startTime: local.startTime,
    endTime: "",
    price: business.price || null,
    latitude: business.latitude ?? null,
    longitude: business.longitude ?? null,
    address: business.address || "",
    logoUrl: business.logoUrl || "",
    logoAlt: business.logoAlt || "",
    claimed: business.claimed === true,
    verificationStatus: business.verificationStatus || "unclaimed",
    claimedByEmail: business.claimedByEmail || "",
    claimId: business.claimId || "",
    businessSlug: business.businessSlug || "",
    businessUrl: business.businessUrl || "",
    reviewSummary: business.reviewSummary || null,
    activeDeal: business.activeDeal || null,
    publicProfile: business.publicProfile || null,
    sourceStatus: business.status || "unknown",
    localDateKey: local.localDateKey,
    localTimeKey: local.localTimeKey,
    localSortable: local.localSortable,
    rawDate: safeBusinessDate,
    rawTime: time
  };
}

function getAppointmentsFromBusiness(business) {
  if (!business || typeof business !== "object") return [];

  if (Array.isArray(business.appointments) && business.appointments.length > 0) {
  return business.appointments.map((appointment) => {
    if (
      appointment.localDateKey ||
      appointment.localTimeKey ||
      appointment.startTime ||
      appointment.sourceType
    ) {
      return normalizeExistingAppointment(business, appointment);
    }

    return normalizeOpeningResult(business, appointment);
  });
}

  if (Array.isArray(business.appointments) && business.appointments.length > 0) {
    return business.appointments.map((opening) =>
      normalizeOpeningResult(business, opening)
    );
  }

  if (Array.isArray(business.results) && business.results.length > 0) {
    return business.results.map((opening) =>
      normalizeOpeningResult(business, opening)
    );
  }

  if (Array.isArray(business.availability) && business.availability.length > 0) {
    return business.availability.map((opening) =>
      normalizeOpeningResult(business, opening)
    );
  }

  if (
    business.data &&
    Array.isArray(business.data.openings) &&
    business.data.openings.length > 0
  ) {
    return business.data.openings.map((opening) =>
      normalizeOpeningResult(business, opening)
    );
  }

  if (
    business.data &&
    Array.isArray(business.data.appointments) &&
    business.data.appointments.length > 0
  ) {
    return business.data.appointments.map((opening) =>
      normalizeOpeningResult(business, opening)
    );
  }

  if (Array.isArray(business.times) && business.times.length > 0) {
    return business.times.map((time) => normalizeTimesResult(business, time));
  }

  return [];
}

function evaluateAppointmentTiming(appointment) {
  if (!appointment.localSortable) {
    return {
      ...appointment,
      timingStatus: "unknown",
      shouldDisplay: true,
      normalizationWarning: "Missing local date/time - kept for review"
    };
  }

  const nowSortable = getCurrentLocalSortable();

  if (appointment.localSortable <= nowSortable) {
    return {
      ...appointment,
      timingStatus: "past",
      shouldDisplay: false,
      normalizationWarning: "Definitely past local appointment"
    };
  }

  return {
    ...appointment,
    timingStatus: "future",
    shouldDisplay: true,
    normalizationWarning: ""
  };
}

function getDateKeyFromParts(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function addDaysToLocalDate(daysToAdd) {
  const now = getNowPartsInAppointmentTimezone();

  const date = new Date(
    now.year,
    now.month - 1,
    now.day + daysToAdd,
    12,
    0,
    0
  );

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    localDateKey: getDateKeyFromParts(
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate()
    )
  };
}

function parseUserDateIntent(searchText = "") {
  const text = normalizeSearchText(searchText);
  const now = getNowPartsInAppointmentTimezone();

  if (/\btoday\b/.test(text)) {
    return addDaysToLocalDate(0);
  }

  if (/\btomorrow\b/.test(text)) {
    return addDaysToLocalDate(1);
  }

  const monthMap = {
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sep: 9,
    sept: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12
  };

  const monthNames = Object.keys(monthMap).join("|");

  const monthDayMatch = text.match(
    new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(st|nd|rd|th)?\\b`)
  );

  if (monthDayMatch) {
    const month = monthMap[monthDayMatch[1]];
    const day = Number(monthDayMatch[2]);
    let year = now.year;

    const candidate = new Date(year, month - 1, day, 12, 0, 0);
    const today = new Date(now.year, now.month - 1, now.day, 0, 0, 0);

    if (candidate < today) {
      year += 1;
    }

    return {
      year,
      month,
      day,
      localDateKey: getDateKeyFromParts(year, month, day)
    };
  }

  const slashDateMatch = text.match(/\b(\d{1,2})\/(\d{1,2})(\/(\d{2,4}))?\b/);

  if (slashDateMatch) {
    const month = Number(slashDateMatch[1]);
    const day = Number(slashDateMatch[2]);
    let year = slashDateMatch[4] ? Number(slashDateMatch[4]) : now.year;

    if (year < 100) {
      year += 2000;
    }

    const candidate = new Date(year, month - 1, day, 12, 0, 0);
    const today = new Date(now.year, now.month - 1, now.day, 0, 0, 0);

    if (!slashDateMatch[4] && candidate < today) {
      year += 1;
    }

    return {
      year,
      month,
      day,
      localDateKey: getDateKeyFromParts(year, month, day)
    };
  }

  return null;
}

function parseLooseTimeToKey(rawHour, rawMinute = "0", rawAmPm = "") {
  let hour = Number(rawHour);
  const minute = Number(rawMinute || 0);
  const ampm = String(rawAmPm || "").toLowerCase();

  if (ampm === "pm" && hour !== 12) {
    hour += 12;
  }

  if (ampm === "am" && hour === 12) {
    hour = 0;
  }

  return `${pad2(hour)}:${pad2(minute)}`;
}

function parseUserTimeWindowIntent(searchText = "") {
  const text = normalizeSearchText(searchText);

  const betweenMatch = text.match(
    /\bbetween\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(and|to|-)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/
  );

  if (betweenMatch) {
    const startAmPm = betweenMatch[3] || betweenMatch[7] || "";
    const endAmPm = betweenMatch[7] || betweenMatch[3] || "";

    return {
      startTimeKey: parseLooseTimeToKey(
        betweenMatch[1],
        betweenMatch[2] || "0",
        startAmPm
      ),
      endTimeKey: parseLooseTimeToKey(
        betweenMatch[5],
        betweenMatch[6] || "0",
        endAmPm
      )
    };
  }

  const dashMatch = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/
  );

  if (dashMatch) {
    const startAmPm = dashMatch[3] || dashMatch[6] || "";
    const endAmPm = dashMatch[6] || dashMatch[3] || "";

    return {
      startTimeKey: parseLooseTimeToKey(
        dashMatch[1],
        dashMatch[2] || "0",
        startAmPm
      ),
      endTimeKey: parseLooseTimeToKey(
        dashMatch[4],
        dashMatch[5] || "0",
        endAmPm
      )
    };
  }

  const afterMatch = text.match(
    /\bafter\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/
  );

  if (afterMatch) {
    return {
      startTimeKey: parseLooseTimeToKey(
        afterMatch[1],
        afterMatch[2] || "0",
        afterMatch[3] || ""
      ),
      endTimeKey: ""
    };
  }

  const beforeMatch = text.match(
    /\bbefore\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/
  );

  if (beforeMatch) {
    return {
      startTimeKey: "",
      endTimeKey: parseLooseTimeToKey(
        beforeMatch[1],
        beforeMatch[2] || "0",
        beforeMatch[3] || ""
      )
    };
  }

  return {
    startTimeKey: "",
    endTimeKey: ""
  };
}

function removeDateTimeWordsFromSearch(searchText = "") {
  return normalizeSearchText(searchText)
    .replace(/\b(today|tomorrow|tonight|now|asap|between|after|before|from|to|and|on|for|at)\b/g, " ")
    .replace(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b/g, " ")
    .replace(/\b\d{1,2}(st|nd|rd|th)?\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ")
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)?\s*(-|to|and)\s*\d{1,2}(:\d{2})?\s*(am|pm)?\b/g, " ")
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferSearchIntent(query = {}) {
  return buildSearchIntent({
    search: query.search || "",
    serviceCategory:
      query.serviceCategory || "",
    duration:
      query.duration || "",
    durationMinutes:
      query.durationMinutes || ""
  });
}

function appointmentMatchesIntentDateTime(appointment, intent) {
  if (intent.targetLocalDateKey) {
    if (appointment.localDateKey !== intent.targetLocalDateKey) {
      return false;
    }
  }

  if (intent.startTimeKey) {
    if (!appointment.localTimeKey || appointment.localTimeKey < intent.startTimeKey) {
      return false;
    }
  }

  if (intent.endTimeKey) {
    if (!appointment.localTimeKey || appointment.localTimeKey > intent.endTimeKey) {
      return false;
    }
  }

  return true;
}

function appointmentMatchesQuery(appointment, query) {
  const intent = inferSearchIntent(query);

  const business = query.business ? normalizeSearchText(query.business) : "";
  const platform = query.platform ? normalizeSearchText(query.platform) : "";
  const service = intent.service ? normalizeSearchText(intent.service) : "";
  const serviceCategory = intent.serviceCategory
    ? normalizeSearchText(intent.serviceCategory)
    : "";
  const duration =
  intent.durationMinutes
    ? Number(intent.durationMinutes)
    : intent.duration
      ? Number(intent.duration)
      : null;

const targetDateKey = intent.targetDateKey || "";
const startTimeKey = intent.startTimeKey || "";
const endTimeKey = intent.endTimeKey || "";
  const search = intent.cleanedSearch || "";

  const appointmentServiceCategory = normalizeSearchText(
    appointment.serviceCategory || determineServiceCategory(appointment.serviceName)
  );

  const text = normalizeSearchText(
    [
      appointment.businessName,
      appointment.platform,
      appointment.serviceName,
      appointment.therapistName,
      appointment.date,
      appointment.time,
      appointment.serviceCategory,
      appointment.categorySlug,
      appointment.marketplaceCategory,
      query.categoryMatchedAlias,
      appointment.durationMinutes,
      appointment.address
    ].join(" ")
  );

  if (!appointmentMatchesIntentDateTime(appointment, intent)) {
    return false;
  }

  if (business && !normalizeSearchText(appointment.businessName).includes(business)) {
    return false;
  }

  if (platform && normalizeSearchText(appointment.platform) !== platform) {
    return false;
  }

  if (
    query.metro &&
    !matchesMarketplaceMetro(
      appointment,
      query.metro
    )
  ) {
    return false;
  }

  if (duration && Number(appointment.durationMinutes) !== duration) {
    return false;
  }
if (targetDateKey && appointment.localDateKey !== targetDateKey) {
  return false;
}

if (
  startTimeKey &&
  appointment.localTimeKey &&
  appointment.localTimeKey < startTimeKey
) {
  return false;
}

if (
  endTimeKey &&
  appointment.localTimeKey &&
  appointment.localTimeKey > endTimeKey
) {
  return false;
}
  if (serviceCategory) {
    const broadMassageCategories = new Set([
      "massage",
      "swedish",
      "relaxation",
      "deep_tissue",
      "sports",
      "prenatal",
      "ashiatsu",
      "lomi_lomi",
      "trigger_point",
      "myofascial_release"
    ]);

    const categoryMatches =
      serviceCategory === "massage"
        ? broadMassageCategories.has(appointmentServiceCategory) ||
          text.includes("massage")
        : appointmentServiceCategory === serviceCategory ||
          appointmentServiceCategory.includes(serviceCategory) ||
          text.includes(serviceCategory);

    if (!categoryMatches) return false;
  }

  if (service) {
    const normalizedService = normalizeServiceType(service);

    const serviceMatches =
      appointmentServiceCategory === normalizedService ||
      text.includes(normalizedService.replace(/_/g, " ")) ||
      text.includes(normalizedService);

    if (!serviceMatches) {
      return false;
    }
  }

  if (search) {
    const searchWithoutDuration = normalizeSearchText(
      search.replace(
        /\b(30|45|50|60|80|90|110|120)\s*(minute|min|minutes|mins|hour|hr|hrs)?\b/g,
        ""
      )
    );

    const looseWords = searchWithoutDuration
      .split(" ")
      .filter((word) => word.length > 2)
      .filter(
        (word) =>
          ![
            "minute",
            "minutes",
            "mins",
            "hour",
            "hours",
            "massage",
            "today",
            "tomorrow",
            "tonight",
            "near",
            "me",
            "appointment",
            "appointments",
            "available",
            "availability",
            "this",
            "morning",
            "afternoon",
            "evening",
            "need",
            "find",
            "looking",
            "please"
          ].includes(word)
      );

    const allWordsMatch = looseWords.every((word) => text.includes(word));

    if (looseWords.length > 0 && !allWordsMatch) {
      return false;
    }
  }

  return true;
}

function appointmentWithinHours(
  appointment,
  hours,
  query = {}
) {
  if (!hours) return true;

  const parsedHours = Number(hours);
  if (!parsedHours || Number.isNaN(parsedHours)) return true;

  if (!appointment.localSortable) return true;

  const nowParts =
    getNowPartsInAppointmentTimezone(
      appointment.timezone ||
      getMarketplaceTimeZone(
        query.metro
      )
    );
  const nowDate = new Date(
    nowParts.year,
    nowParts.month - 1,
    nowParts.day,
    nowParts.hour,
    nowParts.minute,
    0
  );

  const cutoff = new Date(nowDate.getTime() + parsedHours * 60 * 60 * 1000);

  const cutoffSortable = Number(
    `${cutoff.getFullYear()}${pad2(cutoff.getMonth() + 1)}${pad2(
      cutoff.getDate()
    )}${pad2(cutoff.getHours())}${pad2(cutoff.getMinutes())}`
  );

  const nowSortable = getCurrentLocalSortable();

  return (
    appointment.localSortable >= nowSortable &&
    appointment.localSortable <= cutoffSortable
  );
}

function sortAppointments(appointments) {
  return appointments.sort((a, b) => {
    if (!a.localSortable && !b.localSortable) return 0;
    if (!a.localSortable) return 1;
    if (!b.localSortable) return -1;
    return a.localSortable - b.localSortable;
  });
}

function limitAppointmentsPerBusiness(appointments, limitPerBusiness) {
  const limit = Number(limitPerBusiness);
  if (!limit || Number.isNaN(limit)) return appointments;

  const counts = {};
  const limited = [];

  appointments.forEach((appointment) => {
    const key = appointment.businessName || "Unknown Business";
    counts[key] = counts[key] || 0;

    if (counts[key] < limit) {
      limited.push(appointment);
      counts[key] += 1;
    }
  });

  return limited;
}

function dedupeAppointmentsByStrictTimeKey(appointments = []) {
  const seen = new Set();

  return appointments.filter((appointment) => {
    const key = [
      appointment.businessName || "",
      appointment.therapistName || "",
      appointment.serviceName || appointment.service || "",
      appointment.serviceCategory || appointment.serviceType || "",
      appointment.durationMinutes || "",
      appointment.startTime || "",
      appointment.rawTime || "",
      appointment.time || ""
    ]
      .map((value) => String(value).toLowerCase().trim())
      .join("|");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}


function extractDateKeyFromValue(value) {
  if (!value) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  const raw = String(value).trim();

  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  if (/^\d{1,2}:\d{2}/.test(raw)) {
    return "";
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime()) && /[a-zA-Z]/.test(raw)) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }

  return "";
}

function extractTimeKeyFromValue(value) {
  if (!value) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
  }

  const raw = String(value).trim();

  const ampmMatch = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const minute = Number(ampmMatch[2]);
    const ampm = ampmMatch[3].toUpperCase();

    if (ampm === "PM" && hour !== 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;

    return `${pad2(hour)}:${pad2(minute)}`;
  }

  const isoMatch = raw.match(/T(\d{1,2}):(\d{2})/);
  if (isoMatch) return `${pad2(isoMatch[1])}:${pad2(isoMatch[2])}`;

  const plainMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (plainMatch) return `${pad2(plainMatch[1])}:${pad2(plainMatch[2])}`;

  return "";
}

function buildSortableFromKeys(localDateKey, localTimeKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(localDateKey || ""))) return null;
  if (!/^\d{2}:\d{2}$/.test(String(localTimeKey || ""))) return null;

  return Number(
    `${localDateKey.replace(/-/g, "")}${localTimeKey.replace(":", "")}`
  );
}

function displayDateFromDateKey(localDateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(localDateKey || ""))) return "";

  const [year, month, day] = localDateKey.split("-").map(Number);
  return formatDisplayDateFromParts(year, month, day);
}

function displayTimeFromTimeKey(localTimeKey) {
  if (!/^\d{2}:\d{2}$/.test(String(localTimeKey || ""))) return "";

  const [hour, minute] = localTimeKey.split(":").map(Number);
  return formatTimeDisplay(hour, minute);
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isUsableCoordinate(latitude, longitude) {
  const lat = parseOptionalNumber(latitude);
  const lon = parseOptionalNumber(longitude);

  if (lat === null || lon === null) return false;
  if (lat === 0 && lon === 0) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;

  return true;
}

function normalizeInventoryAppointment(rawAppointment = {}, metadataMap = {}) {
  const businessName =
    rawAppointment.businessName ||
    rawAppointment.business_name ||
    rawAppointment.name ||
    "Unknown Business";

  const metadata = metadataMap[normalizeBusinessKey(businessName)] || {};

  const localDateKey =
    rawAppointment.localDateKey ||
    rawAppointment.local_date_key ||
    extractDateKeyFromValue(rawAppointment.localDate || rawAppointment.local_date) ||
    extractDateKeyFromValue(rawAppointment.appointmentDate || rawAppointment.appointment_date) ||
    extractDateKeyFromValue(rawAppointment.date) ||
    extractDateKeyFromValue(rawAppointment.startTime || rawAppointment.start_time);

  const localTimeKey =
    rawAppointment.localTimeKey ||
    rawAppointment.local_time_key ||
    extractTimeKeyFromValue(rawAppointment.localTime || rawAppointment.local_time) ||
    extractTimeKeyFromValue(rawAppointment.time) ||
    extractTimeKeyFromValue(rawAppointment.startTime || rawAppointment.start_time);

  const localSortable =
    parseOptionalNumber(rawAppointment.localSortable || rawAppointment.local_sortable) ||
    buildSortableFromKeys(localDateKey, localTimeKey);

  const rawLatitude = rawAppointment.latitude ?? rawAppointment.lat ?? null;
  const rawLongitude = rawAppointment.longitude ?? rawAppointment.lng ?? rawAppointment.lon ?? null;
  const useRawCoordinates = isUsableCoordinate(rawLatitude, rawLongitude);
  const useMetadataCoordinates = isUsableCoordinate(metadata.latitude, metadata.longitude);

  const latitude = useRawCoordinates
    ? Number(rawLatitude)
    : useMetadataCoordinates
      ? Number(metadata.latitude)
      : null;

  const longitude = useRawCoordinates
    ? Number(rawLongitude)
    : useMetadataCoordinates
      ? Number(metadata.longitude)
      : null;

  const categorySlug =
    serviceCategoryRepository.normalizeCategorySlug(
      rawAppointment.categorySlug ||
      rawAppointment.category_slug ||
      rawAppointment.marketplaceCategory ||
      rawAppointment.marketplace_category ||
      ""
    );

  return {
    ...rawAppointment,
    businessName,
    businessCategory:
      rawAppointment.businessCategory ||
      rawAppointment.business_category ||
      metadata.businessCategory ||
      "wellness",
    platform: rawAppointment.platform || metadata.platform || "unknown",
    bookingUrl: rawAppointment.bookingUrl || rawAppointment.booking_url || metadata.bookingUrl || "",
    serviceName:
      rawAppointment.serviceName ||
      rawAppointment.service_name ||
      rawAppointment.service ||
      "",
    categorySlug,
    marketplaceCategory: categorySlug,
    serviceCategory:
      rawAppointment.serviceCategory ||
      rawAppointment.service_category ||
      rawAppointment.serviceType ||
      rawAppointment.service_type ||
      determineServiceCategory(rawAppointment.serviceName || rawAppointment.service_name || ""),
    serviceType:
      rawAppointment.serviceType ||
      rawAppointment.service_type ||
      rawAppointment.serviceCategory ||
      rawAppointment.service_category ||
      "",
    durationMinutes:
      parseOptionalNumber(rawAppointment.durationMinutes || rawAppointment.duration_minutes) ||
      extractDurationMinutes(rawAppointment.serviceName || rawAppointment.service_name || ""),
    therapistName:
      rawAppointment.therapistName ||
      rawAppointment.therapist_name ||
      rawAppointment.providerName ||
      rawAppointment.provider_name ||
      rawAppointment.staffName ||
      rawAppointment.staff_name ||
      "",
    date: rawAppointment.date || displayDateFromDateKey(localDateKey),
    time: rawAppointment.time || displayTimeFromTimeKey(localTimeKey),
    startTime:
      rawAppointment.startTime ||
      rawAppointment.start_time ||
      (localDateKey && localTimeKey ? `${localDateKey}T${localTimeKey}:00` : ""),
    endTime: rawAppointment.endTime || rawAppointment.end_time || "",
    price: rawAppointment.price || rawAppointment.servicePrice || rawAppointment.service_price || null,
    latitude,
    longitude,
    address:
      rawAppointment.address ||
      metadata.address ||
      "",
    metro:
      rawAppointment.metro ||
      rawAppointment.metro_name ||
      metadata.metro ||
      "",
    city:
      rawAppointment.city ||
      metadata.city ||
      "",
    state:
      rawAppointment.state ||
      metadata.state ||
      "",
    postalCode:
      rawAppointment.postalCode ||
      rawAppointment.postal_code ||
      metadata.postalCode ||
      "",
    timezone:
      rawAppointment.timezone ||
      metadata.timezone ||
      getMarketplaceTimeZone(
        rawAppointment.metro ||
        metadata.metro ||
        ""
      ),
    logoUrl: rawAppointment.logoUrl || rawAppointment.logo_url || metadata.logoUrl || "",
    logoAlt: rawAppointment.logoAlt || rawAppointment.logo_alt || metadata.logoAlt || `${businessName} logo`,
    claimed: rawAppointment.claimed === true || metadata.claimed === true,
    verificationStatus:
      rawAppointment.verificationStatus ||
      rawAppointment.verification_status ||
      metadata.verificationStatus ||
      "unclaimed",
    claimedByEmail:
      rawAppointment.claimedByEmail ||
      rawAppointment.claimed_by_email ||
      metadata.claimedByEmail ||
      "",
    claimId: rawAppointment.claimId || rawAppointment.claim_id || metadata.claimId || "",
    businessSlug: rawAppointment.businessSlug || rawAppointment.business_slug || metadata.businessSlug || "",
    businessUrl: rawAppointment.businessUrl || rawAppointment.business_url || metadata.businessUrl || "",
    reviewSummary: rawAppointment.reviewSummary || rawAppointment.review_summary || metadata.reviewSummary || null,
    activeDeal: rawAppointment.activeDeal || rawAppointment.active_deal || metadata.activeDeal || null,
    publicProfile: rawAppointment.publicProfile || rawAppointment.public_profile || metadata.publicProfile || null,
    sourceType: rawAppointment.sourceType || rawAppointment.source_type || "confirmed",
    sourceStatus: rawAppointment.sourceStatus || rawAppointment.source_status || rawAppointment.status || "active",
    localDateKey,
    localTimeKey,
    localSortable,
    rawDate: rawAppointment.rawDate || rawAppointment.raw_date || localDateKey,
    rawTime: rawAppointment.rawTime || rawAppointment.raw_time || localTimeKey
  };
}

function unpackInventoryPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  return (
    payload.appointments ||
    payload.inventory ||
    payload.rows ||
    payload.results ||
    payload.data ||
    []
  );
}

function shouldDisplayAppointmentNow(appointment = {}, query = {}) {
  if (query.showPast === "true") return true;
  if (!appointment.localSortable) {
    return query.showInvalidDates === "true";
  }

  const timeZone =
    appointment.timezone ||
    getMarketplaceTimeZone(
      query.metro
    );

  return (
    appointment.localSortable >
    getCurrentLocalSortable(
      timeZone
    )
  );
}

function getInventoryFiltersForSearch(query = {}, intent = {}) {
  return {
    business: query.business || "",
    platform: query.platform || "",
    categorySlug:
      query.categorySlug ||
      query.category ||
      query.marketplaceCategory ||
      "",
    serviceCategory: query.serviceCategory || query.serviceType || intent.serviceCategory || "",
    serviceType: query.serviceType || query.serviceCategory || intent.serviceCategory || "",
    durationMinutes: query.durationMinutes || query.duration || intent.duration || null,
    hours: query.hours || intent.hours || "",
    limit: query.limit || 5000,
    limitPerBusiness: query.limitPerBusiness || 999,
    includeInactive: true,
    includeInferred: query.includeInferred !== "false",
    includeConfirmed: query.includeConfirmed !== "false"
  };
}

async function loadNormalizedAppointments(query, options = {}) {
  const intent = inferSearchIntent(query);
  const metadataMap = buildBusinessMetadataMap();

  const inventoryPayload = await inventoryManager.getInventory(
    getInventoryFiltersForSearch(query, intent)
  );

  let appointments = unpackInventoryPayload(inventoryPayload).map((appointment) =>
    normalizeInventoryAppointment(appointment, metadataMap)
  );

  const totalAppointmentsBeforeTimingEvaluation = appointments.length;

  appointments = appointments.map(evaluateAppointmentTiming);

  const timingBreakdownBeforeFilters = appointments.reduce((summary, appointment) => {
    const key = appointment.timingStatus || "unknown";
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});

  appointments = appointments.filter((appointment) =>
    shouldDisplayAppointmentNow(appointment, query)
  );

  appointments = appointments.filter((appointment) =>
    appointmentMatchesQuery(appointment, query)
  );

  appointments = appointments.filter((appointment) =>
    appointmentWithinHours(
      appointment,
      query.hours ||
        intent.hours,
      query
    )
  );

  appointments = dedupeAppointments(appointments);
  appointments = dedupeAppointmentsByStrictTimeKey(appointments);

  appointments = sortAppointmentsByRanking(
    appointments,
    query
  );

  appointments = limitAppointmentsPerBusiness(
    appointments,
    query.limitPerBusiness || 999
  );

  const timingBreakdown = appointments.reduce((summary, appointment) => {
    const key = appointment.timingStatus || "unknown";
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});

  const businessMap = new Map();

  appointments.forEach((appointment) => {
    const key = appointment.businessName || "Unknown Business";

    if (!businessMap.has(key)) {
      businessMap.set(key, {
        businessName: key,
        name: key,
        platform: appointment.platform || "unknown",
        status: appointment.sourceStatus || appointment.status || "active",
        address: appointment.address || "",
        latitude: appointment.latitude ?? null,
        longitude: appointment.longitude ?? null,
        logoUrl: appointment.logoUrl || "",
        logoAlt: appointment.logoAlt || "",
        claimed: appointment.claimed === true,
        verificationStatus: appointment.verificationStatus || "unclaimed",
        claimedByEmail: appointment.claimedByEmail || "",
        claimId: appointment.claimId || "",
        businessSlug: appointment.businessSlug || "",
        businessUrl: appointment.businessUrl || "",
        reviewSummary: appointment.reviewSummary || null,
        activeDeal: appointment.activeDeal || null,
        publicProfile: appointment.publicProfile || null,
        appointments: []
      });
    }

    businessMap.get(key).appointments.push(appointment);
  });

  const businesses = [...businessMap.values()];

  return {
    missingResultsFile: false,
    businesses,
    appointments,
    totalAppointmentsBeforeTimingEvaluation,
    timingBreakdown,
    timingBreakdownBeforeFilters,
    cacheBusinessesLoaded: 0
  };
}

function serviceMatchesIntent(service, query) {
  const intent = inferSearchIntent(query);
  const search = normalizeSearchText(query.search || "");
  const serviceName = normalizeSearchText(service.serviceName || "");
  const serviceType = normalizeSearchText(service.serviceType || "");
  const serviceText = normalizeSearchText(
    [
      service.serviceName,
      service.serviceType,
      service.categorySlug,
      service.marketplaceCategory,
      query.categoryMatchedAlias,
      service.durationMinutes,
      service.platformServiceId,
      service.serviceButtonId
    ].join(" ")
  );

  if (service.enabled === false) return false;

  if (intent.duration && Number(service.durationMinutes) !== Number(intent.duration)) {
    return false;
  }

  if (intent.serviceCategory) {
    const category = normalizeSearchText(intent.serviceCategory);

    const categoryMatches =
      serviceType === category ||
      serviceType.includes(category) ||
      serviceName.includes(category) ||
      serviceText.includes(category);

    if (!categoryMatches) return false;
  }

  if (intent.service) {
    const serviceQuery = normalizeSearchText(intent.service);

    const serviceMatches =
      serviceType.includes(serviceQuery) ||
      serviceName.includes(serviceQuery) ||
      serviceText.includes(serviceQuery);

    if (!serviceMatches) return false;
  }

  if (search) {
    const durationRemoved = normalizeSearchText(
      search.replace(
        /\b(30|45|50|60|80|90|110|120)\s*(minute|min|minutes|mins|hour|hr|hrs)?\b/g,
        ""
      )
    );

    const words = durationRemoved
      .split(" ")
      .filter((word) => word.length > 2)
      .filter(
        (word) =>
          ![
            "minute",
            "minutes",
            "mins",
            "hour",
            "hours",
            "massage",
            "today",
            "tonight",
            "near",
            "me"
          ].includes(word)
      );

    if (words.length > 0 && !words.every((word) => serviceText.includes(word))) {
      return false;
    }
  }

  return true;
}

function getRequestedCategorySlug(query = {}) {
  return serviceCategoryRepository.normalizeCategorySlug(
    query.categorySlug ||
    query.category ||
    query.marketplaceCategory ||
    ""
  );
}

async function resolveRequestedCategory(query = {}) {
  const explicitCategorySlug =
    getRequestedCategorySlug(query);

  if (explicitCategorySlug) {
    const category =
      await serviceCategoryRepository
        .getCategoryBySlug(
          explicitCategorySlug
        );

    return {
      categorySlug:
        explicitCategorySlug,
      category,
      source: "explicit",
      matchedAlias: ""
    };
  }

  const inferred =
    await serviceCategoryRepository
      .inferCategoryFromText(
        query.search ||
        query.query ||
        ""
      );

  if (!inferred) {
    return {
      categorySlug: "",
      category: null,
      source: "",
      matchedAlias: ""
    };
  }

  return {
    categorySlug:
      inferred.categorySlug,
    category:
      inferred.category,
    source: "inferred",
    matchedAlias:
      inferred.matchedAlias
  };
}

app.get("/api/settings/public", (req, res) => {
  const settings = loadAdminSettings();

  res.json({
    success: true,
    searchEnabled: settings.searchEnabled !== false
  });
});

app.get("/api/marketplace-metros", (req, res) => {
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
          path:
            `/${metro.slug}`
        }))
  });
});

app.get("/api/service-categories", async (req, res) => {
  try {
    const requestedMetro =
      String(
        req.query.metro || ""
      ).trim();

    const metroSelection =
      requestedMetro
        ? getMarketplaceMetro(
            requestedMetro
          )
        : null;

    if (
      requestedMetro &&
      !metroSelection
    ) {
      return res
        .status(404)
        .json({
          success: false,
          error:
            "Unknown marketplace metro.",
          metro:
            requestedMetro
        });
    }

    const [
      categories,
      categoryCounts
    ] = await Promise.all([
      serviceCategoryRepository
        .listCategories(),
      serviceCategoryRepository
        .getCategoryBusinessCounts({
          metroTerms:
            metroSelection
              ?.searchTerms ||
            []
        })
    ]);

    const countsBySlug =
      new Map(
        categoryCounts.map(
          (row) => [
            row.slug,
            Number(
              row.business_count ||
              0
            )
          ]
        )
      );

    res.json({
      success: true,
      metro:
        metroSelection?.slug ||
        "",
      metroName:
        metroSelection?.name ||
        "",
      categories:
        categories.map(
          (category) => ({
            slug:
              category.slug,
            displayName:
              category.display_name,
            description:
              category.description ||
              "",
            searchAliases:
              Array.isArray(
                category.search_aliases
              )
                ? category.search_aliases
                : [],
            enabled:
              category.enabled !==
              false,
            sortOrder:
              Number(
                category.sort_order ||
                0
              ),
            businessCount:
              countsBySlug.get(
                category.slug
              ) || 0
          })
        )
    });
  } catch (error) {
    console.error(
      "SERVICE CATEGORY API ERROR:",
      error
    );

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const categorySelection =
      await resolveRequestedCategory(req.query);

    if (
      categorySelection.categorySlug &&
      !categorySelection.category
    ) {
      return res.status(404).json({
        success: false,
        error: "Unknown or disabled service category.",
        categorySlug: categorySelection.categorySlug
      });
    }

    const requestedMetro =
      String(
        req.query.metro || ""
      ).trim();

    const metroSelection =
      requestedMetro
        ? getMarketplaceMetro(
            requestedMetro
          )
        : null;

    if (
      requestedMetro &&
      !metroSelection
    ) {
      return res
        .status(404)
        .json({
          success: false,
          error:
            "Unknown marketplace metro.",
          metro:
            requestedMetro
        });
    }

    const searchQuery = {
      ...req.query,
      metro:
        metroSelection?.slug ||
        "",
      categorySlug:
        categorySelection.categorySlug,
      categoryMatchedAlias:
        categorySelection.matchedAlias
    };

    const orchestrationSummary = {
      databaseOnly: true,
      usedOrchestration: false,
      reason: "Public searches read PostgreSQL inventory only."
    };

    const scrapeSummary = {
      databaseOnly: true,
      publicScrapingDisabled: true,
      targetsAttempted: 0,
      targets: []
    };

    const {
      missingResultsFile,
      businesses,
      appointments,
      totalAppointmentsBeforeTimingEvaluation,
      timingBreakdown,
      cacheBusinessesLoaded
    } = await loadNormalizedAppointments(searchQuery, {
  includeAppointmentCache: false
});

    if (missingResultsFile) {
      return res.status(404).json({
        success: false,
        error: "PostgreSQL appointment inventory is not available"
      });
    }

    const totalBusinesses = new Set(
      appointments.map((appointment) => appointment.businessName)
    ).size;

    const intent = inferSearchIntent(searchQuery);

    res.json({
      success: true,
      endpoint: "/api/search",
      metro: metroSelection
        ? {
            slug:
              metroSelection.slug,
            name:
              metroSelection.name,
            timezone:
              metroSelection.timezone
          }
        : null,
      category: categorySelection.category
        ? {
            slug: categorySelection.category.slug,
            displayName:
              categorySelection.category.display_name,
            description:
              categorySelection.category.description || ""
          }
        : null,
      categorySource:
        categorySelection.source || "",
      categoryMatchedAlias:
        categorySelection.matchedAlias || "",
      appointmentTimeZone: getMarketplaceTimeZone(req.query.metro),
      liveSearchRunning,
      inferredIntent: intent,
      orchestrationSummary,
      scrapeSummary,
      cacheBusinessesLoaded: cacheBusinessesLoaded || 0,
      totalBusinessesInResults: businesses.length,
      totalBusinesses,
      totalAppointmentsBeforeTimingEvaluation,
      currentLocalSortable: getCurrentLocalSortable(
        getMarketplaceTimeZone(req.query.metro)
      ),
      timingBreakdown,
      totalAppointments: appointments.length,
      filtersApplied: {
        metro:
          metroSelection?.slug ||
          "",
        search: req.query.search || "",
        business: req.query.business || "",
        platform: req.query.platform || "",
        categorySlug: categorySelection.categorySlug,
        categorySource:
          categorySelection.source || "",
        categoryMatchedAlias:
          categorySelection.matchedAlias || "",
        service: req.query.service || intent.service || "",
        serviceCategory: req.query.serviceCategory || intent.serviceCategory || "",
        duration: req.query.duration || intent.duration || "",
        hours: req.query.hours || intent.hours || "",
        limitPerBusiness: req.query.limitPerBusiness || 999,
        showInvalidDates: req.query.showInvalidDates === "true",
        showPast: req.query.showPast === "true",
        databaseOnly: true
      },
      businessesFound: businesses.map((business) => {
        const businessAppointments =
          normalizeBusinessResultToAppointments(business);

        return {
          businessName:
            business.businessName || business.name || "Unknown Business",
          platform: business.platform || "unknown",
          status: business.status || "unknown",
          address: business.address || "",
          latitude: business.latitude ?? null,
          longitude: business.longitude ?? null,
          logoUrl: business.logoUrl || "",
          logoAlt: business.logoAlt || "",
          claimed: business.claimed === true,
          verificationStatus: business.verificationStatus || "unclaimed",
          claimedByEmail: business.claimedByEmail || "",
          claimId: business.claimId || "",
          appointmentsReturnedBeforeFilters: businessAppointments.length
        };
      }),
      appointments
    });
  } catch (error) {
    console.error("SEARCH API ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
    app.get("/api/appointments", async (req, res) => {

  try {
    const {
      missingResultsFile,
      businesses,
      appointments,
      totalAppointmentsBeforeTimingEvaluation,
      timingBreakdown
   } = await loadNormalizedAppointments(req.query);

    if (missingResultsFile) {
      return res.status(404).json({
        success: false,
        error: "PostgreSQL appointment inventory is not available"
      });
    }

const includeInferred = req.query.includeInferred !== "false";

const responseAppointments = applyInferenceToAppointments(appointments, {
  includeInferred
});

const inferredAppointmentCount = responseAppointments.filter((appointment) => {
  return appointment.sourceType === "inferred";
}).length;

res.json({
  success: true,
  appointmentTimeZone: getMarketplaceTimeZone(req.query.metro),
  totalBusinessesInResults: businesses.length,
  totalAppointmentsBeforeTimingEvaluation,
  currentLocalSortable: getCurrentLocalSortable(
        getMarketplaceTimeZone(req.query.metro)
      ),
  timingBreakdown,
  totalAppointments: responseAppointments.length,
  confirmedAppointments: appointments.length,
  inferredAppointments: inferredAppointmentCount,
  filtersApplied: {
    search: req.query.search || "",
    business: req.query.business || "",
    platform: req.query.platform || "",
    service: req.query.service || "",
    serviceCategory: req.query.serviceCategory || "",
    duration: req.query.duration || "",
    hours: req.query.hours || "",
    limitPerBusiness: req.query.limitPerBusiness || 999,
    showInvalidDates: req.query.showInvalidDates === "true",
    showPast: req.query.showPast === "true",
    includeInferred
  },
  businessesFound: businesses.map((business) => {
    const businessAppointments =
      normalizeBusinessResultToAppointments(
        business
      );

    return {
      businessName:
        business.businessName || business.name || "Unknown Business",
      platform: business.platform || "unknown",
      status: business.status || "unknown",
      address: business.address || "",
      latitude: business.latitude ?? null,
      longitude: business.longitude ?? null,
      logoUrl: business.logoUrl || "",
      appointmentsReturnedBeforeFilters: businessAppointments.length
    };
  }),
  appointments: responseAppointments
});
  } catch (error) {
    console.error("API ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/chatbot-feedback", (req, res) => {
  try {
    const entry = createFeedbackEntry({
  aiVersion: req.body.aiVersion || "v1",

  rating: req.body.rating,
  feedbackText: req.body.feedbackText,

  prompt: req.body.prompt,
  normalizedPrompt: req.body.normalizedPrompt,

  assistantAnswer: req.body.assistantAnswer,

  intent: req.body.intent || req.body.inferredIntent,
  inferredIntent: req.body.inferredIntent,

  appointmentsShown: req.body.appointmentsShown,
  searchResultsSnapshot: req.body.searchResultsSnapshot,

  appointmentClicked: req.body.appointmentClicked,

  page: req.body.page,
  userAgent: req.headers["user-agent"] || ""
});

    res.json({
      success: true,
      feedbackId: entry.id
    });

  } catch (error) {
    console.error("[CHATBOT FEEDBACK]", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


async function warmBusinessCache() {
  try {
    await businessManager.getAllBusinesses({
      includeDisabled: true,
      source: "postgres"
    });
    console.log("[BUSINESS MANAGER] Business cache warmed from PostgreSQL.");
  } catch (error) {
    console.warn("[BUSINESS MANAGER] Business cache warm-up failed:", error.message);
  }
}

async function initializeRuntime() {
  await initializeAdminSettings();
  await warmBusinessCache();
  startUserAlertMatcher();
}

initializeRuntime().then(() => app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("=================================");
  console.log(" Massage Aggregator Running");
  console.log(` http://localhost:${PORT}`);
  console.log(" Timezone: America/Chicago");
  console.log(" Metadata: PostgreSQL business metadata merged into inventory");
  console.log(" Admin Portal: /admin");
  console.log(" Search API: /api/search");
  console.log(" Search source: PostgreSQL inventory only");
  console.log("=================================");
  console.log("");
})).catch((error) => {
  console.error("[STARTUP] Failed:", error);
  process.exit(1);
});