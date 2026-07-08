const inventoryRepository = require("./database/inventoryRepository");
const businessManager = require("./businessManager");

const DEFAULT_TIMEZONE = "America/Chicago";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getAppointmentIdentityKey(appointment = {}) {
  return [
    appointment.businessName || appointment.business_name || "",
    appointment.platform || "",
    appointment.serviceName || appointment.service_name || appointment.service || "",
    appointment.serviceCategory ||
      appointment.service_category ||
      appointment.serviceType ||
      "",
    appointment.durationMinutes || appointment.duration_minutes || "",
    appointment.providerName ||
      appointment.provider_name ||
      appointment.therapistName ||
      appointment.provider ||
      "",
    appointment.appointmentStart ||
      appointment.appointment_start ||
      appointment.startTime ||
      "",
    appointment.localDate ||
      appointment.local_date ||
      appointment.localDateKey ||
      "",
    appointment.localTime ||
      appointment.local_time ||
      appointment.localTimeKey ||
      ""
  ]
    .map(normalizeText)
    .join("||");
}

function dedupeInventory(appointments = []) {
  const seen = new Set();
  const deduped = [];

  for (const appointment of Array.isArray(appointments) ? appointments : []) {
    const key = getAppointmentIdentityKey(appointment);

    if (!key.replace(/\|/g, "").trim()) {
      deduped.push(appointment);
      continue;
    }

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(appointment);
  }

  return deduped;
}


function pad2(value) {
  return String(value).padStart(2, "0");
}

function normalizeDateKey(value) {
  if (!value) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }

  const raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[1];
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() > 2000) {
    return `${parsed.getUTCFullYear()}-${pad2(parsed.getUTCMonth() + 1)}-${pad2(parsed.getUTCDate())}`;
  }

  return "";
}

