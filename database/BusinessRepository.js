const db = require("../db");

function getQuery() {
  if (typeof db.query === "function") return db.query.bind(db);
  if (db.pool && typeof db.pool.query === "function") return db.pool.query.bind(db.pool);
  throw new Error("db.js must export query() or pool.query()");
}

const query = getQuery();

function slugify(value = "") {
  return String(value || "business")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120) || "business";
}

function normalizeBusiness(input = {}) {
  const businessName = input.businessName || input.name || input.displayName || "";

  return {
    business_id: input.businessId || input.id || slugify(businessName),
    business_name: businessName,
    display_name: input.displayName || businessName,
    business_category: input.businessCategory || "wellness",
    platform: input.platform || null,
    booking_url: input.bookingUrl || null,
    website: input.website || input.websiteUrl || null,
    phone: input.phone || null,
    email: input.email || input.contactEmail || null,
    owner_email: input.ownerEmail || input.claimedByEmail || null,
    verification_status: input.verificationStatus || input.claimStatus || "unclaimed",
    claimed: input.claimed === true,
    claimed_by_email: input.claimedByEmail || null,
    claim_id: input.claimId || null,
    enabled: input.enabled !== false,
    priority: input.priority || null,
    discovery_status: input.discoveryStatus || null,
    raw_json: input
  };
}

function normalizeLocation(input = {}, numericBusinessId) {
  return {
    business_id: numericBusinessId,
    location_name: input.locationName || input.businessName || input.name || null,
    address: input.address || null,
    city: input.city || null,
    state: input.state || null,
    postal_code: input.postalCode || input.zip || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    timezone: input.timezone || "America/Chicago",
    raw_json: input
  };
}

function normalizeService(input = {}, business = {}, numericBusinessId) {
  return {
    business_id: numericBusinessId,
    service_name: input.serviceName || business.serviceName || "",
    service_type:
      input.serviceType ||
      input.serviceCategory ||
      business.serviceType ||
      business.serviceCategory ||
      null,
    duration_minutes: input.durationMinutes || business.durationMinutes || null,
    price: input.price || input.servicePrice || business.price || business.servicePrice || null,
    platform_service_id:
      input.platformServiceId ||
      business.platformServiceId ||
      null,
    service_button_id:
      input.serviceButtonId ||
      business.serviceButtonId ||
      null,
    service_id:
      input.serviceId ||
      business.serviceId ||
      input.platformServiceId ||
      input.serviceButtonId ||
      null,
    category_text:
      input.categoryText ||
      input.categoryName ||
      business.categoryText ||
      business.categoryName ||
      null,
    provider_text: input.providerText || business.providerText || null,
    enabled: input.enabled !== false,
    priority: input.priority || business.priority || null,
    discovery_status: input.discoveryStatus || business.discoveryStatus || null,
    days_forward: input.daysForward || business.daysForward || null,
    lookahead_hours: input.lookaheadHours || business.lookaheadHours || null,
    raw_json: input
  };
}

function normalizeIntegration(input = {}, numericBusinessId) {
  return {
    business_id: numericBusinessId,
    integration_type: input.integrationType || "scraper",
    api_provider: input.apiProvider || null,
    credential_id: input.credentialId || null,
    platform: input.platform || null,
    status: input.integrationStatus || "active",
    raw_json: input
  };
}

function getServicesFromBusiness(business = {}) {
  const services =
    Array.isArray(business.services) && business.services.length
      ? business.services
      : [business];

  return services;
}

async function getAllBusinesses(options = {}) {
  const includeDisabled = options.includeDisabled === true;

  const result = await query(
    `
      SELECT *
      FROM businesses
      WHERE ($1::boolean = true OR enabled IS NOT FALSE)
      ORDER BY business_name ASC
    `,
    [includeDisabled]
  );

  return result.rows;
}

async function getBusinessById(id) {
  const result = await query(
    `
      SELECT *
      FROM businesses
      WHERE id = $1 OR business_id = $2
      LIMIT 1
    `,
    [Number(id) || 0, String(id || "")]
  );

  return result.rows[0] || null;
}

async function getBusinessByName(businessName) {
  const result = await query(
    `
      SELECT *
      FROM businesses
      WHERE lower(business_name) = lower($1)
         OR lower(display_name) = lower($1)
      LIMIT 1
    `,
    [businessName]
  );

  return result.rows[0] || null;
}

async function getBusinessWithChildren(idOrBusinessId) {
  const business = await getBusinessById(idOrBusinessId);

  if (!business) return null;

  const [locations, services, integrations] = await Promise.all([
    getLocations(business.id),
    getServices(business.id),
    getIntegrations(business.id)
  ]);

  return {
    ...business,
    locations,
    services,
    integrations
  };
}

