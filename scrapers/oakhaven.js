const ENDPOINT =
  "https://oakhavenbooking.com/backend/endPoints.php";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateKey(value) {
  if (!isDateKey(value)) {
    return null;
  }

  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function getTodayDateKey() {
  const now = new Date();
  return formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0));
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + Number(days || 0));
  return copy;
}

function buildDateList(startDateKey, endDateKey) {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);

  if (!start || !end) {
    return [];
  }

  const dates = [];
  let cursor = start;

  while (formatDate(cursor) <= formatDate(end)) {
    dates.push(formatDate(cursor));
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function getScrapeWindow(business = {}) {
  const today = getTodayDateKey();
  const daysForward = Math.max(1, Number(business.daysForward || 7));

  const scrapeStartDate = isDateKey(business.scrapeStartDate)
    ? business.scrapeStartDate
    : today;

  const defaultEndDate = formatDate(
    addDays(parseDateKey(scrapeStartDate), daysForward - 1)
  );

  const scrapeEndDate = isDateKey(business.scrapeEndDate)
    ? business.scrapeEndDate
    : defaultEndDate;

  const dateList = buildDateList(scrapeStartDate, scrapeEndDate);

  return {
    scrapeStartDate,
    scrapeEndDate,
    lookaheadHours: business.lookaheadHours || dateList.length * 24 || daysForward * 24,
    daysForward: dateList.length || daysForward,
    scrapeWindowMode: business.scrapeWindowMode || "days_forward",
    dateList
  };
}

async function postOakHaven(payload) {
  const body = new URLSearchParams(payload);

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type":
        "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest"
    },
    body
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Oak Haven request failed (${response.status}) ${text}`
    );
  }

  return JSON.parse(text);
}

function normalizeAppointments(data, business, searchDate, scrapeWindow) {
  const appointments = [];

  const therapists = Array.isArray(
    data.AvailabilitiesTherapistOption
  )
    ? data.AvailabilitiesTherapistOption
    : [];

  for (const therapist of therapists) {
    const timingArray = Array.isArray(therapist.TimingArray)
      ? therapist.TimingArray
      : [];

    for (const slot of timingArray) {
      appointments.push({
        date: searchDate,
        appointmentDate: searchDate,
        startTime: slot[0],
        endTime: slot[1],
        time: slot[0],
        therapistName:
          `${therapist.FirstName || ""} ${therapist.LastName || ""}`.trim(),
        therapistId: therapist.MbId || "",
        bookingUrl: business.bookingUrl,
        serviceName: business.serviceName,
        service: business.serviceName,
        serviceType: business.serviceType,
        durationMinutes: business.durationMinutes,
        platform: "oakhaven",
        scrapeStartDate: scrapeWindow.scrapeStartDate,
        scrapeEndDate: scrapeWindow.scrapeEndDate,
        lookaheadHours: scrapeWindow.lookaheadHours,
        daysForward: scrapeWindow.daysForward,
        scrapeWindowMode: scrapeWindow.scrapeWindowMode
      });
    }
  }

  return appointments;
}

async function scrapeOakHavenBusiness(business) {
  const appointments = [];
  const scrapeWindow = getScrapeWindow(business);

  console.log(`\n[OAKHAVEN] Opening ${business.businessName}`);
  console.log("[OAKHAVEN] Scrape window:", {
    scrapeStartDate: scrapeWindow.scrapeStartDate,
    scrapeEndDate: scrapeWindow.scrapeEndDate,
    lookaheadHours: scrapeWindow.lookaheadHours,
    daysForward: scrapeWindow.daysForward,
    scrapeWindowMode: scrapeWindow.scrapeWindowMode
  });

  if (!scrapeWindow.dateList.length) {
    throw new Error(
      `Invalid Oak Haven scrape window: ${scrapeWindow.scrapeStartDate} to ${scrapeWindow.scrapeEndDate}`
    );
  }

  for (const searchDate of scrapeWindow.dateList) {
    const payload = {
      function: "checkTherapistFromDB",
      tier: business.tier || "1",
      placeId: business.placeId || "1",
      siteid: business.siteid || "1",
      LocationIds: business.LocationIds || "4",
      category:
        business.category || "Cutomize My Session",
      SessionTypeIds:
        business.SessionTypeIds || "5",
      PressureTypeIds:
        business.PressureTypeIds || "227",
      gender: business.gender || "None",
      StartDate: searchDate,
      EndDate: searchDate,
      StaffId: "",
      TimeToFilter: ""
    };

    console.log("[OAKHAVEN] Checking:", searchDate);

    const data = await postOakHaven(payload);

    appointments.push(
      ...normalizeAppointments(
        data,
        business,
        searchDate,
        scrapeWindow
      )
    );
  }

  const times = appointments
    .map((appointment) => appointment.startTime)
    .filter(Boolean);

  return {
    businessName: business.businessName,
    bookingUrl: business.bookingUrl,
    platform: "oakhaven",
    service: business.serviceName,
    serviceName: business.serviceName,
    serviceType: business.serviceType || "",
    durationMinutes: business.durationMinutes || null,
    provider: business.providerText || "No Preference",
    date: null,
    times,
    status: appointments.length > 0 ? "success" : "no_times_found",
    lastChecked: new Date().toISOString(),
    appointments,
    openings: appointments,
    rawWidgetText: null,
    scrapeStartDate: scrapeWindow.scrapeStartDate,
    scrapeEndDate: scrapeWindow.scrapeEndDate,
    lookaheadHours: scrapeWindow.lookaheadHours,
    daysForward: scrapeWindow.daysForward,
    scrapeWindowMode: scrapeWindow.scrapeWindowMode
  };
}

module.exports = {
  scrapeOakHavenBusiness
};