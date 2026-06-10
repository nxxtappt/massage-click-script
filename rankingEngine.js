// rankingEngine.js

const { normalizeServiceType } = require("./normalizationUtils");
const {
  getCurrentLocalSortable
} = require("./dateNormalizationUtils");

const DEFAULT_USER_LOCATION = {
  latitude: 30.2672,
  longitude: -97.7431
};

const DEFAULT_TIME_ZONE = "America/Chicago";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function milesBetween(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(Number(lat1)) ||
    !Number.isFinite(Number(lon1)) ||
    !Number.isFinite(Number(lat2)) ||
    !Number.isFinite(Number(lon2))
  ) {
    return null;
  }

  const earthRadiusMiles = 3958.8;
  const toRadians = (degrees) => Number(degrees) * (Math.PI / 180);

  const dLat = toRadians(Number(lat2) - Number(lat1));
  const dLon = toRadians(Number(lon2) - Number(lon1));

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return earthRadiusMiles * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getUserLocation(query = {}) {
  const latitude = Number(query.latitude || query.lat);
  const longitude = Number(query.longitude || query.lng || query.lon);

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude, longitude, isDefault: false };
  }

  return {
    ...DEFAULT_USER_LOCATION,
    isDefault: true
  };
}

function getAppointmentDistanceMiles(appointment = {}, query = {}) {
  if (Number.isFinite(Number(appointment.distanceMiles))) {
    return Number(appointment.distanceMiles);
  }

  const userLocation = getUserLocation(query);

  return milesBetween(
    userLocation.latitude,
    userLocation.longitude,
    appointment.latitude,
    appointment.longitude
  );
}

function getSoonnessMinutes(appointment = {}, options = {}) {
  const timeZone = options.timeZone || DEFAULT_TIME_ZONE;

  if (!appointment.localSortable) {
    return null;
  }

  const appointmentSortable = Number(appointment.localSortable);

  if (!Number.isFinite(appointmentSortable)) {
    return null;
  }

  const nowSortable = getCurrentLocalSortable(timeZone);

  if (!Number.isFinite(nowSortable)) {
    return null;
  }

  const appointmentText = String(appointmentSortable).padStart(12, "0");
  const nowText = String(nowSortable).padStart(12, "0");

  const appointmentYear = Number(appointmentText.slice(0, 4));
  const appointmentMonth = Number(appointmentText.slice(4, 6));
  const appointmentDay = Number(appointmentText.slice(6, 8));
  const appointmentHour = Number(appointmentText.slice(8, 10));
  const appointmentMinute = Number(appointmentText.slice(10, 12));

  const nowYear = Number(nowText.slice(0, 4));
  const nowMonth = Number(nowText.slice(4, 6));
  const nowDay = Number(nowText.slice(6, 8));
  const nowHour = Number(nowText.slice(8, 10));
  const nowMinute = Number(nowText.slice(10, 12));

  const appointmentUtc = Date.UTC(
    appointmentYear,
    appointmentMonth - 1,
    appointmentDay,
    appointmentHour,
    appointmentMinute
  );

  const nowUtc = Date.UTC(
    nowYear,
    nowMonth - 1,
    nowDay,
    nowHour,
    nowMinute
  );

  return Math.round((appointmentUtc - nowUtc) / 60000);
}

function getFreshnessMinutes(appointment = {}) {
  const checked = appointment.lastChecked || appointment.cachedAt;

  if (!checked) {
    return null;
  }

  const checkedTime = new Date(checked).getTime();

  if (Number.isNaN(checkedTime)) {
    return null;
  }

  return Math.round((Date.now() - checkedTime) / 60000);
}

function scoreDistance(distanceMiles) {
  if (!Number.isFinite(Number(distanceMiles))) return 0;

  const distance = Number(distanceMiles);

  if (distance <= 1) return 30;
  if (distance <= 3) return 24;
  if (distance <= 5) return 18;
  if (distance <= 10) return 10;
  if (distance <= 20) return 4;

  return 0;
}

function scoreSoonness(soonnessMinutes) {
  if (!Number.isFinite(Number(soonnessMinutes))) return 0;

  const minutes = Number(soonnessMinutes);

  if (minutes < 0) return -1000;
  if (minutes <= 120) return 35;
  if (minutes <= 360) return 28;
  if (minutes <= 720) return 22;
  if (minutes <= 1440) return 16;
  if (minutes <= 2880) return 8;

  return 2;
}

