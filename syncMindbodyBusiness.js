const {
  getMindbodyBookableItems
} = require("./mindbodyApiClient");

const {
  findDimensionsMindbodyService
} = require("./mindbodyServiceMaps");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function toDateOnly(date) {
  return date.toISOString().split("T")[0];
}

function buildDateRange(options = {}) {
  const {
    scrapeStartDate = "",
    scrapeEndDate = "",
    daysForward = 14
  } = options;

  if (isDateKey(scrapeStartDate) || isDateKey(scrapeEndDate)) {
    const now = new Date();
    const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

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

  const now = new Date();

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(1, Number(daysForward || 14)) - 1);

  return {
    startDate: toDateOnly(start),
    endDate: toDateOnly(end),
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
    scrapeWindow = {}
  } = options;

  const startDateTime = getStartDateTime(appointment);

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

    startTime: startDateTime,
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

function extractBookableAppointments(response = {}) {
  const possibleArrays = [
    response.Availabilities,
    response.availabilities,
    response.Appointments,
    response.appointments,
    response.BookableItems,
    response.bookableItems,
    response.Items,
    response.items,
    response.Data,
    response.data
  ];

  for (const value of possibleArrays) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

async function syncMindbodyBusiness(options = {}) {
  const {
    credentialId,
    businessName,
    bookingUrl,
    serviceType,
    durationMinutes,
    scrapeStartDate = "",
    scrapeEndDate = "",
    lookaheadHours = null,
    daysForward = 14,
    scrapeWindowMode = ""
  } = options;

  const service =
    findDimensionsMindbodyService({
      serviceType,
      durationMinutes
    });

  if (!service) {
    throw new Error(
      `No mapped Mindbody service found for ${serviceType} ${durationMinutes}`
    );
  }

  const dateRange = buildDateRange({
    scrapeStartDate,
    scrapeEndDate,
    daysForward
  });

  const scrapeWindow = {
    scrapeStartDate: scrapeStartDate || dateRange.startDate,
    scrapeEndDate: scrapeEndDate || dateRange.endDate,
    lookaheadHours,
    daysForward,
    scrapeWindowMode: scrapeWindowMode || dateRange.source
  };

  console.log("");
  console.log("===== MINDBODY API SYNC =====");
  console.log("Business:", businessName);
  console.log("Service:", service.serviceName);
  console.log("SessionTypeId:", service.sessionTypeId);
  console.log("Start:", dateRange.startDate);
  console.log("End:", dateRange.endDate);
  console.log("[MINDBODY API] Scrape window:", scrapeWindow);

  const response =
    await getMindbodyBookableItems(
      credentialId,
      {
        locationId: 1,
        sessionTypeId: service.sessionTypeId,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      }
    );

  console.log("[MINDBODY API RAW KEYS]", Object.keys(response || {}));
  console.log(
    "[MINDBODY API RAW SAMPLE]",
    JSON.stringify(response, null, 2).slice(0, 5000)
  );

  const appointments =
    extractBookableAppointments(response).filter((appointment) => {
      const startDateTime = getStartDateTime(appointment);

      if (!startDateTime) {
        return false;
      }

      if (!appointmentWithinDateRange(appointment, dateRange.startDate, dateRange.endDate)) {
        return false;
      }

      const minuteMatch = String(startDateTime).match(/T\d{2}:(\d{2})/);
      const minute = minuteMatch ? Number(minuteMatch[1]) : null;

      return [0, 15, 30, 45].includes(minute);
    });

  console.log(
    `[MINDBODY API] Found ${appointments.length} appointment(s)`
  );

  return appointments.map((appointment) =>
    normalizeMindbodyAppointment({
      businessName,
      bookingUrl,
      service,
      appointment,
      scrapeWindow
    })
  );
}

module.exports = {
  syncMindbodyBusiness
};