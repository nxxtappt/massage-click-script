let BusinessRepository = null;

try {
  BusinessRepository = require("./database/BusinessRepository");
} catch (error) {
  console.warn(
    "[BUSINESS MANAGER] PostgreSQL repository unavailable:",
    error.message
  );
}

let businessCache = null;
let businessCacheLoadedAt = null;

function requireRepository() {
  if (!BusinessRepository) {
    throw new Error("PostgreSQL BusinessRepository is unavailable.");
  }

  return BusinessRepository;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value = "") {
  return (
    String(value || "business")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 90) || "business"
  );
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeSubscriptionShape(row = null) {
  const source = cleanObject(row);
  const plan = source.plan || "verified_basic";
  const subscriptionStatus =
    source.subscriptionStatus || source.subscription_status || "active";

  const publicProfile = cleanObject(
    source.publicProfile || source.public_profile || source.businessProfile
  );

  const activeDeal = cleanObject(
    source.activeDeal || source.active_deal || source.cardPromotion
  );

  const bookingIntegration = cleanObject(
    source.bookingIntegration ||
      source.booking_integration ||
      source.bookingWidget
  );

  return {
    id: source.id || null,
    businessId: source.businessId || source.business_id || null,
    plan,
    subscriptionStatus,
    billingProvider:
      source.billingProvider || source.billing_provider || "manual_admin",
    stripeCustomerId:
      source.stripeCustomerId || source.stripe_customer_id || "",
    stripeSubscriptionId:
      source.stripeSubscriptionId || source.stripe_subscription_id || "",
    notes: source.notes || "",
    publicProfile,
    businessProfile: publicProfile,
    activeDeal,
    cardPromotion: activeDeal,
    bookingIntegration,
    bookingWidget: bookingIntegration,
    isPremium:
      plan === "premium" &&
      ["active", "trialing"].includes(String(subscriptionStatus).toLowerCase()),
    createdAt: source.createdAt || source.created_at || "",
    updatedAt: source.updatedAt || source.updated_at || ""
  };
}

function normalizeServiceRow(service = {}) {
  const raw = cleanObject(service.raw_json);
  const inferServiceTypes = Array.isArray(service.infer_service_types)
    ? service.infer_service_types
    : Array.isArray(raw.inferServiceTypes)
      ? raw.inferServiceTypes
      : [];

  const inferenceRole =
    service.inference_role ||
    raw.inferenceRole ||
    null;

  const inferenceEnabled =
    service.inference_enabled === true ||
    raw.inferenceEnabled === true ||
    Boolean(inferenceRole);

  const searchInference = {
    enabled: inferenceEnabled,
    isInferenceAnchor: inferenceRole === "anchor",
    canBeInferred: inferenceRole === "inferred",
    inferShorterDurations:
      service.infer_shorter_durations === true ||
      raw.inferShorterDurations === true,
    inferServiceTypes,
    inferStartIntervalMinutes:
      service.infer_start_interval_minutes ||
      raw.inferStartIntervalMinutes ||
      null,
    confidence:
      service.inference_confidence === null || service.inference_confidence === undefined
        ? raw.inferenceConfidence ?? null
        : Number(service.inference_confidence),
    anchorServiceId:
      service.anchor_service_id ||
      raw.anchorServiceId ||
      null,
    anchorServiceKey:
      service.anchor_service_key ||
      raw.anchorServiceKey ||
      null
  };

  return {
    id: service.id || raw.id || null,
    businessServiceId: service.id || raw.id || null,
    canonicalKey: service.canonical_key || raw.canonicalKey || "",
    serviceName: service.service_name || raw.serviceName || "",
    serviceType: service.service_type || raw.serviceType || "",
    serviceCategory: service.service_type || raw.serviceType || "",
    durationMinutes:
      service.duration_minutes === null || service.duration_minutes === undefined
        ? raw.durationMinutes ?? null
        : Number(service.duration_minutes),
    price: service.price ?? raw.price ?? null,
    platformServiceId:
      service.platform_service_id || raw.platformServiceId || "",
    serviceButtonId:
      service.service_button_id || raw.serviceButtonId || "",
    serviceId: service.service_id || raw.serviceId || "",
    categoryText: service.category_text || raw.categoryText || "",
    categoryName: service.category_text || raw.categoryText || "",
    parentServiceText: service.parent_service_text || raw.parentServiceText || "",
    sessionTypeId: service.session_type_id || raw.sessionTypeId || null,
    providerText: service.provider_text || raw.providerText || "",
    enabled: service.enabled !== false,
    priority: service.priority || raw.priority || "",
    discoveryStatus:
      service.discovery_status || raw.discoveryStatus || "",
    daysForward:
      service.days_forward === null || service.days_forward === undefined
        ? raw.daysForward ?? null
        : Number(service.days_forward),
    lookaheadHours:
      service.lookahead_hours === null || service.lookahead_hours === undefined
        ? raw.lookaheadHours ?? null
        : Number(service.lookahead_hours),
    scrapeDirectly:
      service.scrape_directly !== false && raw.scrapeDirectly !== false,
    inferenceEnabled,
    inferenceRole,
    anchorServiceId: searchInference.anchorServiceId,
    anchorServiceKey: searchInference.anchorServiceKey,
    inferShorterDurations: searchInference.inferShorterDurations,
    inferServiceTypes,
    inferStartIntervalMinutes: searchInference.inferStartIntervalMinutes,
    inferenceConfidence: searchInference.confidence,
    bookingIntervalMinutes:
      service.booking_interval_minutes || raw.bookingIntervalMinutes || null,
    searchInference
  };
}

