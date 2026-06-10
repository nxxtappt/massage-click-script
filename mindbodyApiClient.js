const { getDecryptedApiCredential } = require("./apiCredentialManager");

const MINDBODY_BASE_URL = "https://api.mindbodyonline.com/public/v6";

function requireValue(value, label) {
  if (!value) {
    throw new Error(`[MINDBODY API] Missing required value: ${label}`);
  }

  return value;
}

function buildHeaders(apiKey, siteId) {
  return {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Api-Key": apiKey,
    "SiteId": String(siteId)
  };
}

async function mindbodyRequest(options = {}) {
  const {
    credentialId,
    path,
    method = "GET",
    query = {},
    body = null
  } = options;

  requireValue(credentialId, "credentialId");
  requireValue(path, "path");

  const credential = getDecryptedApiCredential(credentialId);
  const apiKey = credential.value;
  const siteId = credential.metadata?.siteId;

  requireValue(apiKey, "apiKey");
  requireValue(siteId, "siteId");

  const url = new URL(`${MINDBODY_BASE_URL}${path}`);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString(), {
    method,
    headers: buildHeaders(apiKey, siteId),
    body: body ? JSON.stringify(body) : null
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = {
      rawText: text
    };
  }

  if (!response.ok) {
    throw new Error(
      `[MINDBODY API] ${method} ${path} failed with ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

async function testMindbodyConnection(credentialId) {
  const data = await mindbodyRequest({
    credentialId,
    path: "/site/sites"
  });

  return {
    success: true,
    credentialId,
    data
  };
}

async function getMindbodyLocations(credentialId) {
  return mindbodyRequest({
    credentialId,
    path: "/site/locations"
  });
}

async function getMindbodyServices(credentialId, options = {}) {
  return mindbodyRequest({
    credentialId,
    path: "/sale/services",
    query: {
      LocationId: options.locationId || 1,
      Limit: options.limit || 100,
      Offset: options.offset || 0
    }
  });
}

async function getMindbodyBookableItems(credentialId, options = {}) {
  return mindbodyRequest({
    credentialId,
    path: "/appointment/bookableitems",
    query: {
      LocationId: options.locationId || 1,
      StartDate: options.startDate,
      EndDate: options.endDate,
      SessionTypeIds: options.sessionTypeId || options.sessionTypeIds,
      StaffIds: options.staffId || undefined
    }
  });
}

async function getMindbodyActiveSessionTimes(credentialId, options = {}) {
  return mindbodyRequest({
    credentialId,
    path: "/appointment/activesessiontimes",
    query: {
      LocationId: options.locationId || 1,
      StartDate: options.startDate,
      EndDate: options.endDate,
      StaffIds: options.staffId || undefined,
      SessionTypeIds: options.sessionTypeId || undefined
    }
  });
}

async function getMindbodyAppointmentOptions(credentialId, options = {}) {
  return mindbodyRequest({
    credentialId,
    path: "/appointment/appointmentoptions",
    query: {
      LocationId: options.locationId || 1,
      StartDate: options.startDate,
      EndDate: options.endDate,
      SessionTypeIds: options.sessionTypeId || options.sessionTypeIds,
      StaffIds: options.staffId || undefined
    }
  });
}

module.exports = {
  mindbodyRequest,
  testMindbodyConnection,
  getMindbodyLocations,
  getMindbodyServices,
  getMindbodyBookableItems,
  getMindbodyActiveSessionTimes,
  getMindbodyAppointmentOptions
};