require("dotenv").config();

const { loadAdminSettings } = require("./adminSettingsManager");
const express = require("express");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const {
  storagePath,
  readJson,
  writeJsonAtomic
} = require("./storagePaths");
const adminRoutes = require("./adminRoutes");
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

// Optional orchestration modules created in the newer cache/search architecture.
// These are loaded defensively so the older results.json flow keeps working
// even if one of the new files is not present yet.
const searchExecutionManager = safeRequire("./searchExecutionManager");
const {
  syncBusinessViaApi
} = safeRequire("./apiSyncRouter") || {};
const {
  upsertBusinessResult
} = require("./resultStore");
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

app.get("/austin/massage", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use("/uploads", express.static(storagePath("public", "uploads")));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/admin", adminRoutes);
app.use("/api/business", businessPortalRoutes);
app.use("/api/business-dashboard", businessDashboardRoutes);
app.use("/api/analytics", analyticsRoutes);

app.get("/business", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "business.html"));
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

function readJsonFile(fileName, fallback) {
  const persistentFiles = new Set([
  "results.json",
  "errorLogs.json",
  "search-locks.json",
  path.join("cache", "appointment-cache.json")
]);

const filePath = persistentFiles.has(fileName)
  ? storagePath(fileName)
  : path.join(__dirname, fileName);

  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Failed to read ${fileName}:`, error.message);
    return fallback;
  }
}

function writeJsonFile(fileName, data) {
  const persistentFiles = new Set([
    "results.json",
    "errorLogs.json",
    "search-locks.json",
    path.join("cache", "appointment-cache.json")
  ]);

  const filePath = persistentFiles.has(fileName)
    ? storagePath(fileName)
    : path.join(__dirname, fileName);

  if (persistentFiles.has(fileName)) {
    writeJsonAtomic(filePath, data);
    return;
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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

function readJsonPath(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Failed to read ${filePath}:`, error.message);
    return fallback;
  }
}

function findExistingCacheFiles() {
  const candidates = [
    "appointment-cache.json",
    "appointmentCache.json",
    path.join("cache", "appointment-cache.json"),
    path.join("cache", "appointmentCache.json"),
    path.join("data", "appointment-cache.json"),
    path.join("data", "appointmentCache.json")
  ];

  return candidates
    .map((fileName) => path.join(__dirname, fileName))
    .filter((filePath) => fs.existsSync(filePath));
}

function looksLikeAppointmentRecord(item) {
  if (!item || typeof item !== "object") return false;

  return Boolean(
    item.businessName ||
      item.name ||
      item.time ||
      item.startTime ||
      item.appointmentTime ||
      item.date ||
      item.appointmentDate ||
      item.serviceName ||
      item.service
  );
}

function extractBusinessesFromCachePayload(payload) {
  if (!payload) return [];

  if (Array.isArray(payload)) {
    if (
      payload.some(
        (item) =>
          item &&
          (item.openings ||
            item.appointments ||
            item.results ||
            item.availability ||
            item.times)
      )
    ) {
      return payload;
    }

    if (payload.some(looksLikeAppointmentRecord)) {
      return [
        {
          businessName: "Cached Appointments",
          platform: "cache",
          status: "success",
          appointments: payload
        }
      ];
    }

    return [];
  }

  const directBusinessArrays = [
    payload.businesses,
    payload.results,
    payload.data && payload.data.businesses,
    payload.data && payload.data.results
  ];

  for (const value of directBusinessArrays) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  const directAppointmentArrays = [
    payload.appointments,
    payload.openings,
    payload.availability,
    payload.data && payload.data.appointments,
    payload.data && payload.data.openings,
    payload.data && payload.data.availability
  ];

  for (const value of directAppointmentArrays) {
    if (Array.isArray(value)) {
      return [
        {
          businessName: "Cached Appointments",
          platform: "cache",
          status: "success",
          appointments: value
        }
      ];
    }
  }

  if (typeof payload === "object") {
    const values = Object.values(payload).filter(Boolean);
    const businesses = [];

    values.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;

      if (Array.isArray(entry.businesses) || Array.isArray(entry.results)) {
        businesses.push(...extractBusinessesFromCachePayload(entry));
        return;
      }

      if (
        Array.isArray(entry.appointments) ||
        Array.isArray(entry.openings) ||
        Array.isArray(entry.availability) ||
        Array.isArray(entry.times)
      ) {
        businesses.push(entry);
      }
    });

    return businesses;
  }

  return [];
}