function normalizeBusinessShape(business = {}) {
  const businessName =
    business.businessName ||
    business.business_name ||
    business.name ||
    business.displayName ||
    business.display_name ||
    "";

  const businessId =
    business.businessId ||
    business.business_id ||
    business.id ||
    slugify(businessName);

  const businessSlug =
    business.businessSlug ||
    business.business_slug ||
    business.slug ||
    slugify(businessName);

  const location =
    Array.isArray(business.locations) && business.locations.length
      ? business.locations[0]
      : cleanObject(business.location);

  const latitude = toNumberOrNull(
    pick(business.latitude, business.lat, location.latitude)
  );

  const longitude = toNumberOrNull(
    pick(
      business.longitude,
      business.lng,
      business.lon,
      location.longitude
    )
  );

  const subscription = normalizeSubscriptionShape(business.subscription);

  return {
    ...business,
    id: businessId,
    businessId,
    business_id: business.business_id || businessId,
    businessName,
    name: business.name || businessName,
    displayName:
      business.displayName || business.display_name || businessName,
    businessSlug,
    slug: business.slug || businessSlug,
    businessUrl:
      business.businessUrl ||
      business.business_url ||
      `/business/${businessSlug}`,
    businessCategory:
      business.businessCategory || business.business_category || "wellness",
    platform: business.platform || "",
    bookingUrl: business.bookingUrl || business.booking_url || "",
    website: business.website || business.businessWebsite || "",
    phone: business.phone || business.businessPhone || "",
    email: business.email || "",
    ownerEmail: business.ownerEmail || business.owner_email || "",
    address: business.address || location.address || "",
    city: business.city || location.city || "",
    state: business.state || location.state || "",
    postalCode:
      business.postalCode ||
      business.postal_code ||
      location.postal_code ||
      "",
    latitude,
    longitude,
    timezone:
      business.timezone || location.timezone || "America/Chicago",
    logoUrl: business.logoUrl || business.logo_url || "",
    logoAlt:
      business.logoAlt ||
      business.logo_alt ||
      (businessName ? `${businessName} logo` : ""),
    verificationStatus:
      business.verificationStatus ||
      business.verification_status ||
      business.claimStatus ||
      "unclaimed",
    claimed:
      business.claimed === true ||
      business.verificationStatus === "verified" ||
      business.verification_status === "verified" ||
      business.verificationStatus === "claimed_verified" ||
      business.verification_status === "claimed_verified",
    claimedByEmail:
      business.claimedByEmail || business.claimed_by_email || "",
    claimId: business.claimId || business.claim_id || "",
    enabled: business.enabled !== false,
    priority: business.priority || "",
    discoveryStatus:
      business.discoveryStatus || business.discovery_status || "",
    services: Array.isArray(business.services) ? business.services : [],
    integrations: Array.isArray(business.integrations)
      ? business.integrations
      : [],
    locations: Array.isArray(business.locations) ? business.locations : [],
    searchAliases: Array.isArray(business.searchAliases)
      ? business.searchAliases
      : [],
    amenities: Array.isArray(business.amenities) ? business.amenities : [],
    specialties: Array.isArray(business.specialties)
      ? business.specialties
      : [],
    subscription,
    plan: subscription.plan,
    subscriptionPlan: subscription.plan,
    subscriptionStatus: subscription.subscriptionStatus,
    isPremium: subscription.isPremium,
    publicProfile: subscription.publicProfile,
    businessProfile: subscription.publicProfile,
    activeDeal: subscription.activeDeal,
    cardPromotion: subscription.activeDeal,
    bookingIntegration: subscription.bookingIntegration,
    bookingWidget: subscription.bookingIntegration,
    updatedAt: business.updatedAt || business.updated_at || ""
  };
}

