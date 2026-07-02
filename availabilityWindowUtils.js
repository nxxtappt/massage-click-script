function pad2(value) {
  return String(value).padStart(2, "0");
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function minutesToTimeKey(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${pad2(hours)}:${pad2(minutes)}`;
}

function timeKeyToMinutes(timeKey = "") {
  const match = String(timeKey).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  return Number(match[1]) * 60 + Number(match[2]);
}

function getAppointmentDateKey(appointment = {}) {
  return (
    appointment.localDateKey ||
    appointment.dateKey ||
    appointment.appointmentDate ||
    appointment.date ||
    ""
  );
}

function getAppointmentTimeKey(appointment = {}) {
  if (appointment.localTimeKey) return appointment.localTimeKey;

  const raw =
    appointment.time ||
    appointment.rawTime ||
    appointment.startTime ||
    "";

  const normal = String(raw).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);

  if (!normal) return "";

  let hour = Number(normal[1]);
  const minute = Number(normal[2]);
  const ampm = String(normal[3] || "").toLowerCase();

  if (ampm === "pm" && hour !== 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  return `${pad2(hour)}:${pad2(minute)}`;
}

function getProviderKey(appointment = {}) {
  return normalize(
    appointment.providerId ||
      appointment.therapistId ||
      appointment.staffId ||
      appointment.employeeId ||
      appointment.providerName ||
      appointment.therapistName ||
      appointment.staffName ||
      appointment.provider ||
      "unknown_provider"
  );
}

function buildWindowKey(parts = {}) {
  return [
    normalize(parts.businessName),
    normalize(parts.platform),
    normalize(parts.providerKey),
    parts.localDateKey || ""
  ].join("|");
}

function appointmentToAvailabilityWindow(appointment = {}) {
  const localDateKey = getAppointmentDateKey(appointment);
  const localTimeKey = getAppointmentTimeKey(appointment);
  const startMinutes = timeKeyToMinutes(localTimeKey);
  const durationMinutes = Number(appointment.durationMinutes || 0);

  if (!localDateKey || startMinutes === null || !durationMinutes) {
    return null;
  }

  const providerKey = getProviderKey(appointment);

  return {
    windowKey: buildWindowKey({
      businessName: appointment.businessName,
      platform: appointment.platform,
      providerKey,
      localDateKey
    }),

    businessName: appointment.businessName || "",
    platform: appointment.platform || "",
    bookingUrl: appointment.bookingUrl || "",

    providerKey,
    providerName:
      appointment.therapistName ||
      appointment.providerName ||
      appointment.staffName ||
      appointment.provider ||
      "",

    localDateKey,
    startMinutes,
    endMinutes: startMinutes + durationMinutes,
    startTimeKey: minutesToTimeKey(startMinutes),
    endTimeKey: minutesToTimeKey(startMinutes + durationMinutes),

    sourceAppointments: [appointment]
  };
}

function mergeWindowGroup(windows = []) {
  const sorted = [...windows].sort((a, b) => a.startMinutes - b.startMinutes);
  const merged = [];

  for (const window of sorted) {
    const last = merged[merged.length - 1];

    if (!last || window.startMinutes > last.endMinutes) {
      merged.push({ ...window });
      continue;
    }

    last.endMinutes = Math.max(last.endMinutes, window.endMinutes);
    last.endTimeKey = minutesToTimeKey(last.endMinutes);
    last.sourceAppointments = [
      ...(last.sourceAppointments || []),
      ...(window.sourceAppointments || [])
    ];
  }

  return merged;
}

function mergeAvailabilityWindows(windows = []) {
  const groups = new Map();

  windows.filter(Boolean).forEach((window) => {
    const key = window.windowKey;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(window);
  });

  return [...groups.values()].flatMap(mergeWindowGroup);
}

function buildAvailabilityWindowsFromAppointments(appointments = []) {
  const windows = appointments
    .map(appointmentToAvailabilityWindow)
    .filter(Boolean);

  return mergeAvailabilityWindows(windows);
}

function windowCanFitDuration(window = {}, durationMinutes) {
  return (
    Number(window.endMinutes) - Number(window.startMinutes) >=
    Number(durationMinutes)
  );
}

module.exports = {
  appointmentToAvailabilityWindow,
  buildAvailabilityWindowsFromAppointments,
  mergeAvailabilityWindows,
  windowCanFitDuration,
  timeKeyToMinutes,
  minutesToTimeKey
};