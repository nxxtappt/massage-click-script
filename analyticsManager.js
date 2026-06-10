const fs = require("fs");
const path = require("path");

const ANALYTICS_DIR = path.join(__dirname, "analytics");
const APPOINTMENT_CLICKS_FILE = path.join(
  ANALYTICS_DIR,
  "appointment-clicks.json"
);

function ensureAnalyticsFiles() {
  if (!fs.existsSync(ANALYTICS_DIR)) {
    fs.mkdirSync(ANALYTICS_DIR, {
      recursive: true
    });
  }

  if (!fs.existsSync(APPOINTMENT_CLICKS_FILE)) {
    fs.writeFileSync(
      APPOINTMENT_CLICKS_FILE,
      JSON.stringify([], null, 2)
    );
  }
}

function readAppointmentClicks() {
  ensureAnalyticsFiles();

  try {
    const parsed = JSON.parse(
      fs.readFileSync(APPOINTMENT_CLICKS_FILE, "utf8")
    );

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAppointmentClicks(clicks) {
  ensureAnalyticsFiles();

  fs.writeFileSync(
    APPOINTMENT_CLICKS_FILE,
    JSON.stringify(clicks, null, 2)
  );
}

function logAppointmentClick(payload = {}, requestMeta = {}) {
  const clicks = readAppointmentClicks();

  const click = {
    id: `click_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    clickedAt: new Date().toISOString(),

    businessName: payload.businessName || "",
    platform: payload.platform || "",
    serviceName: payload.serviceName || "",
    serviceCategory: payload.serviceCategory || "",
    durationMinutes: payload.durationMinutes || null,
    therapistName: payload.therapistName || "",

    appointmentDate: payload.appointmentDate || "",
    appointmentTime: payload.appointmentTime || "",
    startTime: payload.startTime || "",
    localDateKey: payload.localDateKey || "",
    localTimeKey: payload.localTimeKey || "",

    bookingUrl: payload.bookingUrl || "",
    sourcePage: payload.sourcePage || "search",

    userAgent: requestMeta.userAgent || "",
    referrer: requestMeta.referrer || "",
    ipAddress: requestMeta.ipAddress || ""
  };

  clicks.unshift(click);

  saveAppointmentClicks(clicks.slice(0, 10000));

  return click;
}

function getAppointmentClicks(filters = {}) {
  const clicks = readAppointmentClicks();

  return clicks.filter((click) => {
    if (filters.businessName && click.businessName !== filters.businessName) {
      return false;
    }

    return true;
  });
}

function normalizeTimeToMinutes(timeValue = "") {
  const text = String(timeValue || "").trim();

  if (!text) return null;

  const militaryMatch = text.match(/^(\d{1,2}):(\d{2})$/);

  if (militaryMatch) {
    return Number(militaryMatch[1]) * 60 + Number(militaryMatch[2]);
  }

  const standardMatch = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (standardMatch) {
    let hour = Number(standardMatch[1]);
    const minute = Number(standardMatch[2]);
    const ampm = standardMatch[3].toUpperCase();

    if (ampm === "PM" && hour !== 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;

    return hour * 60 + minute;
  }

  return null;
}

function formatBucketLabel(totalMinutes) {
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;

  if (hour12 === 0) hour12 = 12;

  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function getTimeBucket(click, bucketMinutes = 30) {
  let minutes = normalizeTimeToMinutes(click.localTimeKey);

  if (minutes === null) {
    minutes = normalizeTimeToMinutes(click.appointmentTime);
  }

  if (minutes === null && click.startTime) {
    const match = String(click.startTime).match(/T(\d{1,2}):(\d{2})/);

    if (match) {
      minutes = Number(match[1]) * 60 + Number(match[2]);
    }
  }

  if (minutes === null) {
    return {
      key: "unknown",
      label: "Unknown"
    };
  }

  const bucketStart = Math.floor(minutes / bucketMinutes) * bucketMinutes;

  return {
    key: `${String(Math.floor(bucketStart / 60)).padStart(2, "0")}:${String(
      bucketStart % 60
    ).padStart(2, "0")}`,
    label: formatBucketLabel(bucketStart)
  };
}

function getDateFromClick(click) {
  if (click.localDateKey) {
    const parsed = new Date(`${click.localDateKey}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  if (click.startTime) {
    const parsed = new Date(click.startTime);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function getWeekday(click) {
  const date = getDateFromClick(click);

  if (!date) {
    return {
      key: "unknown",
      label: "Unknown"
    };
  }

  const label = date.toLocaleDateString("en-US", {
    weekday: "long"
  });

  return {
    key: label.toLowerCase(),
    label
  };
}

function countBy(clicks, getKey) {
  const counts = {};

  clicks.forEach((click) => {
    const item = getKey(click);
    const key = item.key || "unknown";

    if (!counts[key]) {
      counts[key] = {
        key,
        label: item.label || key,
        count: 0,
        businessNames: new Set()
      };
    }

    counts[key].count += 1;

    if (click.businessName) {
      counts[key].businessNames.add(click.businessName);
    }
  });

  return Object.values(counts)
    .map((item) => ({
      key: item.key,
      label: item.label,
      count: item.count,
      uniqueBusinessCount: item.businessNames.size
    }))
    .sort((a, b) => b.count - a.count);
}

function getHeatmapMatrix(clicks = []) {
  const weekdays = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
    "Unknown"
  ];

  const matrix = {};

  clicks.forEach((click) => {
    const weekday = getWeekday(click);
    const timeBucket = getTimeBucket(click);

    const dayLabel = weekday.label || "Unknown";
    const timeLabel = timeBucket.label || "Unknown";
    const matrixKey = `${dayLabel}|${timeLabel}`;

    if (!matrix[matrixKey]) {
      matrix[matrixKey] = {
        weekday: dayLabel,
        time: timeLabel,
        timeKey: timeBucket.key,
        count: 0,
        businessNames: new Set()
      };
    }

    matrix[matrixKey].count += 1;

    if (click.businessName) {
      matrix[matrixKey].businessNames.add(click.businessName);
    }
  });

  return Object.values(matrix)
    .map((item) => ({
      weekday: item.weekday,
      time: item.time,
      timeKey: item.timeKey,
      count: item.count,
      uniqueBusinessCount: item.businessNames.size
    }))
    .sort((a, b) => {
      const dayA = weekdays.indexOf(a.weekday);
      const dayB = weekdays.indexOf(b.weekday);

      if (dayA !== dayB) return dayA - dayB;

      return String(a.timeKey).localeCompare(String(b.timeKey));
    });
}

function getBusinessClickSummary(businessName = "") {
  const clicks = getAppointmentClicks({
    businessName
  });

  const simpleCountBy = (field) => {
    const counts = {};

    clicks.forEach((click) => {
      const key = click[field] || "Unknown";
      counts[key] = (counts[key] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  };

  return {
    totalClicks: clicks.length,
    topServices: simpleCountBy("serviceName").slice(0, 5),
    topAppointmentTimes: simpleCountBy("appointmentTime").slice(0, 5),
    topWeekdays: countBy(clicks, getWeekday).slice(0, 7),
    topTimeBuckets: countBy(clicks, getTimeBucket).slice(0, 10),
    heatmap: getHeatmapMatrix(clicks),
    mostClickedAppointment: clicks.length > 0 ? clicks[0] : null
  };
}

function getCitywideClickSummary(options = {}) {
  const minimumBusinessesPerBucket = Number(
    options.minimumBusinessesPerBucket || 3
  );

  const clicks = getAppointmentClicks();

  const heatmap = getHeatmapMatrix(clicks).filter((bucket) => {
    return bucket.uniqueBusinessCount >= minimumBusinessesPerBucket;
  });

  return {
    totalClicks: clicks.length,
    minimumBusinessesPerBucket,
    topWeekdays: countBy(clicks, getWeekday)
      .filter((item) => item.uniqueBusinessCount >= minimumBusinessesPerBucket)
      .slice(0, 7),
    topTimeBuckets: countBy(clicks, getTimeBucket)
      .filter((item) => item.uniqueBusinessCount >= minimumBusinessesPerBucket)
      .slice(0, 10),
    heatmap
  };
}

module.exports = {
  logAppointmentClick,
  getAppointmentClicks,
  readAppointmentClicks,
  getBusinessClickSummary,
  getCitywideClickSummary
};