async function upsertBusiness(business) {
  const row = normalizeBusiness(business);
  const keys = Object.keys(row);
  const updateKeys = keys.filter((key) => key !== "business_id");

  const result = await query(
    `
      INSERT INTO businesses (${keys.join(", ")})
      VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
      ON CONFLICT (business_id)
      DO UPDATE SET
        ${updateKeys.map((key) => `${key} = EXCLUDED.${key}`).join(", ")},
        updated_at = now()
      RETURNING *
    `,
    keys.map((key) => row[key])
  );

  return result.rows[0];
}

async function createBusiness(business) {
  return upsertBusiness(business);
}

async function updateBusiness(idOrBusinessId, updates = {}) {
  const existing = await getBusinessById(idOrBusinessId);

  if (!existing) {
    throw new Error("Business not found.");
  }

  const merged = {
    ...(existing.raw_json || {}),
    ...updates,
    businessId: existing.business_id,
    businessName: updates.businessName || updates.business_name || existing.business_name
  };

  return upsertBusiness(merged);
}

async function deleteBusiness(idOrBusinessId) {
  const existing = await getBusinessById(idOrBusinessId);

  if (!existing) {
    return false;
  }

  await query("DELETE FROM businesses WHERE id = $1", [existing.id]);
  return true;
}

async function getLocations(numericBusinessId) {
  const result = await query(
    `
      SELECT *
      FROM business_locations
      WHERE business_id = $1
      ORDER BY id ASC
    `,
    [numericBusinessId]
  );

  return result.rows;
}

async function saveLocations(numericBusinessId, locations = []) {
  await query("DELETE FROM business_locations WHERE business_id = $1", [numericBusinessId]);

  const saved = [];

  for (const location of locations) {
    const row = normalizeLocation(location, numericBusinessId);
    const keys = Object.keys(row);

    const result = await query(
      `
        INSERT INTO business_locations (${keys.join(", ")})
        VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
        RETURNING *
      `,
      keys.map((key) => row[key])
    );

    saved.push(result.rows[0]);
  }

  return saved;
}

async function getServices(numericBusinessId) {
  const result = await query(
    `
      SELECT *
      FROM business_services
      WHERE business_id = $1
      ORDER BY service_name ASC, duration_minutes ASC NULLS LAST
    `,
    [numericBusinessId]
  );

  return result.rows;
}

async function saveServices(numericBusinessId, businessOrServices = []) {
  const business = Array.isArray(businessOrServices) ? {} : businessOrServices;
  const services = Array.isArray(businessOrServices)
    ? businessOrServices
    : getServicesFromBusiness(businessOrServices);

  await query("DELETE FROM business_services WHERE business_id = $1", [numericBusinessId]);

  const saved = [];

  for (const service of services) {
    const row = normalizeService(service, business, numericBusinessId);

    if (!row.service_name && !row.service_type && !row.platform_service_id && !row.service_id) {
      continue;
    }

    const keys = Object.keys(row);

    const result = await query(
      `
        INSERT INTO business_services (${keys.join(", ")})
        VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
        RETURNING *
      `,
      keys.map((key) => row[key])
    );

    saved.push(result.rows[0]);
  }

  return saved;
}

async function getIntegrations(numericBusinessId) {
  const result = await query(
    `
      SELECT *
      FROM business_integrations
      WHERE business_id = $1
      ORDER BY id ASC
    `,
    [numericBusinessId]
  );

  return result.rows;
}

async function saveIntegration(numericBusinessId, integration = {}) {
  await query("DELETE FROM business_integrations WHERE business_id = $1", [numericBusinessId]);

  const row = normalizeIntegration(integration, numericBusinessId);
  const keys = Object.keys(row);

  const result = await query(
    `
      INSERT INTO business_integrations (${keys.join(", ")})
      VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
      RETURNING *
    `,
    keys.map((key) => row[key])
  );

  return result.rows[0];
}

async function saveBusinessFull(business) {
  await query("BEGIN");

  try {
    const savedBusiness = await upsertBusiness(business);
    const numericBusinessId = savedBusiness.id;

    await saveLocations(numericBusinessId, [business]);
    await saveServices(numericBusinessId, business);
    await saveIntegration(numericBusinessId, business);

    await query("COMMIT");
    return savedBusiness;
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  }
}

async function getBusinessCount() {
  const result = await query("SELECT COUNT(*) FROM businesses");
  return Number(result.rows[0].count || 0);
}

module.exports = {
  getAllBusinesses,
  getBusinessById,
  getBusinessByName,
  getBusinessWithChildren,
  getBusinessCount,

  createBusiness,
  updateBusiness,
  deleteBusiness,

  upsertBusiness,
  saveBusinessFull,

  getLocations,
  saveLocations,

  getServices,
  saveServices,

  getIntegrations,
  saveIntegration
};
