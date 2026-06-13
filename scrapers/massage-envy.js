const AVAILABILITY_URL =
  "https://www.massageenvy.com/scheduling/check-multiple-availability";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function formatDateKey(date) {
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
  return formatDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function formatDateForPayload(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function toIsoDate(date) {
  return formatDateKey(date);
}

function getScrapeWindow(business = {}) {
  const today = getTodayDateKey();
  const daysForward = Math.max(1, Number(business.daysForward || 7));

  const scrapeStartDate = isDateKey(business.scrapeStartDate)
    ? business.scrapeStartDate
    : today;

  const defaultEndDate = formatDateKey(
    addDays(parseDateKey(scrapeStartDate), daysForward - 1)
  );

  const scrapeEndDate = isDateKey(business.scrapeEndDate)
    ? business.scrapeEndDate
    : defaultEndDate;

  return {
    scrapeStartDate,
    scrapeEndDate,
    lookaheadHours:
      business.lookaheadHours ||
      daysForward * 24,
    daysForward,
    scrapeWindowMode:
      business.scrapeWindowMode ||
      "days_forward"
  };
}

function appointmentDateKey(item = {}) {
  const raw =
    item.date ||
    item.startTime ||
    item.startDateTime ||
    "";

  const match = String(raw || "").match(/^(\d{4}-\d{2}-\d{2})/);

  return match ? match[1] : "";
}

function appointmentInsideWindow(item = {}, scrapeWindow = {}) {
  const dateKey = appointmentDateKey(item);

  if (!dateKey) {
    return true;
  }

  if (isDateKey(scrapeWindow.scrapeStartDate) && dateKey < scrapeWindow.scrapeStartDate) {
    return false;
  }

  if (isDateKey(scrapeWindow.scrapeEndDate) && dateKey > scrapeWindow.scrapeEndDate) {
    return false;
  }

  return true;
}

function normalizeAppointments(payload, business, scrapeWindow) {
  const clinicId = String(business.clinicId || "");
  const serviceId = String(business.platformServiceId || business.serviceId || "");

  const rows =
    payload?.data?.[clinicId]?.[serviceId] ||
    [];

  return rows
    .filter((item) => appointmentInsideWindow(item, scrapeWindow))
    .map((item) => ({
      date: item.date || "",
      startTime: item.startTime || "",
      endTime: item.endTime || "",
      serviceName: item.serviceName || business.serviceName || "",
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      therapistName:
        item.employeeName ||
        item.employeeFirstName ||
        item.employeeDisplayName ||
        "Any Therapist",
      employeeId: item.employeeId || "",
      providerName:
        item.employeeName ||
        item.employeeFirstName ||
        item.employeeDisplayName ||
        "",
      bookingUrl: business.bookingUrl || "",
      platform: "massage-envy",
      scrapeStartDate: scrapeWindow.scrapeStartDate,
      scrapeEndDate: scrapeWindow.scrapeEndDate,
      lookaheadHours: scrapeWindow.lookaheadHours,
      daysForward: scrapeWindow.daysForward,
      scrapeWindowMode: scrapeWindow.scrapeWindowMode
    }));
}

async function scrapeMassageEnvyBusiness(browser, business) {
  const startedAt = Date.now();

  const page = await browser.newPage();

  const scrapeWindow = getScrapeWindow(business);

  const start = parseDateKey(scrapeWindow.scrapeStartDate);
  const end = parseDateKey(scrapeWindow.scrapeEndDate);

  const startDate = formatDateForPayload(start);
  const endDate = formatDateForPayload(end);
  const todayDate = toIsoDate(start);

  const serviceId =
    business.platformServiceId ||
    business.serviceId ||
    "";

  const body = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    serviceId,
    todayDate
  }).toString();

  let capturedPayload = null;
  let capturedText = "";

  page.on("response", async (response) => {
    if (!response.url().includes("/scheduling/check-multiple-availability")) {
      return;
    }

    try {
      capturedText = await response.text();
      capturedPayload = JSON.parse(capturedText);
    } catch {
      // keep raw text
    }
  });

  try {
    console.log(`\n[MASSAGE ENVY] Opening ${business.businessName}`);
    console.log("[MASSAGE ENVY] Scrape window:", scrapeWindow);
    console.log("[MASSAGE ENVY] Payload dates:", {
      start_date: startDate,
      end_date: endDate,
      todayDate
    });

    await page.goto(business.bookingUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    const result = await page.evaluate(
      async ({ AVAILABILITY_URL, body }) => {
        const response = await fetch(AVAILABILITY_URL, {
          method: "POST",
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Apikey": "63D20FB6-DBC2-47EE-AB58-58E8EB29089A",
            "X-Requested-With": "XMLHttpRequest"
          },
          body,
          credentials: "same-origin"
        });

        const text = await response.text();

        return {
          status: response.status,
          contentType: response.headers.get("content-type") || "",
          text
        };
      },
      { AVAILABILITY_URL, body }
    );

    if (!capturedPayload && result.text) {
      try {
        capturedPayload = JSON.parse(result.text);
      } catch {
        capturedText = result.text;
      }
    }

    const appointments = capturedPayload
      ? normalizeAppointments(capturedPayload, business, scrapeWindow)
      : [];

    await page.close().catch(() => null);

    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "massage-envy",
      service: business.serviceName,
      serviceName: business.serviceName,
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      platformServiceId: serviceId,
      provider: "Any Therapist",
      date: null,
      times: appointments.map((x) => x.startTime).filter(Boolean),
      status: appointments.length ? "success" : "no_times_found",
      attemptNumber: 1,
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      appointments,
      openings: appointments,
      distanceMiles: business.distanceMiles || null,
      rawWidgetText: capturedText ? capturedText.slice(0, 5000) : null,
      ...scrapeWindow
    };
  } catch (error) {
    await page.close().catch(() => null);

    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "massage-envy",
      service: business.serviceName,
      serviceName: business.serviceName,
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      platformServiceId: serviceId,
      provider: "Any Therapist",
      date: null,
      times: [],
      status: "error",
      error: error.message,
      attemptNumber: 1,
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      appointments: [],
      openings: [],
      rawWidgetText: null,
      ...scrapeWindow
    };
  }
}

module.exports = {
  scrapeMassageEnvyBusiness
};