function toLegacyBusiness(row = {}) {
  const raw = cleanObject(row.raw_json);
  const location =
    Array.isArray(row.locations) && row.locations.length
      ? row.locations[0]
      : {};

  return normalizeBusinessShape({
    ...raw,
    ...row,
    id: row.business_id || raw.id || raw.businessId,
    businessId: row.business_id || raw.businessId || raw.id,
    businessName: row.business_name || raw.businessName || raw.name,
    displayName: row.display_name || raw.displayName,
    businessCategory:
      row.business_category || raw.businessCategory || "wellness",
    bookingUrl: row.booking_url || raw.bookingUrl,
    ownerEmail: row.owner_email || raw.ownerEmail,
    claimedByEmail: row.claimed_by_email || raw.claimedByEmail,
    claimId: row.claim_id || raw.claimId,
    verificationStatus:
      row.verification_status || raw.verificationStatus || "unclaimed",
    discoveryStatus: row.discovery_status || raw.discoveryStatus,
    address: location.address || raw.address || "",
    city: location.city || raw.city || "",
    state: location.state || raw.state || "",
    postalCode: location.postal_code || raw.postalCode || raw.zip || "",
    latitude: pick(location.latitude, raw.latitude),
    longitude: pick(location.longitude, raw.longitude),
    timezone: location.timezone || raw.timezone || "America/Chicago",
    locations: Array.isArray(row.locations) ? row.locations : [],
    services: Array.isArray(row.services) ? row.services.map(normalizeServiceRow) : (raw.services || []).map(normalizeServiceRow),
    integrations: Array.isArray(row.integrations)
      ? row.integrations
      : raw.integrations || [],
    subscription: row.subscription || null
  });
}

function setBusinessCache(businesses = []) {
  businessCache = Array.isArray(businesses) ? businesses : [];
  businessCacheLoadedAt = new Date().toISOString();
  return businessCache;
}

function getCachedBusinesses() {
  return Array.isArray(businessCache) ? businessCache : [];
}

function findBusinessInList(idOrBusinessName, businesses = []) {
  const target = normalize(idOrBusinessName);
  if (!target) return null;

  return (
    businesses.find((business) => {
      const item = normalizeBusinessShape(business);
      return (
        normalize(item.businessId) === target ||
        normalize(item.id) === target ||
        normalize(item.businessName) === target ||
        normalize(item.name) === target ||
        normalize(item.businessSlug) === target ||
        normalize(item.slug) === target
      );
    }) || null
  );
}

async function hydrateBusinessRow(row) {
  if (!row) return null;

  const repository = requireRepository();
  const [locations, services, integrations, subscription] = await Promise.all([
    repository.getLocations(row.id),
    repository.getServices(row.id),
    repository.getIntegrations(row.id),
    repository.getBusinessSubscription(row.id)
  ]);

  return toLegacyBusiness({
    ...row,
    locations,
    services,
    integrations,
    subscription
  });
}

