const db = require("../db");

function getQuery() {
  if (typeof db.query === "function") return db.query.bind(db);
  if (db.pool && typeof db.pool.query === "function") return db.pool.query.bind(db.pool);
  throw new Error("db.js must export query() or pool.query()");
}

const query = getQuery();

function getExecutor(client) {
  return client && typeof client.query === "function"
    ? client.query.bind(client)
    : query;
}

function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeTextArray(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return [...new Set(
    values
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
}

function toCleanRawJson(input = {}, allowedKeys = []) {
  const output = {};
  for (const key of allowedKeys) {
    if (input[key] !== undefined) output[key] = input[key];
  }
  return output;
}

function normalizeSubscriptionInput(input = {}) {
  return {
    plan: input.plan || "verified_basic",
    subscriptionStatus:
      input.subscriptionStatus || input.subscription_status || "active",
    billingProvider:
      input.billingProvider || input.billing_provider || "manual_admin",
    stripeCustomerId:
      input.stripeCustomerId || input.stripe_customer_id || null,
    stripeSubscriptionId:
      input.stripeSubscriptionId || input.stripe_subscription_id || null,
    notes: input.notes || "",
    publicProfile: cleanObject(input.publicProfile || input.businessProfile),
    activeDeal: cleanObject(input.activeDeal || input.cardPromotion),
    bookingIntegration: cleanObject(
      input.bookingIntegration || input.bookingWidget
    )
  };
}

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
    logo_url: input.logoUrl || input.logo_url || null,
    logo_alt: input.logoAlt || input.logo_alt || null,
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
    raw_json: toCleanRawJson(input, [
      "businessId", "businessName", "displayName", "businessCategory",
      "platform", "bookingUrl", "website", "phone", "email", "ownerEmail",
      "verificationStatus", "claimed", "claimedByEmail", "claimId",
      "enabled", "priority", "discoveryStatus", "adminNotes"
    ])
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
    raw_json: toCleanRawJson(input, [
      "locationName", "address", "city", "state", "postalCode",
      "latitude", "longitude", "timezone"
    ])
  };
}

