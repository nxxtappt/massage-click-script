const {
  getMindbodyBookableItems
} = require("./mindbodyApiClient");

const {
  findDimensionsMindbodyService
} = require("./mindbodyServiceMaps");

function buildDateRange(daysForward = 14) {
  const now = new Date();

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + daysForward);

  const toDateOnly = (date) => date.toISOString().split("T")[0];

  return {
    startDate: toDateOnly(start),
    endDate: toDateOnly(end)
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

function normalizeMindbodyAppointment(options = {}) {
  const {
    businessName,
    bookingUrl,
    service,
    appointment
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
    daysForward = 14
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

  const { startDate, endDate } = buildDateRange(daysForward);

  console.log("");
  console.log("===== MINDBODY API SYNC =====");
  console.log("Business:", businessName);
  console.log("Service:", service.serviceName);
  console.log("SessionTypeId:", service.sessionTypeId);
  console.log("Start:", startDate);
  console.log("End:", endDate);

  const response =
    await getMindbodyBookableItems(
      credentialId,
      {
        locationId: 1,
        sessionTypeId: service.sessionTypeId,
        startDate,
        endDate
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
      appointment
    })
  );
}

module.exports = {
  syncMindbodyBusiness
};