async function getAllBusinesses(options = {}) {
  const repository = requireRepository();
  const rows = await repository.getAllBusinesses({
    includeDisabled: options.includeDisabled === true
  });

  const businesses = await Promise.all(rows.map(hydrateBusinessRow));
  return setBusinessCache(businesses.filter(Boolean));
}

function getAllBusinessesSync(options = {}) {
  const cached = getCachedBusinesses();
  return options.includeDisabled === true
    ? cached
    : cached.filter((business) => business.enabled !== false);
}


async function searchBusinesses(options = {}) {
  const result = await requireRepository().searchBusinesses(options);

  return {
    ...result,
    businesses: result.businesses.map((row) => normalizeBusinessShape({
      ...row,
      businessId: row.business_id,
      businessName: row.business_name,
      displayName: row.display_name,
      businessCategory: row.business_category,
      verificationStatus: row.verification_status,
      address: row.address || '',
      city: row.city || '',
      state: row.state || '',
      postalCode: row.postal_code || '',
      metro: row.metro || row.city || '',
      serviceCount: Number(row.service_count || 0),
      services: [],
      locations: [],
      integrations: []
    }))
  };
}

async function getBusinessSearchFacets() {
  return requireRepository().getBusinessSearchFacets();
}

async function getBusinessDetails(idOrBusinessName) {
  const repository = requireRepository();
  const row = await repository.resolveBusiness(idOrBusinessName);
  return hydrateBusinessRow(row);
}

async function getBusinessByName(businessName) {
  if (!businessName) return null;

  const row = await requireRepository().getBusinessByName(businessName);
  return hydrateBusinessRow(row);
}

async function getBusinessBySlug(slugOrName) {
  if (!slugOrName) return null;

  const row = await requireRepository().getBusinessBySlug(slugOrName);
  return hydrateBusinessRow(row);
}

function getBusinessBySlugSync(slugOrName) {
  return findBusinessInList(slugOrName, getCachedBusinesses());
}

async function createBusiness(business = {}) {
  const row = await requireRepository().createBusiness(
    normalizeBusinessShape(business)
  );

  await getAllBusinesses({ includeDisabled: true });
  return hydrateBusinessRow(row);
}

async function updateBusiness(idOrBusinessName, updates = {}) {
  const repository = requireRepository();
  const existing =
    (await getBusinessByName(idOrBusinessName)) ||
    (await getBusinessBySlug(idOrBusinessName));

  if (!existing) {
    throw new Error("Business not found.");
  }

  const merged = normalizeBusinessShape({
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString()
  });

  const row = repository.saveBusinessFull
    ? await repository.saveBusinessFull(merged)
    : await repository.updateBusiness(
        existing.businessId || existing.id,
        merged
      );

  await getAllBusinesses({ includeDisabled: true });
  return hydrateBusinessRow(row);
}

async function saveBusiness(business = {}) {
  const normalizedBusiness = normalizeBusinessShape(business);
  const existing =
    (await getBusinessByName(normalizedBusiness.businessName)) ||
    (await getBusinessBySlug(normalizedBusiness.businessId));

  return existing
    ? updateBusiness(existing.businessId || existing.id, normalizedBusiness)
    : createBusiness(normalizedBusiness);
}

async function getBusinessSubscription(idOrBusinessName) {
  const row = await requireRepository().getBusinessSubscription(
    idOrBusinessName
  );

  return row ? normalizeSubscriptionShape(row) : null;
}

async function searchBusinessSubscriptions(options = {}) {
  const result = await requireRepository().searchBusinessSubscriptions(options);
  return {
    ...result,
    subscriptions: (result.subscriptions || []).map((row) => ({
      businessId: row.public_business_id || row.business_id,
      businessName: row.business_name,
      businessCategory: row.business_category || "wellness",
      platform: row.platform || "",
      metro: row.city || "",
      address: row.address || "",
      enabled: row.enabled !== false,
      ...normalizeSubscriptionShape(row)
    }))
  };
}

