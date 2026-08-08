const legalAcceptanceRepository = require("./database/legalAcceptanceRepository");
const {
  CONSUMER_ACCEPTANCE_TEXT,
  BUSINESS_ACCEPTANCE_TEXT,
  getClientIp,
  getUserAgent,
  getRequestId,
  validateConsumerAcceptance,
  validateBusinessAcceptance
} = require("./legalPolicy");

async function recordConsumerClickwrap(req, user) {
  validateConsumerAcceptance(req.body?.acceptance);

  return legalAcceptanceRepository.recordConsumerAcceptance({
    userId: user.id,
    email: user.email,
    acceptanceText: CONSUMER_ACCEPTANCE_TEXT,
    source: "consumer_account_login",
    ipAddress: getClientIp(req),
    userAgent: getUserAgent(req),
    requestId: getRequestId(req),
    metadata: {
      route: req.originalUrl || req.url || "",
      identityStage: "email_code_verified"
    }
  });
}

async function recordBusinessClickwrap(req, session) {
  validateBusinessAcceptance(req.body?.acceptance);

  return legalAcceptanceRepository.recordBusinessAcceptance({
    businessId: session.businessId,
    businessName: session.businessName,
    email: session.email,
    acceptanceText: BUSINESS_ACCEPTANCE_TEXT,
    source: "business_account_login",
    ipAddress: getClientIp(req),
    userAgent: getUserAgent(req),
    requestId: getRequestId(req),
    metadata: {
      route: req.originalUrl || req.url || "",
      identityStage: "business_email_code_verified"
    }
  });
}

module.exports = {
  recordConsumerClickwrap,
  recordBusinessClickwrap
};