function scoreFreshness(freshnessMinutes) {
  if (!Number.isFinite(Number(freshnessMinutes))) return 0;

  const minutes = Number(freshnessMinutes);

  if (minutes <= 15) return 20;
  if (minutes <= 60) return 12;
  if (minutes <= 240) return 6;

  return 0;
}

function scoreServiceRelevance(appointment = {}, query = {}) {
  const requestedType = normalizeServiceType(
    query.serviceType ||
      query.serviceCategory ||
      query.service ||
      query.search ||
      ""
  );

  if (!requestedType) return 0;

  const appointmentType = normalizeServiceType(
    appointment.serviceType ||
      appointment.serviceCategory ||
      appointment.serviceName ||
      ""
  );

  if (appointmentType === requestedType) {
    return 25;
  }

  if (
    requestedType === "massage" &&
    ["massage", "swedish", "relaxation"].includes(appointmentType)
  ) {
    return 15;
  }

  return 0;
}

function scoreBusinessPriority(appointment = {}) {
  const priority = normalize(
    appointment.priority ||
      appointment.servicePriority ||
      appointment.businessPriority ||
      ""
  );

  if (priority === "critical") return 20;
  if (priority === "high") return 14;
  if (priority === "medium") return 8;
  if (priority === "low") return 2;

  return 0;
}

function scoreAppointment(appointment = {}, query = {}) {
  const distanceMiles = getAppointmentDistanceMiles(appointment, query);
  const soonnessMinutes = getSoonnessMinutes(appointment, {
    timeZone: query.timeZone || query.appointmentTimeZone || DEFAULT_TIME_ZONE
  });
  const freshnessMinutes = getFreshnessMinutes(appointment);

  const score =
    scoreSoonness(soonnessMinutes) +
    scoreDistance(distanceMiles) +
    scoreFreshness(freshnessMinutes) +
    scoreServiceRelevance(appointment, query) +
    scoreBusinessPriority(appointment);

  return {
    ...appointment,
    distanceMiles:
      Number.isFinite(Number(distanceMiles))
        ? Number(Number(distanceMiles).toFixed(2))
        : appointment.distanceMiles ?? null,

    ranking: {
      score,
      distanceMiles:
        Number.isFinite(Number(distanceMiles))
          ? Number(Number(distanceMiles).toFixed(2))
          : null,
      soonnessMinutes,
      freshnessMinutes,
      serviceType: normalizeServiceType(
        appointment.serviceType ||
          appointment.serviceCategory ||
          appointment.serviceName ||
          ""
      )
    }
  };
}

function sortAppointmentsByRanking(appointments = [], query = {}) {
  return appointments
    .map((appointment) => scoreAppointment(appointment, query))
    .sort((a, b) => {
      const scoreDiff = Number(b.ranking?.score || 0) - Number(a.ranking?.score || 0);
      if (scoreDiff !== 0) return scoreDiff;

      const aSoon = Number(a.ranking?.soonnessMinutes ?? 999999);
      const bSoon = Number(b.ranking?.soonnessMinutes ?? 999999);
      if (aSoon !== bSoon) return aSoon - bSoon;

      const aDistance = Number(a.ranking?.distanceMiles ?? 999999);
      const bDistance = Number(b.ranking?.distanceMiles ?? 999999);
      if (aDistance !== bDistance) return aDistance - bDistance;

      return String(a.businessName || "").localeCompare(String(b.businessName || ""));
    });
}

function scoreBusiness(group = {}, query = {}) {
  const appointments = Array.isArray(group.appointments) ? group.appointments : [];
  const rankedAppointments = sortAppointmentsByRanking(appointments, query);
  const bestAppointment = rankedAppointments[0] || null;

  return {
    ...group,
    appointments: rankedAppointments,
    ranking: {
      score: bestAppointment?.ranking?.score || 0,
      bestAppointment
    }
  };
}

module.exports = {
  scoreAppointment,
  sortAppointmentsByRanking,
  scoreBusiness,
  milesBetween,
  getAppointmentDistanceMiles,
  getSoonnessMinutes
};