function loadCacheBusinesses() {
  const cacheFiles = findExistingCacheFiles();
  let businesses = [];

  cacheFiles.forEach((filePath) => {
    const payload = readJsonPath(filePath, null);
    businesses.push(...extractBusinessesFromCachePayload(payload));
  });

  return businesses;
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

async function runOrchestratedSearchIfAvailable(query) {
  const settings = loadAdminSettings();

  const onDemand = String(query.onDemand || "") === "true";
  const searchEnabled = settings.searchEnabled !== false;
  const onDemandEnabled =
    settings.scraping?.onDemandEnabled !== false &&
    settings.onDemand?.enabled !== false;
  const useOrchestration =
    onDemand ||
    String(query.useOrchestration || "") === "true" ||
    String(query.orchestrated || "") === "true";

  const summary = {
    onDemand,
    useOrchestration,
    orchestrationAvailable: false,
    usedOrchestration: false,
    fallbackUsed: false,
    error: null,
    result: null
  };

  if (!useOrchestration) {
    return summary;
  }
  if (!searchEnabled || !onDemandEnabled) {
    summary.skippedBecauseSearchDisabled = !searchEnabled;
    summary.skippedBecauseOnDemandDisabled = !onDemandEnabled;
    summary.error = "Live search skipped by admin settings.";
    return summary;
  }
  const executeSearch = getExecuteSearchFunction();

  if (!executeSearch) {
    summary.fallbackUsed = true;
    summary.error = "searchExecutionManager executeSearch function not available";
    return summary;
  }

  summary.orchestrationAvailable = true;

  try {
    const intent = inferSearchIntent(query);

    const result = await executeSearch({
      ...query,
      ...intent,
      rawSearch: intent.rawSearch || query.search || "",
      search: query.search || intent.search || "",
      onDemand: true
    });

    summary.usedOrchestration = true;
    summary.result = result || null;

    return summary;
  } catch (error) {
    console.error("[ORCHESTRATED SEARCH] Failed:", error);
    summary.error = error.message;
    summary.fallbackUsed = true;
    return summary;
  }
}

function normalizeBusinessKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
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
  const businessConfig = readJsonFile("businesses.json", []);
  const map = {};

  if (!Array.isArray(businessConfig)) {
    return map;
  }

  businessConfig.forEach((business) => {
    const key = normalizeBusinessKey(business.businessName || business.name);

    if (!key) return;

        map[key] = {
      address: business.address || "",
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
      businessCategory: business.businessCategory || "wellness"
    };
  });

  return map;
}

function getNowPartsInAppointmentTimezone() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APPOINTMENT_TIME_ZONE,
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

function getCurrentLocalSortable() {
  const now = getNowPartsInAppointmentTimezone();

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
      business.businessCategory || metadata.businessCategory || "wellness"
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

  if (Array.isArray(business.openings) && business.openings.length > 0) {
    return business.openings.map((opening) =>
      normalizeOpeningResult(business, opening)
    );
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
    const categoryMatches =
      appointmentServiceCategory === serviceCategory ||
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
            "availability"
          ].includes(word)
      );

    const allWordsMatch = looseWords.every((word) => text.includes(word));

    if (looseWords.length > 0 && !allWordsMatch) {
      return false;
    }
  }

  return true;
}

