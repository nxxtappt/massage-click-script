// utils/normalizeAppointments.js

function parseTimeTo24Hour(timeText) {
  if (!timeText) return null;

  const cleaned = String(timeText).trim();
  const match = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = match[3].toUpperCase();

  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  return { hour, minute };
}

function normalizeAxL3Date(dayOnly, fallbackYear = new Date().getFullYear(), fallbackMonth = new Date().getMonth() + 1) {
  const day = Number(dayOnly);

  if (!day || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(fallbackYear, fallbackMonth - 1, day);

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    displayDate: date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    })
  };
}

function normalizeAppointmentDateTime(appointment) {
  if (!appointment) return null;

  let dateParts = null;

  // Case 1: AXL3-style date like "15"
  if (appointment.platform === "axl3" && appointment.date && /^\d{1,2}$/.test(String(appointment.date))) {
    dateParts = normalizeAxL3Date(appointment.date);
  }

  // Case 2: already has normal date like "5/15/2026" or "May 15, 2026"
  if (!dateParts && appointment.date) {
    const parsed = new Date(appointment.date);

    if (!isNaN(parsed.getTime())) {
      dateParts = {
        year: parsed.getFullYear(),
        month: parsed.getMonth() + 1,
        day: parsed.getDate(),
        displayDate: parsed.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric"
        })
      };
    }
  }

  const timeParts = parseTimeTo24Hour(appointment.time);

  if (!dateParts || !timeParts) {
    return {
      ...appointment,
      normalized: false,
      normalizedError: "Could not normalize date/time"
    };
  }

  const datetime = new Date(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    0
  );

  return {
    ...appointment,
    date: dateParts.displayDate,
    datetime: datetime.toISOString(),
    normalized: true
  };
}

function normalizeAppointments(appointments = []) {
  return appointments
    .map(normalizeAppointmentDateTime)
    .filter(Boolean);
}

function removePastAppointments(appointments = []) {
  const now = new Date();

  return appointments.filter((appointment) => {
    if (!appointment.datetime) return false;

    const appointmentDate = new Date(appointment.datetime);

    if (isNaN(appointmentDate.getTime())) return false;

    return appointmentDate > now;
  });
}

function normalizeAndFilterAppointments(appointments = []) {
  const normalized = normalizeAppointments(appointments);
  return removePastAppointments(normalized);
}

module.exports = {
  normalizeAppointmentDateTime,
  normalizeAppointments,
  removePastAppointments,
  normalizeAndFilterAppointments
};