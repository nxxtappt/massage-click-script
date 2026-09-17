const { getAdapter } = require("./crmProviders/registry");
const { readCredential } = require("./database/crmCredentialRepository");
const { localDateTime } = require("./crmProviders/mindbody");

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function studioToday(timeZone = "America/Chicago") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const read = (type) => parts.find((part) => part.type === type)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function buildDateRange(options = {}) {
  const {
    scrapeStartDate = "",
    scrapeEndDate = "",
    daysForward = 14,
    timeZone = "America/Chicago"
  } = options;

  const today = studioToday(timeZone);

  if (isDateKey(scrapeStartDate) || isDateKey(scrapeEndDate)) {
    const startDate = isDateKey(scrapeStartDate)
      ? scrapeStartDate
      : today;

    const endDate = isDateKey(scrapeEndDate)
      ? scrapeEndDate
      : startDate;

    return {
      startDate,
      endDate,
      source: "scrape_window"
    };
  }

  const start = new Date(`${today}T00:00:00Z`);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + Math.max(1, Number(daysForward || 14)) - 1);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    source: "days_forward"
  };
}

function getStaffName(appointment = {}) {
  const staff =
    appointment.Staff ||
    appointment.staff ||
    appointment.Teacher ||
    appointment.teacher ||
    appointment.StaffMember ||
    appointment.staffMember ||
    {};

  return (
    staff.Name ||
    staff.DisplayName ||
    staff.FirstName ||
    appointment.staffName ||
    appointment.StaffName ||
    appointment.teacherName ||
    appointment.TeacherName ||
    "First Available"
  );
}

function getStartDateTime(appointment = {}) {
  return (
    appointment.StartDateTime ||
    appointment.startDateTime ||
    appointment.StartTime ||
    appointment.startTime ||
    appointment.StartDate ||
    appointment.startDate ||
    appointment.BookableStartDateTime ||
    appointment.bookableStartDateTime ||
    ""
  );
}

function getDateKeyFromAppointment(appointment = {}) {
  const startDateTime = getStartDateTime(appointment);

  const raw =
    appointment.rawDate ||
    appointment.date ||
    appointment.Date ||
    startDateTime ||
    "";

  const match = String(raw || "").match(/^(\d{4}-\d{2}-\d{2})/);

  return match ? match[1] : "";
}

function appointmentWithinDateRange(appointment = {}, startDate = "", endDate = "") {
  const dateKey = getDateKeyFromAppointment(appointment);

  if (!dateKey) {
    return false;
  }

  if (isDateKey(startDate) && dateKey < startDate) {
    return false;
  }

  if (isDateKey(endDate) && dateKey > endDate) {
    return false;
  }

  return true;
}

function normalizeMindbodyAppointment(options = {}) {
  const {
    businessName,
    bookingUrl,
    service,
    appointment,
    scrapeWindow = {},
    timeZone = "America/Chicago"
  } = options;

  const startDateTime = getStartDateTime(appointment);
  const parts = String(startDateTime).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!parts) throw new Error("Mindbody returned an invalid appointment start time.");
  const absoluteStart = parts[3] ? startDateTime : localDateTime(parts[1], parts[2], timeZone);

  const appointmentDate =
    appointment.rawDate ||
    appointment.date ||
    appointment.Date ||
    startDateTime ||
    "";

  const appointmentTime =
    appointment.rawTime ||
    appointment.time ||
    appointment.Time ||
    startDateTime ||
    "";

  const staff =
    appointment.Staff ||
    appointment.staff ||
    {};

  return {
    businessName,
    platform: "mindbody-api",
    integrationType: "api",
    bookingUrl,

    serviceName: service.serviceName,
    serviceType: service.serviceType,
    durationMinutes: service.durationMinutes,
    platformServiceId: service.sessionTypeId,

    therapistName: getStaffName(appointment),

    startTime: absoluteStart,
    timezone: timeZone,
    date: appointmentDate,
    time: appointmentTime,
    rawDate: appointmentDate,
    rawTime: appointmentTime,

    sourceStatus: "success",
    apiSource: "mindbody",

    scrapeStartDate: scrapeWindow.scrapeStartDate || "",
    scrapeEndDate: scrapeWindow.scrapeEndDate || "",
    lookaheadHours: scrapeWindow.lookaheadHours || null,
    daysForward: scrapeWindow.daysForward || null,
    scrapeWindowMode: scrapeWindow.scrapeWindowMode || "",

    sourceMeta: {
      apiSource: "mindbody",
      mindbodyAvailabilityId: appointment.Id || appointment.id || null,
      mindbodyStaffId: staff.Id || staff.id || appointment.StaffId || appointment.staffId || null,
      mindbodySessionTypeId:
        appointment.SessionType?.Id ||
        appointment.sessionType?.id ||
        appointment.SessionTypeId ||
        appointment.sessionTypeId ||
        service.sessionTypeId,
      endDateTime:
        appointment.EndDateTime ||
        appointment.endDateTime ||
        appointment.BookableEndDateTime ||
        appointment.bookableEndDateTime ||
        ""
    }
  };
}

