const {
  minutesToTimeKey,
  windowCanFitDuration
} = require("./availabilityWindowUtils");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDisplayTime(timeKey = "") {
  const [hourRaw, minuteRaw] = String(timeKey).split(":").map(Number);

  if (Number.isNaN(hourRaw) || Number.isNaN(minuteRaw)) {
    return "";
  }

  const suffix = hourRaw >= 12 ? "PM" : "AM";
  let displayHour = hourRaw % 12;

  if (displayHour === 0) displayHour = 12;

  return `${displayHour}:${pad2(minuteRaw)} ${suffix}`;
}

function buildStartTime(localDateKey, timeKey) {
  if (!localDateKey || !timeKey) return "";
  return `${localDateKey}T${timeKey}:00`;
}

function generateSlotsFromWindow(window = {}, options = {}) {
  const {
    durationMinutes,
    stepMinutes = 30,
    serviceTemplate = {},
    confidenceScore = 0.85,
    inferenceMode = "window_based"
  } = options;

  const duration = Number(durationMinutes || serviceTemplate.durationMinutes || 0);

  if (!duration || !windowCanFitDuration(window, duration)) {
    return [];
  }

  const slots = [];

  for (
    let start = Number(window.startMinutes);
    start + duration <= Number(window.endMinutes);
    start += Number(stepMinutes)
  ) {
    const localTimeKey = minutesToTimeKey(start);
    const endTimeKey = minutesToTimeKey(start + duration);

    slots.push({
      ...serviceTemplate,

      businessName: window.businessName || serviceTemplate.businessName || "",
      platform: window.platform || serviceTemplate.platform || "",
      bookingUrl: window.bookingUrl || serviceTemplate.bookingUrl || "",

      serviceName: serviceTemplate.serviceName || "",
      serviceCategory:
        serviceTemplate.serviceCategory ||
        serviceTemplate.serviceType ||
        "",

      serviceType:
        serviceTemplate.serviceType ||
        serviceTemplate.serviceCategory ||
        "",

      durationMinutes: duration,

      therapistName:
        window.providerName ||
        serviceTemplate.therapistName ||
        serviceTemplate.providerName ||
        "",

      providerKey: window.providerKey || "",

      localDateKey: window.localDateKey,
      localTimeKey,
      startTime: buildStartTime(window.localDateKey, localTimeKey),
      endTime: buildStartTime(window.localDateKey, endTimeKey),

      time: formatDisplayTime(localTimeKey),
      rawTime: localTimeKey,

      sourceType: "inferred",
      inferenceMode,
      confidence: confidenceScore >= 0.9 ? "high" : "medium_high",
      confidenceScore,

      inferenceWindow: {
        windowKey: window.windowKey,
        startTimeKey: window.startTimeKey,
        endTimeKey: window.endTimeKey,
        sourceAppointmentCount: Array.isArray(window.sourceAppointments)
          ? window.sourceAppointments.length
          : 0
      }
    });
  }

  return slots;
}

function generateSlotsFromWindows(windows = [], options = {}) {
  return windows.flatMap((window) =>
    generateSlotsFromWindow(window, options)
  );
}

module.exports = {
  generateSlotsFromWindow,
  generateSlotsFromWindows
};