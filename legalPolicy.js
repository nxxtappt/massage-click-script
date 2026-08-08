const TERMS_VERSION = "2026-08-08";
const PRIVACY_VERSION = "2026-08-08";
const EFFECTIVE_DATE = "2026-08-08";

const CONSUMER_ACCEPTANCE_TEXT =
  "I am at least 18 and agree to the NextAppt.ai Terms of Service, including the arbitration and class-action waiver, and acknowledge the Privacy Policy.";

const BUSINESS_ACCEPTANCE_TEXT =
  "I am at least 18, agree to the NextAppt.ai Terms of Service, including the arbitration and class-action waiver, acknowledge the Privacy Policy, and confirm that I am authorized to act for and bind this business.";

function getClientIp(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();

  const raw =
    forwarded ||
    req?.ip ||
    req?.socket?.remoteAddress ||
    "";

  if (!raw) return null;

  // PostgreSQL INET does not accept IPv4-mapped notation on all setups.
  return String(raw).replace(/^::ffff:/, "").slice(0, 80) || null;
}

function getUserAgent(req) {
  return String(req?.headers?.["user-agent"] || "").slice(0, 2000) || null;
}

function getRequestId(req) {
  return String(
    req?.headers?.["x-request-id"] ||
    req?.headers?.["x-render-request-id"] ||
    ""
  ).slice(0, 200) || null;
}

function normalizeAcceptancePayload(raw = {}) {
  const payload =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw
      : {};

  return {
    termsAccepted: payload.termsAccepted === true,
    privacyAcknowledged: payload.privacyAcknowledged === true,
    age18Confirmed: payload.age18Confirmed === true,
    businessAuthorityConfirmed:
      payload.businessAuthorityConfirmed === true,
    termsVersion: String(payload.termsVersion || ""),
    privacyVersion: String(payload.privacyVersion || "")
  };
}

function validateConsumerAcceptance(raw = {}) {
  const value = normalizeAcceptancePayload(raw);

  if (
    !value.termsAccepted ||
    !value.privacyAcknowledged ||
    !value.age18Confirmed
  ) {
    const error = new Error(
      "You must be at least 18 and accept the current Terms of Service and acknowledge the Privacy Policy to create or use a NextAppt consumer account."
    );
    error.statusCode = 400;
    throw error;
  }

  if (
    value.termsVersion !== TERMS_VERSION ||
    value.privacyVersion !== PRIVACY_VERSION
  ) {
    const error = new Error(
      "The NextAppt legal terms were updated. Refresh the page and review the current Terms of Service and Privacy Policy."
    );
    error.statusCode = 409;
    throw error;
  }

  return value;
}

function validateBusinessAcceptance(raw = {}) {
  const value = normalizeAcceptancePayload(raw);

  if (
    !value.termsAccepted ||
    !value.privacyAcknowledged ||
    !value.age18Confirmed ||
    !value.businessAuthorityConfirmed
  ) {
    const error = new Error(
      "You must be at least 18, accept the current Terms of Service, acknowledge the Privacy Policy, and confirm authority to act for the business."
    );
    error.statusCode = 400;
    throw error;
  }

  if (
    value.termsVersion !== TERMS_VERSION ||
    value.privacyVersion !== PRIVACY_VERSION
  ) {
    const error = new Error(
      "The NextAppt legal terms were updated. Refresh the page and review the current Terms of Service and Privacy Policy."
    );
    error.statusCode = 409;
    throw error;
  }

  return value;
}

module.exports = {
  TERMS_VERSION,
  PRIVACY_VERSION,
  EFFECTIVE_DATE,
  CONSUMER_ACCEPTANCE_TEXT,
  BUSINESS_ACCEPTANCE_TEXT,
  getClientIp,
  getUserAgent,
  getRequestId,
  normalizeAcceptancePayload,
  validateConsumerAcceptance,
  validateBusinessAcceptance
};