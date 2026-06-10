const AVAILABILITY_URL =
  "https://www.massageenvy.com/scheduling/check-multiple-availability";

function formatDateForPayload(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function toIsoDate(date) {
  return date.toISOString().split("T")[0];
}

function normalizeAppointments(payload, business) {
  const clinicId = String(business.clinicId || "");
  const serviceId = String(business.platformServiceId || business.serviceId || "");

  const rows =
    payload?.data?.[clinicId]?.[serviceId] ||
    [];

  return rows.map((item) => ({
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
    platform: "massage-envy"
  }));
}

async function scrapeMassageEnvyBusiness(browser, business) {
  const startedAt = Date.now();

  const page = await browser.newPage();

  const today = new Date();
  const end = new Date();
  end.setDate(today.getDate() + Number(business.daysForward || 7));

  const startDate = formatDateForPayload(today);
  const endDate = formatDateForPayload(end);
  const todayDate = toIsoDate(today);

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
      ? normalizeAppointments(capturedPayload, business)
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
      rawWidgetText: capturedText ? capturedText.slice(0, 5000) : null
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
      rawWidgetText: null
    };
  }
}

module.exports = {
  scrapeMassageEnvyBusiness
};