async function syncMindbodyBusiness(options = {}) {
  const {
    credentialId,
    businessName,
    businessIdentity,
    bookingUrl,
    serviceType,
    durationMinutes,
    serviceName,
    platformServiceId,
    sessionTypeId,
    scrapeStartDate = "",
    scrapeEndDate = "",
    lookaheadHours = null,
    daysForward = 14,
    scrapeWindowMode = ""
  } = options;

  const resolvedSessionTypeId = Number(sessionTypeId || platformServiceId);
  if (!Number.isSafeInteger(resolvedSessionTypeId) || resolvedSessionTypeId <= 0) {
    throw new Error(`A mapped numeric Mindbody session type is required for ${serviceName || serviceType}.`);
  }
  const service = {
    sessionTypeId: resolvedSessionTypeId,
    serviceName: serviceName || serviceType,
    serviceType,
    durationMinutes
  };

  const credential = await readCredential(credentialId, businessIdentity || businessName);
  if (credential.provider !== "mindbody") throw new Error("Credential provider does not match Mindbody integration.");
  const locationId = Number(credential.metadata.locationId);
  if (!Number.isSafeInteger(locationId) || locationId <= 0) throw new Error("Mindbody Location ID is missing from the active credential.");

  const dateRange = buildDateRange({
    scrapeStartDate,
    scrapeEndDate,
    daysForward,
    timeZone: credential.metadata.timeZone || "America/Chicago"
  });

  const scrapeWindow = {
    scrapeStartDate: scrapeStartDate || dateRange.startDate,
    scrapeEndDate: scrapeEndDate || dateRange.endDate,
    lookaheadHours,
    daysForward,
    scrapeWindowMode: scrapeWindowMode || dateRange.source
  };

  const appointments = await getAdapter("mindbody").getBookableItems({
    apiKey: credential.apiKey,
    siteId: credential.metadata.siteId
  }, {
    locationId,
    sessionTypeId: service.sessionTypeId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    timeZone: credential.metadata.timeZone || "America/Chicago"
  });
  const validAppointments = appointments.filter((appointment) => {
      const startDateTime = getStartDateTime(appointment);

      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(String(startDateTime))) {
        throw new Error("Mindbody returned an availability without a valid start time; inventory was not refreshed.");
      }

      if (!appointmentWithinDateRange(appointment, dateRange.startDate, dateRange.endDate)) {
        return false;
      }

      return true;
    });

  console.log(
    `[MINDBODY API] ${businessName} ${service.serviceName}: ${validAppointments.length} bookable appointment(s)`
  );

  return validAppointments.map((appointment) =>
    normalizeMindbodyAppointment({
      businessName,
      bookingUrl,
      service,
      appointment,
      scrapeWindow,
      timeZone: credential.metadata.timeZone || "America/Chicago"
    })
  );
}

module.exports = {
  syncMindbodyBusiness
};
