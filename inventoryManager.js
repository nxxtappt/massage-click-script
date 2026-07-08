const inventoryRepository = require("./database/inventoryRepository");

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

function normalizeInventoryRow(row = {}) {
  const serviceName = row.serviceName || row.service_name || row.service || "";
  const serviceCategory =
    row.serviceCategory ||
    row.service_category ||
    row.serviceType ||
    row.service_type ||
    "";

  return {
    id: row.id || null,

    businessName: row.businessName || row.business_name || "",
    businessCategory: row.businessCategory || row.business_category || "wellness",

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

    appointmentStart:
      row.appointmentStart ||
      row.appointment_start ||
      row.startTime ||
      row.start_time ||
      "",

    startTime:
      row.startTime ||
      row.appointmentStart ||
      row.appointment_start ||
      row.start_time ||
      "",

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

    localDate:
      row.localDate || row.local_date || row.localDateKey || "",
    localDateKey:
      row.localDateKey || row.localDate || row.local_date || "",

    localTime:
      row.localTime || row.local_time || row.localTimeKey || "",
    localTimeKey:
      row.localTimeKey || row.localTime || row.local_time || "",

    timezone: row.timezone || DEFAULT_TIMEZONE,

    sourceType: row.sourceType || row.source_type || "confirmed",
    confidence:
      row.confidence === undefined || row.confidence === null
        ? 1
        : Number(row.confidence),

    inventoryStatus:
      row.inventoryStatus || row.inventory_status || row.status || "active",

    status: row.status || row.inventoryStatus || row.inventory_status || "active",

    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    address: row.address || "",
    logoUrl: row.logoUrl || row.logo_url || "",
    logoAlt: row.logoAlt || row.logo_alt || "",

    price: row.price || row.servicePrice || row.service_price || null,

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
    const rawStart =
      appointment.appointmentStart ||
      appointment.appointment_start ||
      appointment.startTime ||
      "";

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
      normalized.localDateKey !== normalizedFilters.targetLocalDateKey
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