function appointmentWithinHours(appointment, hours) {
  if (!hours) return true;

  const parsedHours = Number(hours);
  if (!parsedHours || Number.isNaN(parsedHours)) return true;

  if (!appointment.localSortable) return true;

  const nowParts = getNowPartsInAppointmentTimezone();
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

function loadNormalizedAppointments(query, options = {}) {
  const includeAppointmentCache =
    options.includeAppointmentCache === true ||
    String(query.includeAppointmentCache || "") === "true" ||
    String(query.onDemand || "") === "true" ||
    String(query.useOrchestration || "") === "true" ||
    String(query.orchestrated || "") === "true";

  const resultsPath = storagePath("results.json");
  const hasResultsFile = fs.existsSync(resultsPath);
  const cacheBusinesses = includeAppointmentCache ? loadCacheBusinesses() : [];

  if (!hasResultsFile) {
    return {
      missingResultsFile: true,
      businesses: [],
      appointments: [],
      totalAppointmentsBeforeTimingEvaluation: 0,
      timingBreakdown: {},
      cacheBusinessesLoaded: 0
    };
  }

  const businessMetadataMap = buildBusinessMetadataMap();
  const parsed = hasResultsFile ? readJsonFile("results.json", []) : [];

  let businessesFromResults = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.results)
      ? parsed.results
      : Array.isArray(parsed.businesses)
        ? parsed.businesses
        : [];

let businesses = dedupeBusinesses(
  mergeBusinessesForNormalization(
    businessesFromResults,
    cacheBusinesses
  )
);

  businesses = businesses.map((business) =>
    mergeBusinessMetadata(business, businessMetadataMap)
  );

 let appointments = businesses.flatMap((business) =>
  getAppointmentsFromBusiness(business)
);

  const totalAppointmentsBeforeTimingEvaluation = appointments.length;

  appointments = appointments.map(evaluateAppointmentTiming);

  const timingBreakdown = appointments.reduce((summary, appointment) => {
    const key = appointment.timingStatus || "unknown";
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});

  appointments = appointments.filter((appointment) => {
    if (query.showPast === "true") return true;

    if (query.showInvalidDates === "true") {
      return appointment.shouldDisplay || appointment.timingStatus === "unknown";
    }

    return appointment.shouldDisplay;
  });

  appointments = appointments.filter((appointment) =>
    appointmentMatchesQuery(appointment, query)
  );

  const intent = inferSearchIntent(query);
  appointments = appointments.filter((appointment) =>
    appointmentWithinHours(appointment, query.hours || intent.hours)
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

  return {
    missingResultsFile: false,
    businesses,
    appointments,
    totalAppointmentsBeforeTimingEvaluation,
    timingBreakdown,
    cacheBusinessesLoaded: cacheBusinesses.length
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

function buildLiveSearchTargets(query) {
  const businesses = readJsonFile("businesses.json", []);

  if (!Array.isArray(businesses)) {
    return [];
  }

  const businessFilter = normalizeSearchText(query.business || "");
  const platformFilter = normalizeSearchText(query.platform || "");
  const targets = [];

  businesses
    .filter((business) => business.enabled !== false)
    .forEach((business) => {
      const businessName = business.businessName || business.name || "";

  if (businessFilter && !businessMatchesSearch(business, businessFilter)) {
  return;
}

      if (platformFilter && normalizeSearchText(business.platform) !== platformFilter) {
        return;
      }

      const services =
        Array.isArray(business.services) && business.services.length
          ? business.services
          : [
              {
                serviceName: business.serviceName || business.service || "",
                serviceType: business.serviceType || "",
                durationMinutes:
                  business.durationMinutes ||
                  extractDurationMinutes(
                    business.serviceName || business.service || ""
                  ),
                platformServiceId:
                  business.platformServiceId ||
                  business.serviceId ||
                  business.serviceButtonId ||
                  "",
                serviceButtonId: business.serviceButtonId || "",
                enabled: true
              }
            ];

      const matchingServices = services.filter((service) =>
        serviceMatchesIntent(service, query)
      );

      matchingServices.forEach((service) => {
        targets.push({
          business,
          service,
          businessName,
          platform: business.platform || "",
          serviceName: service.serviceName || business.serviceName || "",
          serviceType: service.serviceType || business.serviceType || "",
          durationMinutes:
            service.durationMinutes ||
            business.durationMinutes ||
            extractDurationMinutes(service.serviceName || business.serviceName || "")
        });
      });
    });

  return targets.slice(0, 8);
}

function getResultKey(result = {}) {
  return [
    result.businessName || "",
    result.platform || "",
    result.serviceName || result.service || "",
    result.serviceType || "",
    result.durationMinutes || "",
    result.platformServiceId || result.serviceId || result.serviceButtonId || "",
    result.provider || ""
  ]
    .map((value) => normalizeSearchText(value))
    .join("||");
}

function mergeResultsByKey(existingResults, incomingResults) {
  const existing = Array.isArray(existingResults) ? existingResults : [];
  const incoming = Array.isArray(incomingResults) ? incomingResults : [];

  const incomingKeys = new Set(incoming.map(getResultKey));

  const preserved = existing.filter((item) => !incomingKeys.has(getResultKey(item)));

  return [...preserved, ...incoming];
}

async function runLiveScrapeTarget(target) {
  return new Promise(async (resolve) => {
    const businessName = target.businessName;
    const integrationType = target.business?.integrationType || "";
    const platform = target.platform || "";
    const serviceName = target.serviceName || "";
    const serviceType = target.serviceType || "";
    const durationMinutes = target.durationMinutes || "";

    if (!businessName) {
      return resolve({
        businessName: "",
        platform,
        serviceName,
        success: false,
        error: "Missing business name"
      });
    }

    if (integrationType === "api") {
  console.log("");
  console.log("[LIVE SEARCH API]");
  console.log(
    `Using API integration for ${businessName}`
  );

  try {
    const appointments =
      await syncBusinessViaApi(target);

    const normalizedBusinessResult = {
      businessName,
      platform:
        target.platform || "api",
      status: "success",
      integrationType: "api",
      appointments
    };

upsertBusinessResult(
  normalizedBusinessResult
);

    return resolve({
  businessName,
  platform: target.platform,
  integrationType: "api",
  success: true,
  appointmentsReturned: appointments.length
});
  } catch (error) {
    console.error(
      "[LIVE SEARCH API ERROR]",
      error
    );

   return resolve({
  businessName,
  platform: target.platform,
  integrationType: "api",
  success: false,
  error: error.message
});
  }
}
    const args = [
      "scrape.js",
      `--business=${businessName}`,
      "--manual=true",
      "--forceRefresh=true"
    ];

    if (platform) {
      args.push(`--platform=${platform}`);
    }

    if (serviceName) {
      args.push(`--service=${serviceName}`);
    } else if (serviceType) {
      args.push(`--service=${serviceType}`);
    }

    if (durationMinutes) {
      args.push(`--duration=${durationMinutes}`);
    }

    console.log("");
    console.log("[LIVE SEARCH] Starting service-level on-demand scrape");
    console.log("[LIVE SEARCH] Business:", businessName);
    console.log("[LIVE SEARCH] Platform:", platform || "any");
    console.log("[LIVE SEARCH] Service:", serviceName || serviceType || "any");
    console.log("[LIVE SEARCH] Duration:", durationMinutes || "any");
    console.log("[LIVE SEARCH] Command:", `node ${args.join(" ")}`);

    const child = spawn("node", args, {
      cwd: __dirname,
      stdio: "inherit",
      shell: false
    });

    child.on("error", (error) => {
      console.error("[LIVE SEARCH] Failed to start scrape:", error.message);

      resolve({
        businessName,
        platform,
        serviceName,
        durationMinutes,
        success: false,
        error: error.message
      });
    });

    child.on("close", (code) => {
      console.log(
        `[LIVE SEARCH] Finished ${businessName} | ${serviceName} with exit code ${code}`
      );

      resolve({
        businessName,
        platform,
        serviceName,
        durationMinutes,
        success: code === 0,
        exitCode: code
      });
    });
  });
}

async function runLiveSearchIfRequested(query) {
  const settings = loadAdminSettings();

  const onDemand = String(query.onDemand || "") === "true";
  const searchEnabled = settings.searchEnabled !== false;
  const onDemandEnabled =
    settings.scraping?.onDemandEnabled !== false &&
    settings.onDemand?.enabled !== false;

  const summary = {
    onDemand,
    skippedBecauseAlreadyRunning: false,
    startedInBackground: false,
    targetsAttempted: 0,
    targets: []
  };

  if (!onDemand) {
    return summary;
  }
  if (!searchEnabled || !onDemandEnabled) {
    summary.skippedBecauseSearchDisabled = !searchEnabled;
    summary.skippedBecauseOnDemandDisabled = !onDemandEnabled;
    return summary;
  }
  if (liveSearchRunning) {
    summary.skippedBecauseAlreadyRunning = true;
    return summary;
  }

  const targets = buildLiveSearchTargets(query);
  summary.targetsAttempted = targets.length;
  summary.startedInBackground = true;

  liveSearchRunning = true;

  (async () => {
    try {
      const originalResults = readJsonFile("results.json", []);
      let mergedResults = Array.isArray(originalResults) ? originalResults : [];

      for (const target of targets) {
        const result = await runLiveScrapeTarget(target);

        const latestResults = readJsonFile("results.json", []);
        const latestArray = Array.isArray(latestResults) ? latestResults : [];

        mergedResults = mergeResultsByKey(mergedResults, latestArray);
        writeJsonFile("results.json", mergedResults);

        console.log("[LIVE SEARCH] Progressive result saved:", {
          businessName: result.businessName,
          serviceName: result.serviceName,
          integrationType: result.integrationType || "",
          success: result.success
        });
      }
    } catch (error) {
      console.error("[LIVE SEARCH BACKGROUND ERROR]", error);
    } finally {
      liveSearchRunning = false;
    }
  })();

  return summary;
}
app.get("/api/settings/public", (req, res) => {
  const settings = loadAdminSettings();

  res.json({
    success: true,
    searchEnabled: settings.searchEnabled !== false
  });
});
app.get("/api/search", async (req, res) => {
  try {
    const orchestrationSummary = await runOrchestratedSearchIfAvailable(req.query);

    let scrapeSummary = {
      onDemand: req.query.onDemand === "true",
      skippedBecauseOrchestrationHandled: orchestrationSummary.usedOrchestration,
      skippedBecauseAlreadyRunning: false,
      targetsAttempted: 0,
      targets: []
    };

    if (!orchestrationSummary.usedOrchestration) {
      scrapeSummary = await runLiveSearchIfRequested(req.query);
    }

    const {
      missingResultsFile,
      businesses,
      appointments,
      totalAppointmentsBeforeTimingEvaluation,
      timingBreakdown,
      cacheBusinessesLoaded
    } = loadNormalizedAppointments(req.query, {
      includeAppointmentCache: true
    });

    if (missingResultsFile) {
      return res.status(404).json({
        success: false,
        error: "results.json or appointment cache not found"
      });
    }

    const totalBusinesses = new Set(
      appointments.map((appointment) => appointment.businessName)
    ).size;

    const intent = inferSearchIntent(req.query);

    res.json({
      success: true,
      endpoint: "/api/search",
      appointmentTimeZone: APPOINTMENT_TIME_ZONE,
      liveSearchRunning,
      inferredIntent: intent,
      orchestrationSummary,
      scrapeSummary,
      cacheBusinessesLoaded: cacheBusinessesLoaded || 0,
      totalBusinessesInResults: businesses.length,
      totalBusinesses,
      totalAppointmentsBeforeTimingEvaluation,
      currentLocalSortable: getCurrentLocalSortable(),
      timingBreakdown,
      totalAppointments: appointments.length,
      filtersApplied: {
        search: req.query.search || "",
        business: req.query.business || "",
        platform: req.query.platform || "",
        service: req.query.service || intent.service || "",
        serviceCategory: req.query.serviceCategory || intent.serviceCategory || "",
        duration: req.query.duration || intent.duration || "",
        hours: req.query.hours || intent.hours || "",
        limitPerBusiness: req.query.limitPerBusiness || 999,
        showInvalidDates: req.query.showInvalidDates === "true",
        showPast: req.query.showPast === "true",
        onDemand: req.query.onDemand === "true"
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
    app.get("/api/appointments", (req, res) => {

  try {
    const {
      missingResultsFile,
      businesses,
      appointments,
      totalAppointmentsBeforeTimingEvaluation,
      timingBreakdown
    } = loadNormalizedAppointments(req.query);

    if (missingResultsFile) {
      return res.status(404).json({
        success: false,
        error: "results.json not found"
      });
    }

    res.json({
      success: true,
      appointmentTimeZone: APPOINTMENT_TIME_ZONE,
      totalBusinessesInResults: businesses.length,
      totalAppointmentsBeforeTimingEvaluation,
      currentLocalSortable: getCurrentLocalSortable(),
      timingBreakdown,
      totalAppointments: appointments.length,
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
        showPast: req.query.showPast === "true"
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
      appointments
    });
  } catch (error) {
    console.error("API ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("=================================");
  console.log(" Massage Aggregator Running");
  console.log(` http://localhost:${PORT}`);
  console.log(" Timezone: America/Chicago");
  console.log(" Metadata: businesses.json merged into results");
  console.log(" Admin Portal: /admin");
  console.log(" Search API: /api/search");
  console.log(" On-Demand Search: /api/search?search=swedish&onDemand=true");
  console.log("=================================");
  console.log("");
});