const inventoryManager = require("./inventoryManager");
const businessManager = require("./businessManager");

const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_LIMIT_TIMES = 8;
const MAX_LIMIT_TIMES = 30;
const INVENTORY_ROW_LIMIT = 2000;
const WIDGET_CACHE_TTL_MS = 60 * 1000;

const widgetCache = new Map();

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampLimit(value, fallback = DEFAULT_LIMIT_TIMES) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), MAX_LIMIT_TIMES);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getLocalNowParts(timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute)
  };
}

function getCurrentLocalSortable(timezone = DEFAULT_TIMEZONE) {
  const now = getLocalNowParts(timezone);

  return Number(
    `${now.year}${pad2(now.month)}${pad2(now.day)}${pad2(now.hour)}${pad2(
      now.minute
    )}`
  );
}

function getTodayDateKey(timezone = DEFAULT_TIMEZONE) {
  const now = getLocalNowParts(timezone);
  return `${now.year}-${pad2(now.month)}-${pad2(now.day)}`;
}

function addDaysToDateKey(dateKey, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) {
    return "";
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0), 12));

  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate()
  )}`;
}

function formatDateLabel(dateKey, timezone = DEFAULT_TIMEZONE) {
  const today = getTodayDateKey(timezone);
  const tomorrow = addDaysToDateKey(today, 1);

  if (dateKey === today) return "TODAY";
  if (dateKey === tomorrow) return "TOMORROW";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) {
    return "UPCOMING";
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  return date
    .toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric"
    })
    .toUpperCase();
}

function formatTimeLabel(timeKey = "") {
  const match = String(timeKey || "").match(/^(\d{1,2}):(\d{2})/);

  if (!match) {
    return String(timeKey || "Time available");
  }

  const hour24 = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return `${hour12}:${pad2(minute)} ${suffix}`;
}

function titleCaseServiceCategory(value = "") {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function getServiceDisplayName(appointment = {}) {
  const explicit = appointment.serviceName || appointment.service || "";

  if (explicit) {
    return String(explicit).trim();
  }

  const duration = Number(appointment.durationMinutes || 0);
  const category = titleCaseServiceCategory(
    appointment.serviceCategory || appointment.serviceType || ""
  );

  if (duration && category) {
    return `${duration} Minute ${category}`;
  }

  if (duration) {
    return `${duration} Minute Service`;
  }

  return category || "Available Service";
}

function buildServiceKey(appointment = {}) {
  return [
    getServiceDisplayName(appointment),
    appointment.durationMinutes || ""
  ]
    .map(normalizeText)
    .join("|");
}

function isFutureAppointment(appointment = {}, currentLocalSortable) {
  const localSortable = Number(appointment.localSortable || 0);

  if (!localSortable || !currentLocalSortable) {
    return false;
  }

  return localSortable > currentLocalSortable;
}

function groupAppointmentsByTime(appointments = [], options = {}) {
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const limitTimes = clampLimit(options.limitTimes);
  const preferredBookingUrl = options.bookingUrl || "";
  const currentLocalSortable = getCurrentLocalSortable(timezone);
  const groups = new Map();

  for (const appointment of Array.isArray(appointments) ? appointments : []) {
    if (!appointment || !isFutureAppointment(appointment, currentLocalSortable)) {
      continue;
    }

    const dateKey = String(
      appointment.localDateKey || appointment.localDate || ""
    );
    const timeKey = String(
      appointment.localTimeKey || appointment.localTime || ""
    );

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(timeKey)) {
      continue;
    }

    const groupKey = `${dateKey}|${timeKey}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        dateKey,
        timeKey,
        localSortable: Number(appointment.localSortable),
        timeLabel: formatTimeLabel(timeKey),
        bookingUrl: preferredBookingUrl || appointment.bookingUrl || "",
        servicesByKey: new Map()
      });
    }

    const group = groups.get(groupKey);
    const serviceKey = buildServiceKey(appointment);

    if (!group.servicesByKey.has(serviceKey)) {
      group.servicesByKey.set(serviceKey, {
        name: getServiceDisplayName(appointment),
        durationMinutes: appointment.durationMinutes || null,
        serviceCategory:
          appointment.serviceCategory || appointment.serviceType || ""
      });
    }

    if (!group.bookingUrl && appointment.bookingUrl) {
      group.bookingUrl = appointment.bookingUrl;
    }
  }

  const groupedTimes = [...groups.values()]
    .sort((a, b) => a.localSortable - b.localSortable)
    .slice(0, limitTimes)
    .map((group) => {
      const services = [...group.servicesByKey.values()].sort((a, b) =>
        a.name.localeCompare(b.name)
      );

      return {
        dateKey: group.dateKey,
        timeKey: group.timeKey,
        timeLabel: group.timeLabel,
        bookingUrl: group.bookingUrl,
        serviceCount: services.length,
        services
      };
    });

  const dateGroups = [];
  const dateMap = new Map();

  for (const time of groupedTimes) {
    if (!dateMap.has(time.dateKey)) {
      const dateGroup = {
        dateKey: time.dateKey,
        dateLabel: formatDateLabel(time.dateKey, timezone),
        times: []
      };

      dateMap.set(time.dateKey, dateGroup);
      dateGroups.push(dateGroup);
    }

    dateMap.get(time.dateKey).times.push(time);
  }

  return dateGroups;
}

