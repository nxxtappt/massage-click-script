const inventoryRepository = require("./database/InventoryRepository");

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getResultKey(result = {}) {
  return [
    result.businessName || "",
    result.platform || "",
    result.serviceName || result.service || "",
    result.serviceType || result.serviceCategory || "",
    result.durationMinutes || "",
    result.platformServiceId || result.serviceId || result.serviceButtonId || "",
    result.provider || result.providerText || ""
  ]
    .map(normalizeText)
    .join("||");
}

function mergeResults(existingResults = [], incomingResults = []) {
  const incomingKeys = new Set(incomingResults.map(getResultKey));

  const preserved = existingResults.filter(
    (item) => !incomingKeys.has(getResultKey(item))
  );

  return [...preserved, ...incomingResults];
}

async function readResults(limit = 500) {
  return inventoryRepository.getRawResults(limit);
}

async function writeResults(results = []) {
  if (!Array.isArray(results)) {
    throw new Error("[RESULT STORE] writeResults expects an array.");
  }

  const saved = [];

  for (const result of results) {
    saved.push(await upsertBusinessResult(result));
  }

  return saved;
}

async function upsertBusinessResult(result = {}) {
  if (!result.businessName) {
    throw new Error("[RESULT STORE] Cannot save result without businessName.");
  }

  const saved = await inventoryRepository.saveBusinessResult(result, {
    triggerType: result.triggerType || "manual"
  });

  console.log(
    `[RESULT STORE] Saved Postgres inventory for ${result.businessName} | ${
      result.serviceName || result.service || "service"
    } | appointments: ${saved.appointmentsInserted}`
  );

  return result;
}

module.exports = {
  readResults,
  writeResults,
  mergeResults,
  upsertBusinessResult,
  getResultKey
};