function normalizeTimeKey(value) {
  if (!value) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}`;
  }

  const raw = String(value).trim();

  const ampmMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const minute = Number(ampmMatch[2]);
    const ampm = ampmMatch[3].toUpperCase();

    if (ampm === "PM" && hour !== 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;

    return `${pad2(hour)}:${pad2(minute)}`;
  }

  const isoMatch = raw.match(/T(\d{1,2}):(\d{2})/);
  if (isoMatch) {
    return `${pad2(isoMatch[1])}:${pad2(isoMatch[2])}`;
  }

  const normalMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (normalMatch) {
    return `${pad2(normalMatch[1])}:${pad2(normalMatch[2])}`;
  }

  return "";
}

function buildLocalSortable(localDateKey = "", localTimeKey = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(localDateKey))) return null;
  if (!/^\d{2}:\d{2}$/.test(String(localTimeKey))) return null;

  return Number(`${localDateKey.replace(/-/g, "")}${localTimeKey.replace(":", "")}`);
}

function formatDisplayDate(localDateKey = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(localDateKey))) return "";

  const [year, month, day] = String(localDateKey).split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function formatDisplayTime(localTimeKey = "") {
  if (!/^\d{2}:\d{2}$/.test(String(localTimeKey))) return "";

  const [hourValue, minuteValue] = String(localTimeKey).split(":").map(Number);
  const suffix = hourValue >= 12 ? "PM" : "AM";
  const hour = hourValue % 12 || 12;

  return `${hour}:${pad2(minuteValue)} ${suffix}`;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeBusinessKey(value = "") {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function slugifyBusinessName(value = "") {
  return String(value || "business")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 90) || "business";
}

let cachedBusinessMetadataMap = null;
let cachedBusinessMetadataAt = 0;

function getBusinessMetadataMap() {
  const now = Date.now();

  if (cachedBusinessMetadataMap && now - cachedBusinessMetadataAt < 30000) {
    return cachedBusinessMetadataMap;
  }

  const businesses = businessManager.getAllBusinessesSync();
  const map = new Map();

  if (Array.isArray(businesses)) {
    businesses.forEach((business) => {
      const businessName = business.businessName || business.name || "";
      const key = normalizeBusinessKey(businessName);
      if (!key) return;

      const slug = business.businessSlug || business.slug || slugifyBusinessName(businessName);

      map.set(key, {
        businessName,
        businessCategory: business.businessCategory || "wellness",
        address: business.address || "",
        latitude: toNumber(business.latitude),
        longitude: toNumber(business.longitude),
        logoUrl: business.logoUrl || "",
        logoAlt: business.logoAlt || `${businessName} logo`,
        claimed: business.claimed === true,
        verificationStatus: business.verificationStatus || business.claimStatus || "unclaimed",
        claimedByEmail: business.claimedByEmail || "",
        claimId: business.claimId || "",
        businessSlug: slug,
        businessUrl: business.businessUrl || `/business/${slug}`,
        reviewSummary: business.reviewSummary || null,
        activeDeal: business.activeDeal || null,
        publicProfile: business.publicProfile || null,
        price: business.price || business.servicePrice || null
      });
    });
  }

  cachedBusinessMetadataMap = map;
  cachedBusinessMetadataAt = now;

  return map;
}

function getBusinessMetadata(businessName = "") {
  const map = getBusinessMetadataMap();
  const target = normalizeBusinessKey(businessName);

  if (!target) return {};

  if (map.has(target)) {
    return map.get(target);
  }

  for (const [key, value] of map.entries()) {
    if (key.includes(target) || target.includes(key)) {
      return value;
    }
  }

  return {};
}

function normalizeInventoryRow(row = {}) {
  const serviceName = row.serviceName || row.service_name || row.service || "";
  const serviceCategory =
    row.serviceCategory ||
    row.service_category ||
    row.serviceType ||
    row.service_type ||
    "";

  const businessName = row.businessName || row.business_name || "";
  const metadata = getBusinessMetadata(businessName);

  const rawAppointmentStart =
    row.appointmentStart ||
    row.appointment_start ||
    row.startTime ||
    row.start_time ||
    "";

  const localDateKey =
    normalizeDateKey(row.localDateKey) ||
    normalizeDateKey(row.localDate) ||
    normalizeDateKey(row.local_date) ||
    normalizeDateKey(rawAppointmentStart);

  const localTimeKey =
    normalizeTimeKey(row.localTimeKey) ||
    normalizeTimeKey(row.localTime) ||
    normalizeTimeKey(row.local_time) ||
    normalizeTimeKey(rawAppointmentStart);

  const safeStartTime =
    localDateKey && localTimeKey
      ? `${localDateKey}T${localTimeKey}:00`
      : rawAppointmentStart || "";

  const latitude =
    toNumber(row.latitude) ??
    toNumber(row.businessLatitude) ??
    toNumber(row.business_latitude) ??
    metadata.latitude ??
    null;

  const longitude =
    toNumber(row.longitude) ??
    toNumber(row.businessLongitude) ??
    toNumber(row.business_longitude) ??
    metadata.longitude ??
    null;

  const displayDate = row.date || row.displayDate || formatDisplayDate(localDateKey);
  const displayTime = row.time || row.displayTime || formatDisplayTime(localTimeKey);

  return {
    id: row.id || null,

    businessName: businessName || metadata.businessName || "",
    businessCategory:
      row.businessCategory ||
      row.business_category ||
      metadata.businessCategory ||
      "wellness",

    platform: row.platform || "",
    bookingUrl: row.bookingUrl || row.booking_url || "",

    serviceName,
    service: serviceName,
    serviceCategory,
    serviceType: serviceCategory,
    durationMinutes: toNumberOrNull(row.durationMinutes || row.duration_minutes),

    therapistName:
      row.therapistName ||
      row.providerName ||
      row.provider_name ||
      row.provider ||
      "",

    providerName:
      row.providerName ||
      row.provider_name ||
      row.therapistName ||
      row.provider ||
      "",

    appointmentStart: rawAppointmentStart || safeStartTime,
    startTime: safeStartTime,

    appointmentEnd:
      row.appointmentEnd ||
      row.appointment_end ||
      row.endTime ||
      row.end_time ||
      "",

    endTime:
      row.endTime ||
      row.appointmentEnd ||
      row.appointment_end ||
      row.end_time ||
      "",

    localDate: localDateKey,
    localDateKey,

    localTime: localTimeKey,
    localTimeKey,

    localSortable: buildLocalSortable(localDateKey, localTimeKey),

    date: displayDate,
    time: displayTime,
    displayDate,
    displayTime,

    timezone: row.timezone || DEFAULT_TIMEZONE,

    sourceType:
      row.sourceType ||
      row.source_type ||
      row.appointmentSource ||
      row.appointment_source ||
      "confirmed",

    confidence:
      row.confidence === undefined || row.confidence === null
        ? 1
        : Number(row.confidence),

    inventoryStatus:
      row.inventoryStatus || row.inventory_status || row.status || "active",

    status: row.status || row.inventoryStatus || row.inventory_status || "active",

    latitude,
    longitude,
    address: row.address || row.businessAddress || row.business_address || metadata.address || "",
    logoUrl: row.logoUrl || row.logo_url || metadata.logoUrl || "",
    logoAlt:
      row.logoAlt ||
      row.logo_alt ||
      metadata.logoAlt ||
      `${businessName || "Business"} logo`,

    claimed: row.claimed === true || metadata.claimed === true,
    verificationStatus:
      row.verificationStatus ||
      row.verification_status ||
      metadata.verificationStatus ||
      "unclaimed",
    claimedByEmail: row.claimedByEmail || row.claimed_by_email || metadata.claimedByEmail || "",
    claimId: row.claimId || row.claim_id || metadata.claimId || "",
    businessSlug: row.businessSlug || row.business_slug || metadata.businessSlug || slugifyBusinessName(businessName),
    businessUrl: row.businessUrl || row.business_url || metadata.businessUrl || `/business/${slugifyBusinessName(businessName)}`,
    reviewSummary: row.reviewSummary || row.review_summary || metadata.reviewSummary || null,
    activeDeal: row.activeDeal || row.active_deal || metadata.activeDeal || null,
    publicProfile: row.publicProfile || row.public_profile || metadata.publicProfile || null,

    price: row.price || row.servicePrice || row.service_price || metadata.price || null,

    rawJson: row.rawJson || row.raw_json || null,

    createdAt: row.createdAt || row.created_at || "",
    updatedAt: row.updatedAt || row.updated_at || ""
  };
}

function normalizeFilters(filters = {}) {
  return {
    businessName: filters.businessName || filters.business || "",
    platform: filters.platform || "",
    serviceName: filters.serviceName || filters.service || "",
    serviceCategory:
      filters.serviceCategory || filters.serviceType || filters.category || "",
    durationMinutes: toNumberOrNull(filters.durationMinutes || filters.duration),
    providerName: filters.providerName || filters.therapistName || filters.provider || "",
    startDate: filters.startDate || filters.localDateStart || filters.fromDate || "",
    endDate: filters.endDate || filters.localDateEnd || filters.toDate || "",
    targetLocalDateKey:
      filters.targetLocalDateKey || filters.localDateKey || filters.date || "",
    startTimeKey: filters.startTimeKey || filters.localTimeStart || "",
    endTimeKey: filters.endTimeKey || filters.localTimeEnd || "",
    hours: toNumberOrNull(filters.hours || filters.lookaheadHours),
    limit: toNumberOrNull(filters.limit),
    limitPerBusiness: toNumberOrNull(filters.limitPerBusiness),
    includeInactive:
      filters.includeInactive === true || String(filters.includeInactive) === "true",
    showPast:
      filters.showPast === true || String(filters.showPast) === "true",
    includeInferred:
      filters.includeInferred !== false && String(filters.includeInferred) !== "false",
    includeConfirmed:
      filters.includeConfirmed !== false && String(filters.includeConfirmed) !== "false"
  };
}

async function insertConfirmedAppointments(resultOrAppointments = {}, options = {}) {
  if (Array.isArray(resultOrAppointments)) {
    const saved = [];

    for (const appointment of resultOrAppointments) {
      saved.push(
        await inventoryRepository.saveBusinessResult(
          {
            ...appointment,
            businessName: appointment.businessName || options.businessName,
            platform: appointment.platform || options.platform,
            serviceName: appointment.serviceName || options.serviceName,
            serviceType: appointment.serviceType || options.serviceType,
            durationMinutes: appointment.durationMinutes || options.durationMinutes,
            bookingUrl: appointment.bookingUrl || options.bookingUrl,
            appointments: [appointment]
          },
          {
            triggerType: options.triggerType || "manual"
          }
        )
      );
    }

    return saved;
  }

  return inventoryRepository.saveBusinessResult(resultOrAppointments, {
    triggerType: options.triggerType || resultOrAppointments.triggerType || "manual"
  });
}

async function insertInferredAppointments(inferredAppointments = [], options = {}) {
  if (!Array.isArray(inferredAppointments) || inferredAppointments.length === 0) {
    return [];
  }

  if (typeof inventoryRepository.insertInferredAppointment !== "function") {
    console.warn(
      "[inventoryManager] insertInferredAppointment is not implemented yet. Returning no-op."
    );
    return [];
  }

  const saved = [];

  for (const appointment of inferredAppointments) {
    saved.push(
      await inventoryRepository.insertInferredAppointment({
        ...appointment,
        businessName: appointment.businessName || options.businessName,
        platform: appointment.platform || options.platform,
        sourceType: appointment.sourceType || "inferred",
        confidence:
          appointment.confidence === undefined ? 0.75 : Number(appointment.confidence)
      })
    );
  }

  return saved;
}

function mergeInventory(primary = [], secondary = []) {
  return dedupeInventory([...(primary || []), ...(secondary || [])]);
}

function applyLookahead(appointments = [], filters = {}) {
  const normalizedFilters = normalizeFilters(filters);

  if (!normalizedFilters.hours) {
    return appointments;
  }

  const now = Date.now();
  const cutoff = now + normalizedFilters.hours * 60 * 60 * 1000;

  return appointments.filter((appointment) => {
    const normalized = normalizeInventoryRow(appointment);
    const rawStart = normalized.startTime || normalized.appointmentStart || "";

    if (!rawStart) {
      return true;
    }

    const parsed = new Date(rawStart).getTime();

    if (Number.isNaN(parsed)) {
      return true;
    }

    return parsed >= now && parsed <= cutoff;
  });
}

function filterInventory(appointments = [], filters = {}) {
  const normalizedFilters = normalizeFilters(filters);

  return appointments.filter((appointment) => {
    const normalized = normalizeInventoryRow(appointment);

    if (
      normalizedFilters.businessName &&
      !normalizeText(normalized.businessName).includes(
        normalizeText(normalizedFilters.businessName)
      )
    ) {
      return false;
    }

    if (
      normalizedFilters.platform &&
      normalizeText(normalized.platform) !== normalizeText(normalizedFilters.platform)
    ) {
      return false;
    }

    if (
      normalizedFilters.serviceName &&
      !normalizeText(normalized.serviceName).includes(
        normalizeText(normalizedFilters.serviceName)
      )
    ) {
      return false;
    }

    if (
      normalizedFilters.serviceCategory &&
      normalizeText(normalized.serviceCategory) !==
        normalizeText(normalizedFilters.serviceCategory)
    ) {
      return false;
    }

    if (
      normalizedFilters.durationMinutes &&
      Number(normalized.durationMinutes) !== Number(normalizedFilters.durationMinutes)
    ) {
      return false;
    }

    if (
      normalizedFilters.providerName &&
      !normalizeText(normalized.providerName).includes(
        normalizeText(normalizedFilters.providerName)
      )
    ) {
      return false;
    }

    if (
      normalizedFilters.targetLocalDateKey &&
      normalized.localDateKey !== normalizeDateKey(normalizedFilters.targetLocalDateKey)
    ) {
      return false;
    }

    if (
      normalizedFilters.startTimeKey &&
      normalized.localTimeKey &&
      normalized.localTimeKey < normalizedFilters.startTimeKey
    ) {
      return false;
    }

    if (
      normalizedFilters.endTimeKey &&
      normalized.localTimeKey &&
      normalized.localTimeKey > normalizedFilters.endTimeKey
    ) {
      return false;
    }

    if (!normalizedFilters.includeInactive) {
      const status = normalizeText(normalized.inventoryStatus || normalized.status);

      if (["inactive", "expired", "archived", "deleted"].includes(status)) {
        return false;
      }
    }

    if (!normalizedFilters.includeInferred && normalized.sourceType === "inferred") {
      return false;
    }

    if (!normalizedFilters.includeConfirmed && normalized.sourceType === "confirmed") {
      return false;
    }

    return true;
  });
}

function sortInventory(appointments = []) {
  return [...appointments].sort((a, b) => {
    const aStart = a.appointmentStart || a.startTime || "";
    const bStart = b.appointmentStart || b.startTime || "";

    const aTime = new Date(aStart).getTime();
    const bTime = new Date(bStart).getTime();

    if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
      return aTime - bTime;
    }

    const aLocal = String(a.localDateKey || "") + String(a.localTimeKey || "");
    const bLocal = String(b.localDateKey || "") + String(b.localTimeKey || "");

    if (aLocal !== bLocal) {
      return aLocal.localeCompare(bLocal);
    }

    return String(a.businessName || "").localeCompare(String(b.businessName || ""));
  });
}

function limitPerBusiness(appointments = [], limitPerBusinessValue = null) {
  const limit = Number(limitPerBusinessValue || 0);

  if (!limit || Number.isNaN(limit)) {
    return appointments;
  }

  const counts = {};
  const limited = [];

  for (const appointment of appointments) {
    const key = appointment.businessName || "Unknown Business";
    counts[key] = counts[key] || 0;

    if (counts[key] < limit) {
      limited.push(appointment);
      counts[key] += 1;
    }
  }

  return limited;
}

async function getInventory(filters = {}) {
  const normalizedFilters = normalizeFilters(filters);

  let rows = [];

  if (typeof inventoryRepository.getInventory === "function") {
    rows = await inventoryRepository.getInventory(normalizedFilters);
  } else if (typeof inventoryRepository.getRawResults === "function") {
    const rawResults = await inventoryRepository.getRawResults(
      normalizedFilters.limit || 500
    );

    rows = rawResults.flatMap((result) => {
      const appointments = inventoryRepository.extractAppointments
        ? inventoryRepository.extractAppointments(result)
        : result.appointments || [];

      return appointments.map((appointment) =>
        normalizeInventoryRow({
          ...appointment,
          businessName: appointment.businessName || result.businessName,
          platform: appointment.platform || result.platform,
          serviceName: appointment.serviceName || result.serviceName || result.service,
          serviceCategory:
            appointment.serviceCategory || result.serviceCategory || result.serviceType,
          durationMinutes: appointment.durationMinutes || result.durationMinutes,
          bookingUrl: appointment.bookingUrl || result.bookingUrl,
          sourceType: appointment.sourceType || "confirmed"
        })
      );
    });
  }

  let inventory = rows.map(normalizeInventoryRow);

  inventory = filterInventory(inventory, normalizedFilters);
  inventory = applyLookahead(inventory, normalizedFilters);
  inventory = dedupeInventory(inventory);
  inventory = sortInventory(inventory);
  inventory = limitPerBusiness(inventory, normalizedFilters.limitPerBusiness);

  if (normalizedFilters.limit) {
    inventory = inventory.slice(0, normalizedFilters.limit);
  }

  return inventory;
}

async function applyInference(appointments = [], options = {}) {
  if (typeof options.inferenceEngine === "function") {
    const inferred = await options.inferenceEngine(appointments, options);
    return mergeInventory(appointments, inferred);
  }

  return appointments;
}

async function deleteExpiredAppointments(options = {}) {
  if (typeof inventoryRepository.deleteExpiredInventory === "function") {
    return inventoryRepository.deleteExpiredInventory(options);
  }

  console.warn(
    "[inventoryManager] deleteExpiredInventory is not implemented in InventoryRepository yet."
  );

  return {
    success: true,
    deleted: 0,
    skipped: true
  };
}

async function archiveInventory(options = {}) {
  if (typeof inventoryRepository.archiveInventory === "function") {
    return inventoryRepository.archiveInventory(options);
  }

  console.warn(
    "[inventoryManager] archiveInventory is not implemented in InventoryRepository yet."
  );

  return {
    success: true,
    archived: 0,
    skipped: true
  };
}

async function inventoryStatistics(filters = {}) {
  const inventory = await getInventory(filters);

  const byBusiness = {};
  const byPlatform = {};
  const bySourceType = {};
  const byServiceCategory = {};

  for (const item of inventory) {
    byBusiness[item.businessName] = (byBusiness[item.businessName] || 0) + 1;
    byPlatform[item.platform] = (byPlatform[item.platform] || 0) + 1;
    bySourceType[item.sourceType] = (bySourceType[item.sourceType] || 0) + 1;
    byServiceCategory[item.serviceCategory] =
      (byServiceCategory[item.serviceCategory] || 0) + 1;
  }

  return {
    total: inventory.length,
    byBusiness,
    byPlatform,
    bySourceType,
    byServiceCategory
  };
}

async function getStatistics(filters = {}) {
  return inventoryStatistics(filters);
}

module.exports = {
  getInventory,
  filterInventory,
  applyLookahead,
  applyInference,
  mergeInventory,
  dedupeInventory,

  insertConfirmedAppointments,
  insertInferredAppointments,

  deleteExpiredAppointments,
  archiveInventory,

  inventoryStatistics,
  getStatistics,

  normalizeInventoryRow,
  normalizeFilters,
  getAppointmentIdentityKey
};