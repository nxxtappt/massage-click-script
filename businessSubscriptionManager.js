const fs = require("fs");
const path = require("path");

const SUBSCRIPTIONS_FILE = path.join(
  __dirname,
  "secure",
  "business-subscriptions.json"
);

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

function loadBusinessSubscriptions() {
  ensureSubscriptionsFileExists();

  try {
    const parsed = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (error) {
    console.error("[SUBSCRIPTIONS] Failed to load:", error.message);
    return {};
  }
}

function saveBusinessSubscriptions(subscriptions = {}) {
  ensureSubscriptionsFileExists();
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
}

function getBusinessSubscription(business = {}) {
  const businessName = business.businessName || business.name || "";
  const key = normalizeBusinessKey(business.businessId || businessName);
  const nameKey = normalizeBusinessKey(businessName);

  const subscriptions = loadBusinessSubscriptions();

  return (
    subscriptions[key] ||
    subscriptions[nameKey] ||
    {
      plan:
        business.plan ||
        business.subscriptionPlan ||
        business.businessPlan ||
        "verified_basic",

      subscriptionStatus:
        business.subscriptionStatus ||
        "active",

      billingProvider: "manual_default",
      stripeCustomerId: "",
      stripeSubscriptionId: "",
      updatedAt: null
    }
  );
}

function setBusinessSubscription(businessNameOrId, payload = {}) {
  const key = normalizeBusinessKey(businessNameOrId);

  if (!key) {
    throw new Error("Business name or ID is required.");
  }

  const allowedPlans = ["verified_basic", "premium"];
  const allowedStatuses = ["active", "inactive", "trialing", "past_due", "canceled"];

  const plan = payload.plan || "verified_basic";
  const subscriptionStatus = payload.subscriptionStatus || "active";

  if (!allowedPlans.includes(plan)) {
    throw new Error(`Invalid plan: ${plan}`);
  }

  if (!allowedStatuses.includes(subscriptionStatus)) {
    throw new Error(`Invalid subscription status: ${subscriptionStatus}`);
  }

  const subscriptions = loadBusinessSubscriptions();

  subscriptions[key] = {
    ...(subscriptions[key] || {}),
    plan,
    subscriptionStatus,
    billingProvider: payload.billingProvider || "manual_admin",
    stripeCustomerId: payload.stripeCustomerId || "",
    stripeSubscriptionId: payload.stripeSubscriptionId || "",
    notes: payload.notes || "",
    updatedAt: new Date().toISOString()
  };

  saveBusinessSubscriptions(subscriptions);

  return subscriptions[key];
}

module.exports = {
  normalizeBusinessKey,
  loadBusinessSubscriptions,
  saveBusinessSubscriptions,
  getBusinessSubscription,
  setBusinessSubscription
};
