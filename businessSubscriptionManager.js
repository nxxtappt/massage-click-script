const fs = require("fs");
const path = require("path");

const SUBSCRIPTIONS_FILE = path.join(
  __dirname,
  "secure",
  "business-subscriptions.json"
);

const ALLOWED_PLANS = ["verified_basic", "premium"];
const ALLOWED_STATUSES = [
  "active",
  "inactive",
  "trialing",
  "past_due",
  "canceled"
];

function ensureSubscriptionsFileExists() {
  const dir = path.dirname(SUBSCRIPTIONS_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(SUBSCRIPTIONS_FILE)) {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify({}, null, 2));
  }
}

function normalizeBusinessKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeBookingWidget(value = {}) {
  const widget = cleanObject(value);

  return {
    enabled: widget.enabled === true,
    provider: String(widget.provider || "other"),
    type: String(widget.type || widget.widgetType || "url"),
    widgetType: String(widget.widgetType || widget.type || "url"),
    title: String(widget.title || "Book online"),
    url: String(
      widget.url ||
      widget.bookingUrl ||
      widget.iframeUrl ||
      widget.widgetUrl ||
      ""
    ),
    bookingUrl: String(widget.bookingUrl || widget.url || ""),
    iframeUrl: String(widget.iframeUrl || widget.widgetUrl || ""),
    widgetUrl: String(widget.widgetUrl || widget.iframeUrl || ""),
    html: String(widget.html || widget.embedCode || widget.code || ""),
    embedCode: String(widget.embedCode || widget.html || widget.code || ""),
    code: String(widget.code || widget.embedCode || widget.html || "")
  };
}

function normalizeBusinessProfile(value = {}) {
  const profile = cleanObject(value);

  return {
    shortDescription: String(profile.shortDescription || ""),
    bio: String(profile.bio || ""),
    websiteUrl: String(profile.websiteUrl || profile.website || ""),
    specialties: Array.isArray(profile.specialties) ? profile.specialties : [],
    amenities: Array.isArray(profile.amenities) ? profile.amenities : []
  };
}

function normalizeCardPromotion(value = {}) {
  const promotion = cleanObject(value);

  return {
    enabled: promotion.enabled === true,
    title: String(promotion.title || ""),
    body: String(promotion.body || ""),
    promoCode: String(promotion.promoCode || ""),
    ctaText: String(promotion.ctaText || "Learn More"),
    ctaUrl: String(promotion.ctaUrl || ""),
    expiresAt: String(promotion.expiresAt || "")
  };
}

function normalizeSubscriptionRecord(record = {}, business = {}) {
  const source = cleanObject(record);

  const plan =
    source.plan ||
    business.plan ||
    business.subscriptionPlan ||
    business.businessPlan ||
    "verified_basic";

  const subscriptionStatus =
    source.subscriptionStatus ||
    business.subscriptionStatus ||
    "active";

  return {
    ...source,
    plan: ALLOWED_PLANS.includes(plan) ? plan : "verified_basic",
    subscriptionStatus: ALLOWED_STATUSES.includes(subscriptionStatus)
      ? subscriptionStatus
      : "active",
    billingProvider: source.billingProvider || "manual_default",
    stripeCustomerId: source.stripeCustomerId || "",
    stripeSubscriptionId: source.stripeSubscriptionId || "",
    notes: source.notes || "",

    bookingWidget: normalizeBookingWidget(
      source.bookingWidget ||
      source.bookingIntegration ||
      business.bookingWidget ||
      business.bookingIntegration
    ),

    businessProfile: normalizeBusinessProfile(
      source.businessProfile ||
      source.publicProfile ||
      business.businessProfile ||
      business.publicProfile
    ),

    cardPromotion: normalizeCardPromotion(
      source.cardPromotion ||
      source.activeDeal ||
      business.cardPromotion ||
      business.activeDeal
    ),

    updatedAt: source.updatedAt || null
  };
}

function loadBusinessSubscriptions() {
  ensureSubscriptionsFileExists();

  try {
    const parsed = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, "utf8"));

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const normalized = {};

    for (const [key, value] of Object.entries(parsed)) {
      normalized[key] = normalizeSubscriptionRecord(value);
    }

    return normalized;
  } catch (error) {
    console.error("[SUBSCRIPTIONS] Failed to load:", error.message);
    return {};
  }
}

function saveBusinessSubscriptions(subscriptions = {}) {
  ensureSubscriptionsFileExists();

  const normalized = {};

  for (const [key, value] of Object.entries(subscriptions || {})) {
    normalized[key] = normalizeSubscriptionRecord(value);
  }

  fs.writeFileSync(
    SUBSCRIPTIONS_FILE,
    JSON.stringify(normalized, null, 2)
  );

  return normalized;
}

function getBusinessSubscription(business = {}) {
  const businessName = business.businessName || business.name || "";
  const key = normalizeBusinessKey(
    business.businessId || business.id || businessName
  );
  const nameKey = normalizeBusinessKey(businessName);

  const subscriptions = loadBusinessSubscriptions();
  const stored = subscriptions[key] || subscriptions[nameKey] || {};

  return normalizeSubscriptionRecord(stored, business);
}

function setBusinessSubscription(businessNameOrId, payload = {}) {
  const key = normalizeBusinessKey(businessNameOrId);

  if (!key) {
    throw new Error("Business name or ID is required.");
  }

  const plan = payload.plan || "verified_basic";
  const subscriptionStatus = payload.subscriptionStatus || "active";

  if (!ALLOWED_PLANS.includes(plan)) {
    throw new Error(`Invalid plan: ${plan}`);
  }

  if (!ALLOWED_STATUSES.includes(subscriptionStatus)) {
    throw new Error(`Invalid subscription status: ${subscriptionStatus}`);
  }

  const subscriptions = loadBusinessSubscriptions();
  const existing = normalizeSubscriptionRecord(subscriptions[key] || {});

  subscriptions[key] = normalizeSubscriptionRecord({
    ...existing,
    ...payload,
    plan,
    subscriptionStatus,
    billingProvider:
      payload.billingProvider ||
      existing.billingProvider ||
      "manual_admin",
    stripeCustomerId:
      payload.stripeCustomerId !== undefined
        ? payload.stripeCustomerId
        : existing.stripeCustomerId,
    stripeSubscriptionId:
      payload.stripeSubscriptionId !== undefined
        ? payload.stripeSubscriptionId
        : existing.stripeSubscriptionId,
    notes:
      payload.notes !== undefined
        ? payload.notes
        : existing.notes,

    bookingWidget:
      payload.bookingWidget !== undefined
        ? {
            ...existing.bookingWidget,
            ...cleanObject(payload.bookingWidget)
          }
        : existing.bookingWidget,

    businessProfile:
      payload.businessProfile !== undefined
        ? {
            ...existing.businessProfile,
            ...cleanObject(payload.businessProfile)
          }
        : existing.businessProfile,

    cardPromotion:
      payload.cardPromotion !== undefined
        ? {
            ...existing.cardPromotion,
            ...cleanObject(payload.cardPromotion)
          }
        : existing.cardPromotion,

    updatedAt: new Date().toISOString()
  });

  saveBusinessSubscriptions(subscriptions);

  return subscriptions[key];
}

module.exports = {
  normalizeBusinessKey,
  normalizeSubscriptionRecord,
  normalizeBookingWidget,
  normalizeBusinessProfile,
  normalizeCardPromotion,
  loadBusinessSubscriptions,
  saveBusinessSubscriptions,
  getBusinessSubscription,
  setBusinessSubscription
};