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

function normalizeServices(input = {}, numericBusinessId) {
  const services = Array.isArray(input.services) && input.services.length ? input.services : [input];

  return services.map((service) => ({
    business_id: numericBusinessId,
    service_name: service.serviceName || input.serviceName || "",
    service_type: service.serviceType || service.serviceCategory || input.serviceType || input.serviceCategory || null,
    duration_minutes: service.durationMinutes || input.durationMinutes || null,
    price: service.price || service.servicePrice || input.price || null,
    platform_service_id: service.platformServiceId || input.platformServiceId || null,
    service_button_id: service.serviceButtonId || input.serviceButtonId || null,
    service_id: service.serviceId || input.serviceId || service.platformServiceId || service.serviceButtonId || null,
    category_text: service.categoryText || service.categoryName || input.categoryText || input.categoryName || null,
    provider_text: service.providerText || input.providerText || null,
    enabled: service.enabled !== false,
    priority: service.priority || input.priority || null,
    discovery_status: service.discoveryStatus || input.discoveryStatus || null,
    days_forward: service.daysForward || input.daysForward || null,
    lookahead_hours: service.lookaheadHours || input.lookaheadHours || null,
    raw_json: service
  })).filter((s) => s.service_name || s.service_type || s.platform_service_id || s.service_id);
}

function normalizeLocations(input = {}, numericBusinessId) {
  return [{
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
  }].filter((l) => l.address || l.latitude || l.longitude);
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

async function insertRows(tableName, rows = []) {
  for (const row of rows) {
    const keys = Object.keys(row);
    await query(
      `
        INSERT INTO ${tableName} (${keys.join(", ")})
        VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
      `,
      keys.map((key) => row[key])
    );
  }
}

async function saveBusinessFull(business) {
  await query("BEGIN");

  try {
    const savedBusiness = await upsertBusiness(business);
    const numericBusinessId = savedBusiness.id;

    await query("DELETE FROM business_locations WHERE business_id = $1", [numericBusinessId]);
    await query("DELETE FROM business_services WHERE business_id = $1", [numericBusinessId]);
    await query("DELETE FROM business_integrations WHERE business_id = $1", [numericBusinessId]);

    await insertRows("business_locations", normalizeLocations(business, numericBusinessId));
    await insertRows("business_services", normalizeServices(business, numericBusinessId));
    await insertRows("business_integrations", [normalizeIntegration(business, numericBusinessId)]);

    await query("COMMIT");
    return savedBusiness;
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  }
}

module.exports = {
  saveBusinessFull,
  upsertBusiness
};
