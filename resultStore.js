const fs = require("fs");
const path = require("path");

const RESULTS_FILE = path.join(__dirname, "results.json");

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function readResults() {
  if (!fs.existsSync(RESULTS_FILE)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[RESULT STORE] Failed to read results.json:", error.message);
    return [];
  }
}

function writeResults(results = []) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

function getResultKey(result = {}) {
  return [
    result.businessName || "",
    result.platform || "",
    result.serviceName || result.service || "",
    result.serviceType || "",
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

function upsertBusinessResult(result = {}) {
  if (!result.businessName) {
    throw new Error("[RESULT STORE] Cannot save result without businessName.");
  }

  const existingResults = readResults();
  const mergedResults = mergeResults(existingResults, [result]);

  writeResults(mergedResults);

  console.log(
    `[RESULT STORE] Saved result for ${result.businessName} | ${result.serviceName || result.service || "service"}`
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