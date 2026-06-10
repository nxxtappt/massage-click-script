// normalizationUtils.js
const {
  buildLocalDateTimeFields
} = require("./dateNormalizationUtils");

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[™®©]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBusinessName(value) {
  return normalizeText(value)
    .replace(/\bllc\b/g, "")
    .replace(/\binc\b/g, "")
    .replace(/\bco\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SERVICE_TYPE_ALIASES = {
  deep_tissue: [
    "deep tissue",
    "deep",
    "deep massage",
    "deep tissue massage"
  ],

  swedish: [
    "swedish",
    "swedish massage"
  ],

  relaxation: [
    "relaxation",
    "relaxing",
    "relaxation massage",
    "signature relaxation"
  ],

  sports: [
    "sports",
    "sport",
    "sports massage"
  ],

  prenatal: [
    "prenatal",
    "pregnancy",
    "pregnant",
    "prenatal massage",
    "pregnancy massage"
  ],

  ashiatsu: [
    "ashiatsu",
    "ashiatsu massage"
  ],

  lomi_lomi: [
    "lomi",
    "lomi lomi",
    "lomi lomi massage"
  ],

  facial: [
    "facial",
    "facials",
    "skin care",
    "skincare"
  ],

  hair: [
    "hair",
    "haircut",
    "hair cut",
    "salon"
  ],

  massage: [
    "massage",
    "general massage",
    "custom massage",
    "customized massage",
    "therapeutic massage",
    "bodywork"
  ],

  other: [
    "other"
  ]
};

function normalizeServiceType(value) {
  const text = normalizeText(value);

  if (!text) return "";

  for (const [canonicalType, aliases] of Object.entries(SERVICE_TYPE_ALIASES)) {
    if (normalizeText(canonicalType) === text) {
      return canonicalType;
    }

    if (aliases.some((alias) => normalizeText(alias) === text)) {
      return canonicalType;
    }
  }

  for (const [canonicalType, aliases] of Object.entries(SERVICE_TYPE_ALIASES)) {
    if (aliases.some((alias) => text.includes(normalizeText(alias)))) {
      return canonicalType;
    }
  }

  return text.replace(/\s+/g, "_");
}

function getCanonicalServiceTypes() {
  return Object.keys(SERVICE_TYPE_ALIASES);
}

function normalizeServiceName(value) {
  return normalizeText(value)
    .replace(/\bminute\b/g, "min")
    .replace(/\bminutes\b/g, "min")
    .replace(/\bmins\b/g, "min")
    .replace(/\bhour\b/g, "hr")
    .replace(/\bhours\b/g, "hr")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePlatform(value) {
  return normalizeText(value);
}

function normalizeDuration(value) {
  if (value === null || value === undefined || value === "") return "";

  const number = Number(value);

  if (!Number.isNaN(number) && number > 0) {
    return String(number);
  }

  const text = normalizeText(value);
  const match = text.match(/\b(30|45|50|60|75|80|90|110|120)\b/);

  return match ? match[1] : "";
}

function buildCacheKey(input = {}) {
  const businessName = normalizeBusinessName(input.businessName || input.name);
  const platform = normalizePlatform(input.platform);
  const serviceName = normalizeServiceName(input.serviceName || input.service);
  const serviceType = normalizeServiceType(input.serviceType || input.serviceCategory);
  const durationMinutes = normalizeDuration(input.durationMinutes || input.duration);

  return [
    businessName,
    platform,
    serviceName,
    serviceType,
    durationMinutes
  ].join("|");
}

function buildBusinessKey(input = {}) {
  return [
    normalizeBusinessName(input.businessName || input.name),
    normalizePlatform(input.platform),
    normalizeText(input.address || "")
  ].join("|");
}

function buildAppointmentKey(input = {}) {
  return [
    normalizeBusinessName(input.businessName),
    normalizePlatform(input.platform),
    normalizeServiceName(input.serviceName || input.service),
    normalizeServiceType(input.serviceType || input.serviceCategory),
    normalizeDuration(input.durationMinutes || input.duration),
    normalizeText(input.therapistName || input.provider || ""),
    normalizeText(input.localDateKey || input.date || input.rawDate || ""),
    normalizeText(input.localTimeKey || input.time || input.rawTime || "")
  ].join("|");
}

function dedupeBusinesses(businesses = []) {
  const seen = new Set();
  const output = [];

  businesses.forEach((business) => {
    if (!business || typeof business !== "object") return;

    const key = buildBusinessKey(business);

    if (seen.has(key)) return;

    seen.add(key);
    output.push(business);
  });

  return output;
}

function dedupeAppointments(appointments = []) {
  const seen = new Set();
  const output = [];

  appointments.forEach((appointment) => {
    if (!appointment || typeof appointment !== "object") return;

    const key = buildAppointmentKey(appointment);

    if (seen.has(key)) return;

    seen.add(key);
    output.push(appointment);
  });

  return output;
}

function businessHasAppointments(business) {
  if (!business || typeof business !== "object") return false;

  return Boolean(
    (Array.isArray(business.openings) && business.openings.length > 0) ||
      (Array.isArray(business.appointments) && business.appointments.length > 0) ||
      (Array.isArray(business.results) && business.results.length > 0) ||
      (Array.isArray(business.availability) && business.availability.length > 0) ||
      (Array.isArray(business.times) && business.times.length > 0) ||
      (business.data &&
        Array.isArray(business.data.openings) &&
        business.data.openings.length > 0) ||
      (business.data &&
        Array.isArray(business.data.appointments) &&
        business.data.appointments.length > 0)
  );
}

function removeUnavailableBusinesses(businesses = []) {
  return businesses.filter(businessHasAppointments);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseDateParts(value) {
  if (!value) return null;

  const text = String(value).trim();

  if (text.includes("T")) {
    const dateOnly = text.split("T")[0];
    const parts = dateOnly.split("-");

    if (parts.length === 3) {
      return {
        year: Number(parts[0]),
        month: Number(parts[1]),
        day: Number(parts[2])
      };
    }
  }

  const parsed = new Date(text);

  if (!Number.isNaN(parsed.getTime())) {
    return {
      year: parsed.getFullYear(),
      month: parsed.getMonth() + 1,
      day: parsed.getDate()
    };
  }

  return null;
}

function parseTimeParts(value) {
  if (!value) return null;

  const text = String(value).trim();

  const isoMatch = text.match(/T(\d{1,2}):(\d{2})/);

  if (isoMatch) {
    return {
      hour: Number(isoMatch[1]),
      minute: Number(isoMatch[2])
    };
  }

  const normalMatch = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (normalMatch) {
    let hour = Number(normalMatch[1]);
    const minute = Number(normalMatch[2]);
    const ampm = normalMatch[3].toUpperCase();

    if (ampm === "PM" && hour !== 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;

    return {
      hour,
      minute
    };
  }

  return null;
}

function formatDisplayTime(hour, minute) {
  const suffix = hour >= 12 ? "PM" : "AM";
  let displayHour = hour % 12;

  if (displayHour === 0) displayHour = 12;

  return `${displayHour}:${pad2(minute)} ${suffix}`;
}

function formatDisplayDate(year, month, day) {
  const date = new Date(year, month - 1, day);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function oldBuildLocalDateTimeFields(rawDate, rawTime) {
  const dateParts =
    parseDateParts(rawDate) ||
    parseDateParts(rawTime);

  const timeParts =
    parseTimeParts(rawTime) ||
    parseTimeParts(rawDate);

  if (!dateParts || !timeParts) {
    return {
      localDateKey: "",
      localTimeKey: "",
      localSortable: null,
      startTime: "",
      date: rawDate || "",
      time: rawTime || ""
    };
  }

  const localDateKey = `${dateParts.year}-${pad2(dateParts.month)}-${pad2(dateParts.day)}`;
  const localTimeKey = `${pad2(timeParts.hour)}:${pad2(timeParts.minute)}`;

  const localSortable = Number(
    `${dateParts.year}${pad2(dateParts.month)}${pad2(dateParts.day)}${pad2(timeParts.hour)}${pad2(timeParts.minute)}`
  );

  return {
    localDateKey,
    localTimeKey,
    localSortable,
    startTime: `${localDateKey}T${localTimeKey}:00`,
    date: formatDisplayDate(dateParts.year, dateParts.month, dateParts.day),
    time: formatDisplayTime(timeParts.hour, timeParts.minute)
  };
}

function getBusinessServiceName(business = {}, source = {}) {
  return (
    source.serviceName ||
    source.service ||
    business.serviceName ||
    business.service ||
    ""
  );
}

function getBusinessServiceType(business = {}, source = {}) {
  return normalizeServiceType(
    source.serviceType ||
      source.serviceCategory ||
      business.serviceType ||
      business.serviceCategory ||
      getBusinessServiceName(business, source)
  );
}

function getBusinessDuration(business = {}, source = {}) {
  return (
    source.durationMinutes ||
    source.duration ||
    business.durationMinutes ||
    business.duration ||
    normalizeDuration(getBusinessServiceName(business, source)) ||
    null
  );
}

function normalizeSingleAppointment(business = {}, source = {}, overrides = {}) {
  const serviceName = getBusinessServiceName(business, source);
  const serviceType = getBusinessServiceType(business, source);
  const durationMinutes = getBusinessDuration(business, source);

  const rawDate =
    overrides.rawDate ||
    source.date ||
    source.appointmentDate ||
    source.localDateKey ||
    business.date ||
    "";

  const rawTime =
    overrides.rawTime ||
    source.time ||
    source.startTime ||
    source.appointmentTime ||
    source.localTimeKey ||
    "";

  const local = buildLocalDateTimeFields(rawDate, rawTime, {
  platform:
    business.platform ||
    source.platform ||
    "unknown"
});

  return {
    businessName:
      business.businessName ||
      business.name ||
      source.businessName ||
      "Unknown Business",

    platform:
      business.platform ||
      source.platform ||
      "unknown",

    bookingUrl:
      business.bookingUrl ||
      source.bookingUrl ||
      "",

    serviceName,
    serviceType,
    serviceCategory: serviceType,
    durationMinutes: durationMinutes ? Number(durationMinutes) : null,

    therapistName:
      overrides.therapistName ||
      source.therapistName ||
      source.staffName ||
      source.employeeName ||
      source.providerName ||
      source.provider ||
      business.provider ||
      business.providerText ||
      "",

    provider:
      overrides.therapistName ||
      source.therapistName ||
      source.provider ||
      business.provider ||
      business.providerText ||
      "",

    price:
      source.price ||
      business.price ||
      null,

    date: local.date,
    time: local.time,
    startTime: source.startTime || local.startTime,
    endTime: source.endTime || "",
    localDateKey: local.localDateKey,
    localTimeKey: local.localTimeKey,
    localSortable: local.localSortable,

    latitude:
      business.latitude !== undefined && business.latitude !== null
        ? Number(business.latitude)
        : null,

    longitude:
      business.longitude !== undefined && business.longitude !== null
        ? Number(business.longitude)
        : null,

    address:
      business.address ||
      source.address ||
      "",

    logoUrl:
      business.logoUrl ||
      source.logoUrl ||
      "",

    sourceStatus:
      business.status ||
      source.status ||
      "unknown",

    rawDate,
    rawTime,

    available: true
  };
}

function normalizeTimesToAppointments(business = {}) {
  if (!Array.isArray(business.times)) return [];

  return business.times
    .filter(Boolean)
    .map((time) =>
      normalizeSingleAppointment(
        business,
        {
          time,
          date: business.date || "",
          serviceName: business.serviceName || business.service || "",
          serviceType: business.serviceType || "",
          durationMinutes: business.durationMinutes || null
        },
        {
          rawTime: time,
          rawDate: business.date || ""
        }
      )
    );
}

function normalizeOpeningsToAppointments(business = {}, openings = []) {
  if (!Array.isArray(openings)) return [];

  return openings
    .filter(Boolean)
    .map((opening) =>
      normalizeSingleAppointment(
        business,
        opening,
        {
          rawDate: opening.date || opening.startTime || business.date || "",
          rawTime: opening.startTime || opening.time || ""
        }
      )
    );
}

function normalizeTherapistAvailabilityToAppointments(business = {}) {
  if (!Array.isArray(business.therapistAvailability)) return [];

  const appointments = [];

  business.therapistAvailability.forEach((therapist) => {
    if (!therapist || !Array.isArray(therapist.times)) return;

    therapist.times.forEach((time) => {
      appointments.push(
        normalizeSingleAppointment(
          business,
          {
            time,
            date: business.date || "",
            serviceName: business.serviceName || business.service || "",
            serviceType: business.serviceType || "",
            durationMinutes: business.durationMinutes || null
          },
          {
            therapistName: therapist.name || "",
            rawTime: time,
            rawDate: business.date || ""
          }
        )
      );
    });
  });

  return appointments;
}

function normalizeBusinessResultToAppointments(business = {}) {
  if (!business || typeof business !== "object") {
    return [];
  }

  let appointments = [];

  if (Array.isArray(business.openings) && business.openings.length > 0) {
    appointments.push(...normalizeOpeningsToAppointments(business, business.openings));
  }

  if (Array.isArray(business.appointments) && business.appointments.length > 0) {
    appointments.push(...normalizeOpeningsToAppointments(business, business.appointments));
  }

  if (Array.isArray(business.results) && business.results.length > 0) {
    appointments.push(...normalizeOpeningsToAppointments(business, business.results));
  }

  if (Array.isArray(business.availability) && business.availability.length > 0) {
    appointments.push(...normalizeOpeningsToAppointments(business, business.availability));
  }

  if (
    business.data &&
    Array.isArray(business.data.openings) &&
    business.data.openings.length > 0
  ) {
    appointments.push(...normalizeOpeningsToAppointments(business, business.data.openings));
  }

  if (
    business.data &&
    Array.isArray(business.data.appointments) &&
    business.data.appointments.length > 0
  ) {
    appointments.push(...normalizeOpeningsToAppointments(business, business.data.appointments));
  }

  if (Array.isArray(business.therapistAvailability) && business.therapistAvailability.length > 0) {
    appointments.push(...normalizeTherapistAvailabilityToAppointments(business));
  }

  if (Array.isArray(business.times) && business.times.length > 0) {
    appointments.push(...normalizeTimesToAppointments(business));
  }

  return dedupeAppointments(appointments);
}

function normalizeBusinessesToAppointments(businesses = []) {
  if (!Array.isArray(businesses)) return [];

  const appointments = [];

  businesses.forEach((business) => {
    appointments.push(...normalizeBusinessResultToAppointments(business));
  });

  return dedupeAppointments(appointments);
}

module.exports = {
  normalizeText,
  normalizeBusinessName,
  normalizeServiceType,
  getCanonicalServiceTypes,
  SERVICE_TYPE_ALIASES,
  normalizeServiceName,
  normalizePlatform,
  normalizeDuration,
  buildCacheKey,
  buildBusinessKey,
  buildAppointmentKey,
  dedupeBusinesses,
  dedupeAppointments,
  businessHasAppointments,
  removeUnavailableBusinesses,

  parseDateParts,
  parseTimeParts,
  buildLocalDateTimeFields,
  normalizeSingleAppointment,
  normalizeBusinessResultToAppointments,
  normalizeBusinessesToAppointments
};