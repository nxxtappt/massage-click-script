const ENDPOINT =
  "https://oakhavenbooking.com/backend/endPoints.php";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
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

function normalizeAppointments(data, business) {
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
        startTime: slot[0],
        endTime: slot[1],
        therapistName:
          `${therapist.FirstName || ""} ${therapist.LastName || ""}`.trim(),
        therapistId: therapist.MbId || "",
        bookingUrl: business.bookingUrl,
        serviceName: business.serviceName,
        serviceType: business.serviceType,
        durationMinutes: business.durationMinutes
      });
    }
  }

  return appointments;
}

async function scrapeOakHavenBusiness(business) {
  const appointments = [];

  const daysForward = Number(
    business.daysForward || 7
  );

  for (let day = 0; day < daysForward; day++) {
    const searchDate = formatDate(
      addDays(new Date(), day)
    );

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

    const data = await postOakHaven(payload);

    appointments.push(
      ...normalizeAppointments(data, business)
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
  rawWidgetText: null
};
}

module.exports = {
  scrapeOakHavenBusiness
};