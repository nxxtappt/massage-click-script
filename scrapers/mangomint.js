const MANGOMINT_AVAILABILITY_URL =
  "https://booking.mangomint.com/api/v1/booking/service-providers/availability";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getTodayDateKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const map = {};
  parts.forEach((part) => {
    if (part.type !== "literal") map[part.type] = part.value;
  });

  return `${map.year}-${map.month}-${map.day}`;
}

function addDaysToDateKey(dateKey, daysToAdd) {
  const [year, month, day] = String(dateKey || getTodayDateKey())
    .split("-")
    .map(Number);

  const date = new Date(year, month - 1, day + Number(daysToAdd || 0), 12, 0, 0);

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )}`;
}

function formatDisplayTime(startAtLocal) {
  const parsed = new Date(startAtLocal);

  if (Number.isNaN(parsed.getTime())) {
    return String(startAtLocal || "");
  }

  return parsed.toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit"
  });
}

function normalizeSlot(slot, dateKey, timeGroup, business = {}) {
  const startAtLocal = slot?.startAtLocal || "";

  return {
    date: dateKey,
    time: formatDisplayTime(startAtLocal),
    startTime: startAtLocal,
    startAtLocal,
    providerName: "Anyone",
    therapistName: "Anyone",
    staffName: "Anyone",
    timeGroup,
    serviceName: business.serviceName || business.service || "",
    serviceType: business.serviceType || "",
    durationMinutes: business.durationMinutes || null,
    bookingUrl: business.bookingUrl || "",
    platform: "mangomint"
  };
}

function extractOpenings(payload = {}, business = {}) {
  const availabilityByDays = payload.availabilityByDays || {};
  const openings = [];

  Object.entries(availabilityByDays).forEach(([dateKey, day]) => {
    [
      ["morning", day.morningAvailableSlots],
      ["afternoon", day.afternoonAvailableSlots],
      ["evening", day.eveningAvailableSlots]
    ].forEach(([timeGroup, slots]) => {
      if (!Array.isArray(slots)) return;

      slots.forEach((slot) => {
        openings.push(normalizeSlot(slot, dateKey, timeGroup, business));
      });
    });
  });

  return openings.sort((a, b) => {
    return String(a.startAtLocal || "").localeCompare(String(b.startAtLocal || ""));
  });
}

function buildMangomintHeaders(business = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: "https://booking.mangomint.com",
    Referer: business.bookingUrl || "https://booking.mangomint.com/",
    "X-Mt-Booking-Companyid": String(
      business.companyId || business.mangomintCompanyId || ""
    ),
    "X-Mt-Booking-Locationid": String(
      business.locationId || business.mangomintLocationId || "1"
    )
  };

  if (business.appInstanceId || business.mangomintAppInstanceId) {
    headers["X-Mt-App-Instance-Id"] = String(
      business.appInstanceId || business.mangomintAppInstanceId
    );
  }

  if (business.appVersion || business.mangomintAppVersion) {
    headers["X-Mt-App-Version"] = String(
      business.appVersion || business.mangomintAppVersion
    );
  }

  return headers;
}

function buildMangomintPayload(business = {}) {
  const startDate = business.scrapeStartDate || getTodayDateKey();
  const daysForward = Math.max(1, Number(business.daysForward || 7));

  return {
    startDate,
    initialLoad: true,
    numDays: daysForward,
    services: [
      {
        serviceId: Number(
          business.serviceId || business.platformServiceId || business.serviceButtonId
        ),
        staffId: business.staffId || null,
        staffCategory: business.staffCategory || "Any",
        additionalStaffId: business.additionalStaffId || null
      }
    ]
  };
}

async function scrapeMangomintBusiness(business = {}) {
  const startedAt = Date.now();

  const companyId = business.companyId || business.mangomintCompanyId;
  const locationId = business.locationId || business.mangomintLocationId || "1";
  const serviceId =
    business.serviceId || business.platformServiceId || business.serviceButtonId;

  if (!business.bookingUrl) {
    throw new Error("Mangomint bookingUrl is required.");
  }

  if (!companyId) {
    throw new Error("Mangomint companyId is required.");
  }

  if (!locationId) {
    throw new Error("Mangomint locationId is required.");
  }

  if (!serviceId) {
    throw new Error("Mangomint serviceId is required.");
  }

  const payload = buildMangomintPayload(business);

  const response = await fetch(MANGOMINT_AVAILABILITY_URL, {
    method: "POST",
    headers: buildMangomintHeaders(business),
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();

  let data = null;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Mangomint returned non-JSON response. Status ${response.status}. Body starts with: ${responseText.slice(
        0,
        160
      )}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Mangomint availability request failed. Status ${response.status}: ${JSON.stringify(
        data
      ).slice(0, 300)}`
    );
  }

  const openings = extractOpenings(data, business);
  const times = openings.map((opening) => opening.startTime).filter(Boolean);

  return {
    businessName: business.businessName || business.name || "",
    bookingUrl: business.bookingUrl,
    platform: "mangomint",
    service: business.serviceName || business.service || "",
    serviceName: business.serviceName || business.service || "",
    serviceType: business.serviceType || "",
    durationMinutes: business.durationMinutes || null,
    platformServiceId: serviceId,
    provider: business.staffCategory || "Anyone",
    date: null,
    times,
    status: times.length > 0 ? "success" : "no_times_found",
    scrapeDurationMs: Date.now() - startedAt,
    lastChecked: new Date().toISOString(),
    openings,
    appointments: openings,
    firstAvailableLocalDate: data.firstAvailableLocalDate || null,
    searchTimedOut: data.searchTimedOut === true,
    weekIndexWithFirstAvailableDay: data.weekIndexWithFirstAvailableDay ?? null,
    scrapeStartDate: business.scrapeStartDate || payload.startDate,
    scrapeEndDate:
      business.scrapeEndDate || addDaysToDateKey(payload.startDate, payload.numDays - 1),
    lookaheadHours: business.lookaheadHours || payload.numDays * 24,
    daysForward: payload.numDays,
    scrapeWindowMode: business.scrapeWindowMode || "",
    rawMangomintSummary: {
      availabilityDays: Object.keys(data.availabilityByDays || {}).length,
      companyId: String(companyId),
      locationId: String(locationId),
      serviceId: Number(serviceId)
    }
  };
}

module.exports = {
  scrapeMangomintBusiness
};