function normalizeService(input = {}, business = {}, numericBusinessId) {
  const inference = input.searchInference && typeof input.searchInference === "object"
    ? input.searchInference
    : {};

  const serviceName = input.serviceName || business.serviceName || "";
  const serviceType =
    input.serviceType ||
    input.serviceCategory ||
    business.serviceType ||
    business.serviceCategory ||
    null;
  const durationMinutes = input.durationMinutes ?? business.durationMinutes ?? null;
  const platformServiceId = input.platformServiceId || business.platformServiceId || null;
  const serviceButtonId = input.serviceButtonId || business.serviceButtonId || null;
  const serviceId =
    input.serviceId || business.serviceId || platformServiceId || serviceButtonId || null;

  const canonicalKey = [
    String(platformServiceId || serviceId || "").trim().toLowerCase(),
    String(serviceName || "").trim().toLowerCase(),
    String(serviceType || "").trim().toLowerCase(),
    durationMinutes || ""
  ].join("|");

  const scrapeDirectly =
    input.scrapeDirectly !== false &&
    input.inferenceRole !== "inferred" &&
    inference.canBeInferred !== true;
  const inferenceRole =
    input.inferenceRole ||
    (inference.isInferenceAnchor ? "anchor" : inference.canBeInferred ? "inferred" : null);
  const inferenceEnabled =
    input.inferenceEnabled === true ||
    inference.enabled === true ||
    Boolean(inferenceRole);

  const rawJson = {
    serviceName,
    serviceType,
    durationMinutes,
    price: input.price ?? input.servicePrice ?? business.price ?? business.servicePrice ?? null,
    platformServiceId,
    serviceButtonId,
    serviceId,
    categoryText: input.categoryText || input.categoryName || business.categoryText || business.categoryName || null,
    providerText: input.providerText || business.providerText || null,
    enabled: input.enabled !== false,
    priority: input.priority || business.priority || null,
    discoveryStatus: input.discoveryStatus || business.discoveryStatus || null,
    daysForward: input.daysForward ?? business.daysForward ?? null,
    lookaheadHours: input.lookaheadHours ?? business.lookaheadHours ?? null,
    scrapeDirectly,
    inferenceEnabled,
    inferenceRole,
    anchorServiceId:
      /^\d+$/.test(String(input.anchorServiceId || inference.anchorServiceId || ""))
        ? Number(input.anchorServiceId || inference.anchorServiceId)
        : null,
    anchorServiceKey:
      input.anchorServiceKey ||
      inference.anchorServiceKey ||
      (!/^\d+$/.test(String(input.anchorServiceId || inference.anchorServiceId || ""))
        ? String(input.anchorServiceId || inference.anchorServiceId || "").replace(/^key:/, "")
        : null),
    inferShorterDurations:
      input.inferShorterDurations === true || inference.inferShorterDurations === true,
    inferServiceTypes: normalizeTextArray(
      input.inferServiceTypes !== undefined
        ? input.inferServiceTypes
        : inference.inferServiceTypes
    ),
    inferStartIntervalMinutes:
      input.inferStartIntervalMinutes ||
      inference.inferStartIntervalMinutes ||
      input.bookingIntervalMinutes ||
      null,
    inferenceConfidence:
      input.inferenceConfidence ?? inference.confidence ?? null,
    bookingIntervalMinutes: input.bookingIntervalMinutes || null
  };

  return {
    business_id: numericBusinessId,
    canonical_key: canonicalKey,
    service_name: serviceName,
    service_type: serviceType,
    duration_minutes: durationMinutes,
    price: rawJson.price,
    platform_service_id: platformServiceId,
    service_button_id: serviceButtonId,
    service_id: serviceId,
    category_text: rawJson.categoryText,
    provider_text: rawJson.providerText,
    enabled: rawJson.enabled,
    priority: rawJson.priority,
    discovery_status: rawJson.discoveryStatus,
    days_forward: rawJson.daysForward,
    lookahead_hours: rawJson.lookaheadHours,
    scrape_directly: rawJson.scrapeDirectly,
    inference_enabled: rawJson.inferenceEnabled,
    inference_role: rawJson.inferenceRole,
    anchor_service_id: rawJson.anchorServiceId,
    anchor_service_key: rawJson.anchorServiceKey,
    infer_shorter_durations: rawJson.inferShorterDurations,
    infer_service_types: rawJson.inferServiceTypes,
    infer_start_interval_minutes: rawJson.inferStartIntervalMinutes,
    inference_confidence: rawJson.inferenceConfidence,
    booking_interval_minutes: rawJson.bookingIntervalMinutes,
    raw_json: rawJson
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
    raw_json: toCleanRawJson(input, [
      "integrationType", "apiProvider", "credentialId", "platform",
      "integrationStatus"
    ])
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

async function getBusinessBySlug(slugOrName) {
  const value = String(slugOrName || "");

  const result = await query(
    `
      SELECT *
      FROM businesses
      WHERE lower(business_id) = lower($1)
         OR lower(business_name) = lower($1)
         OR lower(display_name) = lower($1)
         OR lower(
              regexp_replace(
                regexp_replace(business_name, '&', ' and ', 'g'),
                '[^a-zA-Z0-9]+',
                '-',
                'g'
              )
            ) = lower($1)
      LIMIT 1
    `,
    [value]
  );

  return result.rows[0] || null;
}

async function resolveBusiness(idOrBusinessName) {
  if (!idOrBusinessName) return null;

  let business = await getBusinessById(idOrBusinessName);
  if (!business) business = await getBusinessByName(String(idOrBusinessName));
  if (!business) business = await getBusinessBySlug(String(idOrBusinessName));

  return business || null;
}

async function getBusinessSubscription(idOrBusinessName) {
  const business = await resolveBusiness(idOrBusinessName);
  if (!business) return null;

  const result = await query(
    `
      SELECT
        bs.*,
        b.business_id AS public_business_id,
        b.business_name
      FROM business_subscriptions bs
      INNER JOIN businesses b ON b.id = bs.business_id
      WHERE bs.business_id = $1
      LIMIT 1
    `,
    [business.id]
  );

  return result.rows[0] || null;
}

async function getAllBusinessSubscriptions() {
  const result = await query(
    `
      SELECT
        bs.*,
        b.business_id AS public_business_id,
        b.business_name,
        b.enabled,
        b.verification_status,
        b.claimed
      FROM business_subscriptions bs
      INNER JOIN businesses b ON b.id = bs.business_id
      ORDER BY b.business_name ASC
    `
  );

  return result.rows;
}

async function searchBusinessSubscriptions(options = {}) {
  const page = Math.max(1, Number(options.page || 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit || 20) || 20));
  const offset = (page - 1) * limit;
  const values = [];
  const where = [];
  const add = (sql, value) => { values.push(value); where.push(sql.replace("?", `$${values.length}`)); };
  if (options.name) add("(LOWER(b.business_name) LIKE LOWER(?) OR LOWER(b.business_id) LIKE LOWER(?))", `%${options.name}%`);
  if (options.name) values.push(`%${options.name}%`), where[where.length-1]=where[where.length-1].replace('?', `$${values.length}`);
  if (options.industry) add("LOWER(COALESCE(b.business_category,'')) = LOWER(?)", options.industry);
  if (options.metro) add("LOWER(COALESCE(bl.city,'')) = LOWER(?)", options.metro);
  if (options.plan) add("LOWER(COALESCE(bs.plan,'verified_basic')) = LOWER(?)", options.plan);
  if (options.status) add("LOWER(COALESCE(bs.subscription_status, bs.status, 'active')) = LOWER(?)", options.status);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const baseFrom = `FROM businesses b LEFT JOIN business_subscriptions bs ON bs.business_id=b.id LEFT JOIN LATERAL (SELECT city,address FROM business_locations WHERE business_id=b.id ORDER BY id LIMIT 1) bl ON true`;
  const count = await query(`SELECT COUNT(DISTINCT b.id)::int AS total ${baseFrom} ${clause}`, values);
  const dataValues=[...values,limit,offset];
  const result=await query(`SELECT b.id,b.business_id AS public_business_id,b.business_name,b.business_category,b.platform,b.enabled,bl.city,bl.address,bs.plan,COALESCE(bs.subscription_status,bs.status,'active') AS subscription_status,bs.billing_provider,bs.notes,bs.public_profile,bs.active_deal,bs.booking_integration,bs.raw_json ${baseFrom} ${clause} ORDER BY b.business_name ASC LIMIT $${dataValues.length-1} OFFSET $${dataValues.length}`,dataValues);
  const total=Number(count.rows[0]?.total||0);
  return { subscriptions: result.rows, page, limit, total, totalPages: Math.max(1, Math.ceil(total/limit)) };
}

async function upsertBusinessSubscription(
  idOrBusinessName,
  input = {}
) {
  const business = await resolveBusiness(idOrBusinessName);

  if (!business) {
    throw new Error("Business not found.");
  }

  const normalized = normalizeSubscriptionInput(input);

  const legacyRawJson = {
    plan: normalized.plan,
    subscriptionStatus: normalized.subscriptionStatus,
    billingProvider: normalized.billingProvider,
    stripeCustomerId: normalized.stripeCustomerId,
    stripeSubscriptionId: normalized.stripeSubscriptionId,
    notes: normalized.notes,

    publicProfile: normalized.publicProfile,
    businessProfile: normalized.publicProfile,

    activeDeal: normalized.activeDeal,
    cardPromotion: normalized.activeDeal,

    bookingIntegration: normalized.bookingIntegration,
    bookingWidget: normalized.bookingIntegration
  };

  const result = await query(
    `
      INSERT INTO business_subscriptions (
        business_id,
        business_name,
        plan,
        status,
        subscription_status,
        billing_provider,
        stripe_customer_id,
        stripe_subscription_id,
        notes,
        public_profile,
        active_deal,
        booking_integration,
        raw_json,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, NOW()
      )
      ON CONFLICT (business_id)
      DO UPDATE SET
        business_name = EXCLUDED.business_name,

        plan = EXCLUDED.plan,

        status = EXCLUDED.subscription_status,

        subscription_status =
          EXCLUDED.subscription_status,

        billing_provider =
          EXCLUDED.billing_provider,

        stripe_customer_id =
          EXCLUDED.stripe_customer_id,

        stripe_subscription_id =
          EXCLUDED.stripe_subscription_id,

        notes =
          EXCLUDED.notes,

        public_profile =
          COALESCE(
            business_subscriptions.public_profile,
            '{}'::jsonb
          ) || EXCLUDED.public_profile,

        active_deal =
          COALESCE(
            business_subscriptions.active_deal,
            '{}'::jsonb
          ) || EXCLUDED.active_deal,

        booking_integration =
          COALESCE(
            business_subscriptions.booking_integration,
            '{}'::jsonb
          ) || EXCLUDED.booking_integration,

        raw_json =
          COALESCE(
            business_subscriptions.raw_json,
            '{}'::jsonb
          ) || EXCLUDED.raw_json,

        updated_at = NOW()

      RETURNING *
    `,
    [
      business.id,
      business.business_name,
      normalized.plan,
      normalized.subscriptionStatus,
      normalized.subscriptionStatus,
      normalized.billingProvider,
      normalized.stripeCustomerId,
      normalized.stripeSubscriptionId,
      normalized.notes,
      normalized.publicProfile,
      normalized.activeDeal,
      normalized.bookingIntegration,
      legacyRawJson
    ]
  );

  return result.rows[0];
}

async function getBusinessWithSubscription(idOrBusinessName) {
  const business = await resolveBusiness(idOrBusinessName);
  if (!business) return null;

  const [locations, services, integrations, subscription] = await Promise.all([
    getLocations(business.id),
    getServices(business.id),
    getIntegrations(business.id),
    getBusinessSubscription(business.id)
  ]);

  return {
    ...business,
    locations,
    services,
    integrations,
    subscription
  };
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

async function upsertBusiness(business, client = null) {
  const execute = getExecutor(client);
  const row = normalizeBusiness(business);
  const keys = Object.keys(row);
  const updateKeys = keys.filter((key) => key !== "business_id");

  const result = await execute(
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
  return saveBusinessFull(business);
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
    businessName: updates.businessName || updates.business_name || existing.business_name,
    logoUrl:
      updates.logoUrl !== undefined
        ? updates.logoUrl
        : updates.logo_url !== undefined
          ? updates.logo_url
          : existing.logo_url,
    logoAlt:
      updates.logoAlt !== undefined
        ? updates.logoAlt
        : updates.logo_alt !== undefined
          ? updates.logo_alt
          : existing.logo_alt
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

async function saveLocations(numericBusinessId, locations = [], client = null) {
  const execute = getExecutor(client);
  await execute("DELETE FROM business_locations WHERE business_id = $1", [numericBusinessId]);

  const saved = [];

  for (const location of locations) {
    const row = normalizeLocation(location, numericBusinessId);
    const keys = Object.keys(row);

    const result = await execute(
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
      ORDER BY enabled DESC, service_name ASC, duration_minutes ASC NULLS LAST
    `,
    [numericBusinessId]
  );

  return result.rows;
}

async function saveServices(numericBusinessId, businessOrServices = [], client = null) {
  const execute = getExecutor(client);
  const business = Array.isArray(businessOrServices) ? {} : businessOrServices;
  const services = Array.isArray(businessOrServices)
    ? businessOrServices
    : getServicesFromBusiness(businessOrServices);

  const saved = [];
  const canonicalKeys = [];

  for (const service of services) {
    const row = normalizeService(service, business, numericBusinessId);

    if (!row.service_name && !row.service_type && !row.platform_service_id && !row.service_id) {
      continue;
    }

    canonicalKeys.push(row.canonical_key);

    const result = await execute(
      `
        INSERT INTO business_services (
          business_id, canonical_key, service_name, service_type,
          duration_minutes, price, platform_service_id, service_button_id,
          service_id, category_text, parent_service_text, session_type_id, provider_text, enabled, priority,
          discovery_status, days_forward, lookahead_hours, scrape_directly,
          inference_enabled, inference_role, anchor_service_id,
          anchor_service_key, infer_shorter_durations, infer_service_types,
          infer_start_interval_minutes, inference_confidence,
          booking_interval_minutes, raw_json, updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
          $19,$20,$21,$22,$23,$24,$25::text[],$26,$27,$28,$29,NOW()
        )
        ON CONFLICT (business_id, canonical_key)
        DO UPDATE SET
          service_name = EXCLUDED.service_name,
          service_type = EXCLUDED.service_type,
          duration_minutes = EXCLUDED.duration_minutes,
          price = EXCLUDED.price,
          platform_service_id = EXCLUDED.platform_service_id,
          service_button_id = EXCLUDED.service_button_id,
          service_id = EXCLUDED.service_id,
          category_text = EXCLUDED.category_text,
          parent_service_text = EXCLUDED.parent_service_text,
          session_type_id = EXCLUDED.session_type_id,
          provider_text = EXCLUDED.provider_text,
          enabled = EXCLUDED.enabled,
          priority = EXCLUDED.priority,
          discovery_status = EXCLUDED.discovery_status,
          days_forward = EXCLUDED.days_forward,
          lookahead_hours = EXCLUDED.lookahead_hours,
          scrape_directly = EXCLUDED.scrape_directly,
          inference_enabled = EXCLUDED.inference_enabled,
          inference_role = EXCLUDED.inference_role,
          anchor_service_id = EXCLUDED.anchor_service_id,
          anchor_service_key = EXCLUDED.anchor_service_key,
          infer_shorter_durations = EXCLUDED.infer_shorter_durations,
          infer_service_types = EXCLUDED.infer_service_types,
          infer_start_interval_minutes = EXCLUDED.infer_start_interval_minutes,
          inference_confidence = EXCLUDED.inference_confidence,
          booking_interval_minutes = EXCLUDED.booking_interval_minutes,
          raw_json = EXCLUDED.raw_json,
          updated_at = NOW()
        RETURNING *
      `,
      [
        row.business_id, row.canonical_key, row.service_name, row.service_type,
        row.duration_minutes, row.price, row.platform_service_id,
        row.service_button_id, row.service_id, row.category_text,
        row.parent_service_text, row.session_type_id, row.provider_text, row.enabled, row.priority, row.discovery_status,
        row.days_forward, row.lookahead_hours, row.scrape_directly,
        row.inference_enabled, row.inference_role, row.anchor_service_id,
        row.anchor_service_key, row.infer_shorter_durations, row.infer_service_types,
        row.infer_start_interval_minutes, row.inference_confidence,
        row.booking_interval_minutes, row.raw_json
      ]
    );

    saved.push(result.rows[0]);
  }

  if (canonicalKeys.length) {
    await execute(
      `
        DELETE FROM business_services
        WHERE business_id = $1
          AND NOT (canonical_key = ANY($2::text[]))
      `,
      [numericBusinessId, canonicalKeys]
    );
  } else {
    await execute("DELETE FROM business_services WHERE business_id = $1", [numericBusinessId]);
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

async function saveIntegration(numericBusinessId, integration = {}, client = null) {
  const execute = getExecutor(client);
  await execute("DELETE FROM business_integrations WHERE business_id = $1", [numericBusinessId]);

  const row = normalizeIntegration(integration, numericBusinessId);
  const keys = Object.keys(row);

  const result = await execute(
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
  if (!db.pool || typeof db.pool.connect !== "function") {
    throw new Error("db.js must export pool.connect() for transactional business saves.");
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const savedBusiness = await upsertBusiness(business, client);
    const numericBusinessId = savedBusiness.id;

    const locations = Array.isArray(business.locations) && business.locations.length
      ? business.locations
      : [business];

    const integration = Array.isArray(business.integrations) && business.integrations.length
      ? business.integrations[0]
      : business;

    await saveLocations(numericBusinessId, locations, client);
    await saveServices(numericBusinessId, business, client);
    await saveIntegration(numericBusinessId, integration, client);

    await client.query("COMMIT");

    return getBusinessWithChildren(savedBusiness.business_id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


async function searchBusinesses(options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
  const offset = (page - 1) * limit;
  const values = [];
  const where = [];

  function addWhere(sql, value) {
    values.push(value);
    where.push(sql.replace(/\?/g, `$${values.length}`));
  }

  if (options.name) {
    addWhere(
      `(LOWER(b.business_name) LIKE LOWER(?) OR LOWER(COALESCE(b.display_name, '')) LIKE LOWER(?) OR LOWER(COALESCE(b.business_id, '')) LIKE LOWER(?))`,
      `%${String(options.name).trim()}%`
    );
    // addWhere only supports one placeholder value, so replace the generated predicate.
    const value = values.pop();
    where.pop();
    values.push(value, value, value);
    const base = values.length - 2;
    where.push(`(LOWER(b.business_name) LIKE LOWER($${base}) OR LOWER(COALESCE(b.display_name, '')) LIKE LOWER($${base + 1}) OR LOWER(COALESCE(b.business_id, '')) LIKE LOWER($${base + 2}))`);
  }

  if (options.industry) {
    addWhere(`LOWER(COALESCE(b.business_category, '')) = LOWER(?)`, String(options.industry).trim());
  }

  if (options.platform) {
    addWhere(`LOWER(COALESCE(b.platform, '')) = LOWER(?)`, String(options.platform).trim());
  }

  if (options.metro) {
    addWhere(
      `LOWER(COALESCE(NULLIF(b.raw_json->>'metro', ''), l.city, '')) = LOWER(?)`,
      String(options.metro).trim()
    );
  }

  if (options.enabled === true || options.enabled === false) {
    addWhere(`b.enabled = ?::boolean`, options.enabled);
  }

  values.push(limit, offset);
  const limitParam = `$${values.length - 1}`;
  const offsetParam = `$${values.length}`;

  const result = await query(
    `
      WITH business_rows AS (
        SELECT
          b.id,
          b.business_id,
          b.business_name,
          b.display_name,
          b.business_category,
          b.platform,
          b.enabled,
          b.verification_status,
          b.updated_at,
          l.address,
          l.city,
          l.state,
          l.postal_code,
          COALESCE(NULLIF(b.raw_json->>'metro', ''), l.city, '') AS metro,
          (SELECT COUNT(*)::int FROM business_services bs WHERE bs.business_id = b.id) AS service_count
        FROM businesses b
        LEFT JOIN LATERAL (
          SELECT address, city, state, postal_code
          FROM business_locations
          WHERE business_id = b.id
          ORDER BY id ASC
          LIMIT 1
        ) l ON TRUE
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      )
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM business_rows
      ORDER BY business_name ASC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    values
  );

  const total = result.rows[0]?.total_count || 0;

  return {
    businesses: result.rows.map(({ total_count, ...row }) => row),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
}

async function getBusinessSearchFacets() {
  const [industries, metros, platforms] = await Promise.all([
    query(`SELECT DISTINCT business_category AS value FROM businesses WHERE business_category IS NOT NULL AND business_category <> '' ORDER BY value`),
    query(`
      SELECT DISTINCT metro AS value
      FROM (
        SELECT COALESCE(NULLIF(b.raw_json->>'metro', ''), l.city, '') AS metro
        FROM businesses b
        LEFT JOIN LATERAL (
          SELECT city FROM business_locations WHERE business_id = b.id ORDER BY id ASC LIMIT 1
        ) l ON TRUE
      ) x
      WHERE metro <> ''
      ORDER BY value
    `),
    query(`SELECT DISTINCT platform AS value FROM businesses WHERE platform IS NOT NULL AND platform <> '' ORDER BY value`)
  ]);

  return {
    industries: industries.rows.map((row) => row.value),
    metros: metros.rows.map((row) => row.value),
    platforms: platforms.rows.map((row) => row.value)
  };
}

async function getBusinessCount() {
  const result = await query("SELECT COUNT(*) FROM businesses");
  return Number(result.rows[0].count || 0);
}

module.exports = {
  getAllBusinesses,
  getBusinessById,
  getBusinessByName,
  getBusinessBySlug,
  resolveBusiness,
  getBusinessWithChildren,
  getBusinessWithSubscription,
  getBusinessCount,
  searchBusinesses,
  getBusinessSearchFacets,

  getBusinessSubscription,
  getAllBusinessSubscriptions,
  searchBusinessSubscriptions,
  upsertBusinessSubscription,

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