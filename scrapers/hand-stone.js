// scrapers/hand-stone.js

const API_URL = "https://handandstone.com/api/booking/get-available-booking-slots/";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateKeyFromDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(dateKey, daysToAdd) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return dateKeyFromDate(new Date(year, month - 1, day + daysToAdd, 12, 0, 0));
}

function getTodayAustinDateKey() {
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

function buildDateList(job = {}) {
  const startDate = job.scrapeStartDate || getTodayAustinDateKey();
  const daysForward = Math.max(1, Number(job.daysForward || 1));

  const dates = [];
  for (let i = 0; i < daysForward; i += 1) {
    dates.push(addDays(startDate, i));
  }

  return dates;
}

function formatDisplayTime(localIsoTime) {
  const match = String(localIsoTime || "").match(/T(\d{2}):(\d{2})/);

  if (!match) {
    return localIsoTime;
  }

  let hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";

  hour = hour % 12;
  if (hour === 0) hour = 12;

  return `${hour}:${minute} ${suffix}`;
}

async function fetchHandStoneSlotsForDate(job = {}, dateKey) {
  const centerId = job.centerId || job.center_id;
  const itemId =
    job.serviceId ||
    job.platformServiceId ||
    job.serviceButtonId ||
    job.itemId;

  if (!centerId) {
    throw new Error("Hand & Stone centerId is required.");
  }

  if (!itemId) {
    throw new Error("Hand & Stone serviceId/item id is required.");
  }

  const payload = {
    center_id: centerId,
    dates: [dateKey],
    is_only_catalog_employees: true,
    guests: [
      {
        items: [
          {
            item: {
              id: itemId
            },
            therapist: {
              gender: Number(job.therapistGender ?? 0)
            },
            add_ons: []
          }
        ]
      }
    ]
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Accept": "*/*",
      "Content-Type": "application/json",
      "Origin": "https://handandstone.com",
      "Referer": job.bookingUrl || "https://handandstone.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Hand & Stone API failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function scrapeHandStoneBusiness(job = {}) {
  const startedAt = Date.now();
  const dates = buildDateList(job);

  const appointments = [];
  const futureDays = [];

  for (const dateKey of dates) {
    const json = await fetchHandStoneSlotsForDate(job, dateKey);
    const dayData = Array.isArray(json.data) ? json.data[0] : null;

    if (!dayData) continue;

    if (Array.isArray(dayData.future_days)) {
      futureDays.push(...dayData.future_days);
    }

    const slots = Array.isArray(dayData.slots) ? dayData.slots : [];

    slots
      .filter((slot) => slot && slot.Available === true && slot.Time)
      .forEach((slot) => {
        const startTime = slot.Time;
        const localDateKey = String(startTime).slice(0, 10);
        const localTimeKey = String(startTime).slice(11, 16);

        appointments.push({
        date: localDateKey,
        time: formatDisplayTime(startTime),
        startTime,
        localDateKey,
        localTimeKey,
        rawTime: startTime,
        serviceName: job.serviceName || "Classic Massage",
        serviceType: job.serviceType || "massage",
        durationMinutes: job.durationMinutes || null,
        therapistName: "Any Therapist",
        providerName: "Any Therapist",
        price: slot.SalePrice || job.price || null,
        bookingUrl: job.bookingUrl || "",
        platform: "hand-stone"
        });
      });
  }

  const times = appointments.map((appointment) => appointment.startTime);

  return {
    businessName: job.businessName,
    bookingUrl: job.bookingUrl,
    platform: "hand-stone",
    service: job.serviceName || "Classic Massage",
    serviceName: job.serviceName || "Classic Massage",
    serviceType: job.serviceType || "massage",
    durationMinutes: job.durationMinutes || null,
    platformServiceId:
      job.platformServiceId || job.serviceId || job.serviceButtonId || null,
    provider: "Any Therapist",
    date: null,
    times,
    status: appointments.length > 0 ? "success" : "no_times_found",
    error: null,
    scrapeDurationMs: Date.now() - startedAt,
    lastChecked: new Date().toISOString(),
    appointments,
    futureDays,
    rawWidgetText: null
  };
}

module.exports = {
  scrapeHandStoneBusiness
};