function getWidgetCacheKey(slugOrName, options = {}) {
  return [
    normalizeText(slugOrName),
    clampLimit(options.limitTimes),
    options.includeConfirmed !== false ? "confirmed" : "no-confirmed",
    options.includeInferred !== false ? "inferred" : "no-inferred"
  ].join("|");
}

function getCachedWidget(cacheKey) {
  const entry = widgetCache.get(cacheKey);

  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    widgetCache.delete(cacheKey);
    return null;
  }

  return entry.value;
}

function setCachedWidget(cacheKey, value) {
  if (widgetCache.size > 1000) {
    const now = Date.now();

    for (const [key, entry] of widgetCache.entries()) {
      if (!entry || entry.expiresAt <= now) {
        widgetCache.delete(key);
      }
    }
  }

  widgetCache.set(cacheKey, {
    expiresAt: Date.now() + WIDGET_CACHE_TTL_MS,
    value
  });
}

async function getBusinessWidgetData(slugOrName, options = {}) {
  const cacheKey = getWidgetCacheKey(slugOrName, options);
  const cached = getCachedWidget(cacheKey);

  if (cached) {
    return cached;
  }

  const cachedBusiness =
    typeof businessManager.getBusinessBySlugSync === "function"
      ? businessManager.getBusinessBySlugSync(slugOrName)
      : null;

  const business =
    cachedBusiness ||
    (await businessManager.getBusinessBySlug(slugOrName));

  if (!business || business.enabled === false) {
    return null;
  }

  const timezone = business.timezone || DEFAULT_TIMEZONE;
  const bookingUrl = business.bookingUrl || "";
  const limitTimes = clampLimit(options.limitTimes);

  const inventory = await inventoryManager.getInventory({
    businessName: business.businessName,
    includeInactive: false,
    includeDisabledBusinesses: false,
    includeInferred: options.includeInferred !== false,
    includeConfirmed: options.includeConfirmed !== false,
    limit: INVENTORY_ROW_LIMIT
  });

  const exactBusinessInventory = (Array.isArray(inventory) ? inventory : []).filter(
    (appointment) =>
      normalizeText(appointment.businessName) === normalizeText(business.businessName)
  );

  const dateGroups = groupAppointmentsByTime(exactBusinessInventory, {
    timezone,
    bookingUrl,
    limitTimes
  });

  const widget = {
    businessId: business.businessId || business.id || null,
    businessName: business.businessName || business.name || "Business",
    businessSlug: business.businessSlug || business.slug || slugOrName,
    businessUrl:
      business.businessUrl ||
      `/business/${business.businessSlug || business.slug || slugOrName}`,
    bookingUrl,
    timezone,
    title: "NEXT AVAILABLE APPOINTMENTS",
    totalTimeSlots: dateGroups.reduce(
      (total, group) => total + group.times.length,
      0
    ),
    dateGroups,
    poweredBy: {
      label: "Powered by NextAppt.ai",
      url: "https://nextappt.ai/"
    }
  };

  setCachedWidget(cacheKey, widget);
  return widget;
}

module.exports = {
  getBusinessWidgetData,
  groupAppointmentsByTime,
  formatDateLabel,
  formatTimeLabel,
  getServiceDisplayName
};