async function saveBusinessSubscription(idOrBusinessName, payload = {}) {
  const row = await requireRepository().upsertBusinessSubscription(
    idOrBusinessName,
    payload
  );

  const subscription = normalizeSubscriptionShape(row);
  await getAllBusinesses({ includeDisabled: true });
  return subscription;
}

async function getBusinessSubscriptionMap() {
  const rows = await requireRepository().getAllBusinessSubscriptions();
  const subscriptions = {};

  for (const row of rows) {
    const key = slugify(row.public_business_id || row.business_name);
    subscriptions[key] = normalizeSubscriptionShape(row);
  }

  return subscriptions;
}

function buildBusinessPageData(business = {}) {
  if (!business) return null;

  const item = normalizeBusinessShape(business);
  const businessName = item.businessName || item.name || "Business";
  const isVerified =
    item.claimed === true ||
    ["verified", "claimed_verified"].includes(item.verificationStatus);

  const publicProfile = {
    ...item.publicProfile,
    specialties: Array.isArray(item.publicProfile.specialties)
      ? item.publicProfile.specialties
      : item.specialties,
    amenities: Array.isArray(item.publicProfile.amenities)
      ? item.publicProfile.amenities
      : item.amenities
  };

  return {
    businessId: item.businessId,
    businessName,
    name: businessName,
    displayName: item.displayName || businessName,
    businessSlug: item.businessSlug,
    slug: item.businessSlug,
    businessUrl: item.businessUrl || `/business/${item.businessSlug}`,
    businessCategory: item.businessCategory || "wellness",
    platform: item.platform || "",
    bookingUrl: item.bookingUrl || "",
    website: item.website || "",
    phone: item.phone || "",
    email: item.email || "",
    address: item.address || "",
    latitude: item.latitude,
    longitude: item.longitude,
    logoUrl: item.logoUrl || "",
    logoAlt: item.logoAlt || `${businessName} logo`,
    claimed: isVerified,
    isVerified,
    verificationStatus: isVerified
      ? "verified"
      : item.verificationStatus || "unclaimed",
    claimedByEmail: item.claimedByEmail || "",
    claimId: item.claimId || "",
    plan: item.plan,
    subscriptionStatus: item.subscriptionStatus,
    isPremium: item.isPremium,
    subscription: item.subscription,
    publicProfile,
    activeDeal: item.isPremium ? item.activeDeal : {},
    bookingIntegration: item.isPremium ? item.bookingIntegration : {},
    services: item.services,
    amenities: publicProfile.amenities || [],
    specialties: publicProfile.specialties || []
  };
}

async function getBusinessPageData(slugOrName) {
  return buildBusinessPageData(await getBusinessBySlug(slugOrName));
}

async function getBusinessPageDataAsync(slugOrName) {
  return getBusinessPageData(slugOrName);
}

function getCacheInfo() {
  return {
    loaded: Array.isArray(businessCache),
    count: Array.isArray(businessCache) ? businessCache.length : 0,
    loadedAt: businessCacheLoadedAt
  };
}

function readJsonBusinesses() {
  throw new Error("businesses.json is no longer a runtime data source.");
}

function writeJsonBusinesses() {
  throw new Error("businesses.json is no longer a runtime data source.");
}

module.exports = {
  getAllBusinesses,
  getAllBusinessesSync,
  searchBusinesses,
  getBusinessSearchFacets,
  getBusinessDetails,
  readJsonBusinesses,
  writeJsonBusinesses,
  toLegacyBusiness,
  getBusinessByName,
  getBusinessBySlug,
  getBusinessBySlugSync,
  createBusiness,
  updateBusiness,
  saveBusiness,
  getBusinessSubscription,
  saveBusinessSubscription,
  getBusinessSubscriptionMap,
  searchBusinessSubscriptions,
  getBusinessPageData,
  getBusinessPageDataAsync,
  buildBusinessPageData,
  normalizeBusinessShape,
  normalizeSubscriptionShape,
  slugify,
  getCacheInfo
};