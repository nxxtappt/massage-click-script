const { parseCliFilters } = require("./jobBuilder");
const inventoryManager = require("./inventoryManager");

function parseTimeToMinutes(value) {
  const match = String(value || "").match(/^([1-9]|1[0-2]):([0-5][0-9])\s?(AM|PM)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

async function searchAppointments(filters = {}) {
  return inventoryManager.getInventory({
    business: filters.business,
    platform: filters.platform,
    serviceType: filters.serviceType,
    durationMinutes: filters.durationMinutes,
    providerName: filters.providerName,
    targetLocalDateKey: filters.targetLocalDateKey || filters.date,
    startTimeKey: filters.startTimeKey,
    endTimeKey: filters.endTimeKey,
    hours: filters.hours,
    limit: filters.limit || 1000,
    includeConfirmed: filters.includeConfirmed !== false,
    includeInferred: filters.includeInferred !== false,
    showPast: false,
    includeInactive: false,
    includeDisabledBusinesses: false
  });
}

async function run() {
  const filters = parseCliFilters(process.argv);
  const results = await searchAppointments(filters);
  console.log(JSON.stringify({ source: "postgres", filters, count: results.length, results }, null, 2));
}
if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { searchAppointments, parseTimeToMinutes };