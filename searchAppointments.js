const { parseCliFilters } = require("./jobBuilder");
const { getCachedAppointments, getCacheStats } = require("./cacheManager");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimeToMinutes(timeText) {
  const match = String(timeText || "").match(
    /^([1-9]|1[0-2]):([0-5][0-9])\s?(AM|PM)$/i
  );

  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

function appointmentMatchesSearch(item, filters = {}) {
  if (
    filters.query &&
    ![
      item.businessName,
      item.serviceName,
      item.service,
      item.serviceType,
      item.platform
    ]
      .map(normalize)
      .join(" ")
      .includes(normalize(filters.query))
  ) {
    return false;
  }

  if (
    filters.hasTimes &&
    (!Array.isArray(item.times) || item.times.length === 0)
  ) {
    return false;
  }

  if (filters.maxDistanceMiles && typeof item.distanceMiles === "number") {
    if (item.distanceMiles > Number(filters.maxDistanceMiles)) {
      return false;
    }
  }

  if (filters.afterTime || filters.beforeTime) {
    const afterMinutes = filters.afterTime
      ? parseTimeToMinutes(filters.afterTime)
      : null;

    const beforeMinutes = filters.beforeTime
      ? parseTimeToMinutes(filters.beforeTime)
      : null;

    const matchingTimes = (item.times || []).filter((time) => {
      const minutes = parseTimeToMinutes(time);

      if (minutes === null) return false;

      if (afterMinutes !== null && minutes < afterMinutes) return false;
      if (beforeMinutes !== null && minutes > beforeMinutes) return false;

      return true;
    });

    if (matchingTimes.length === 0) {
      return false;
    }
  }

  return true;
}

function applyTimeWindowToItem(item, filters = {}) {
  if (!filters.afterTime && !filters.beforeTime) {
    return item;
  }

  const afterMinutes = filters.afterTime
    ? parseTimeToMinutes(filters.afterTime)
    : null;

  const beforeMinutes = filters.beforeTime
    ? parseTimeToMinutes(filters.beforeTime)
    : null;

  const filteredTimes = (item.times || []).filter((time) => {
    const minutes = parseTimeToMinutes(time);

    if (minutes === null) return false;

    if (afterMinutes !== null && minutes < afterMinutes) return false;
    if (beforeMinutes !== null && minutes > beforeMinutes) return false;

    return true;
  });

  return {
    ...item,
    times: filteredTimes
  };
}

function sortAppointments(results = []) {
  return [...results].sort((a, b) => {
    const distanceA =
      typeof a.distanceMiles === "number" ? a.distanceMiles : 999999;

    const distanceB =
      typeof b.distanceMiles === "number" ? b.distanceMiles : 999999;

    if (distanceA !== distanceB) {
      return distanceA - distanceB;
    }

    const firstTimeA = parseTimeToMinutes((a.times || [])[0]) ?? 999999;
    const firstTimeB = parseTimeToMinutes((b.times || [])[0]) ?? 999999;

    if (firstTimeA !== firstTimeB) {
      return firstTimeA - firstTimeB;
    }

    return normalize(a.businessName).localeCompare(normalize(b.businessName));
  });
}

function searchAppointments(filters = {}) {
  const baseFilters = {
    platform: filters.platform,
    business: filters.business,
    serviceType: filters.serviceType,
    durationMinutes: filters.durationMinutes,
    status: filters.status
  };

  let results = getCachedAppointments(baseFilters);

  results = results
    .filter((item) => appointmentMatchesSearch(item, filters))
    .map((item) => applyTimeWindowToItem(item, filters));

  if (filters.hasTimes) {
    results = results.filter(
      (item) => Array.isArray(item.times) && item.times.length > 0
    );
  }

  results = sortAppointments(results);

  if (filters.limit) {
    results = results.slice(0, Number(filters.limit));
  }

  return results;
}

function printSearchSummary(filters, results) {
  console.log("\n===== SEARCH FILTERS =====");
  console.log(JSON.stringify(filters, null, 2));

  console.log("\n===== CACHE STATS =====");
  console.log(JSON.stringify(getCacheStats(), null, 2));

  console.log("\n===== SEARCH RESULTS =====");
  console.log(JSON.stringify(results, null, 2));

  console.log(`\nFound ${results.length} matching cached appointment result(s).`);
}

function run() {
  const filters = parseCliFilters(process.argv);

  const results = searchAppointments(filters);

  printSearchSummary(filters, results);
}

if (require.main === module) {
  run();
}

module.exports = {
  searchAppointments,
  parseTimeToMinutes
};
