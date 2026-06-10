// dateNormalizationUtils.js

const DEFAULT_TIME_ZONE = "America/Chicago";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getNowPartsInTimezone(timeZone = DEFAULT_TIME_ZONE) {
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

function parseTimeParts(value) {
  if (!value) return null;

  const text = String(value).trim();

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

  const isoMatch = text.match(/T(\d{1,2}):(\d{2})/);

  if (isoMatch) {
    return {
      hour: Number(isoMatch[1]),
      minute: Number(isoMatch[2])
    };
  }

  return null;
}

function parseDateParts(value, options = {}) {
  if (!value) return null;

  const {
    platform = "",
    timeZone = DEFAULT_TIME_ZONE,
    referenceDate = null
  } = options;

  const text = String(value).trim();

  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const dateOnly = text.split("T")[0];
    const [year, month, day] = dateOnly.split("-").map(Number);

    return {
      year,
      month,
      day
    };
  }

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

  const numericDayOnly = /^\d{1,2}$/.test(text);

  if (numericDayOnly) {
    const now = referenceDate
      ? getDatePartsFromDate(referenceDate)
      : getNowPartsInTimezone(timeZone);

    let year = now.year;
    let month = now.month;
    const day = Number(text);

    /*
      AXL3 often returns only the calendar day, like "22".
      If the day appears to have already passed by more than a week,
      assume the widget is showing next month.
    */
    if (day < now.day - 7) {
      month += 1;

      if (month > 12) {
        month = 1;
        year += 1;
      }
    }

    return {
      year,
      month,
      day
    };
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

function getDatePartsFromDate(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return getNowPartsInTimezone(DEFAULT_TIME_ZONE);
  }

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes()
  };
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

function buildLocalDateTimeFields(rawDate, rawTime, options = {}) {
  const {
    platform = "",
    timeZone = DEFAULT_TIME_ZONE
  } = options;

  const dateParts =
    parseDateParts(rawDate, {
      platform,
      timeZone
    }) ||
    parseDateParts(rawTime, {
      platform,
      timeZone
    });

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
      time: rawTime || "",
      displayDate: rawDate || "",
      displayTime: rawTime || ""
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
    time: formatDisplayTime(timeParts.hour, timeParts.minute),
    displayDate: formatDisplayDate(dateParts.year, dateParts.month, dateParts.day),
    displayTime: formatDisplayTime(timeParts.hour, timeParts.minute)
  };
}

function getCurrentLocalSortable(timeZone = DEFAULT_TIME_ZONE) {
  const now = getNowPartsInTimezone(timeZone);

  return Number(
    `${now.year}${pad2(now.month)}${pad2(now.day)}${pad2(now.hour)}${pad2(now.minute)}`
  );
}

module.exports = {
  DEFAULT_TIME_ZONE,
  pad2,
  getNowPartsInTimezone,
  getCurrentLocalSortable,
  parseTimeParts,
  parseDateParts,
  buildLocalDateTimeFields,
  formatDisplayDate,
  formatDisplayTime
};