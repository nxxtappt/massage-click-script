const analyticsRepository = require("./database/analyticsRepository");

async function logAppointmentClick(payload = {}, requestMeta = {}) {
  return analyticsRepository.logAppointmentClick(payload, requestMeta);
}
async function getAppointmentClicks(filters = {}) {
  return analyticsRepository.getAppointmentClicks(filters);
}
async function readAppointmentClicks(filters = {}) {
  return getAppointmentClicks(filters);
}
async function getBusinessClickSummary(businessName = "", options = {}) {
  return analyticsRepository.getBusinessAnalytics(businessName, options);
}
async function getCitywideClickSummary(options = {}) {
  return analyticsRepository.getCitywideClickSummary(options);
}
async function trackPageView(payload = {}, requestMeta = {}) {
  return analyticsRepository.trackPageView(payload, requestMeta);
}
async function heartbeat(payload = {}, requestMeta = {}) {
  return analyticsRepository.heartbeat(payload, requestMeta);
}
async function getAdminSiteAnalytics(options = {}) {
  return analyticsRepository.getAdminSiteAnalytics(options);
}

module.exports = {
  logAppointmentClick,
  getAppointmentClicks,
  readAppointmentClicks,
  getBusinessClickSummary,
  getCitywideClickSummary,
  trackPageView,
  heartbeat,
  getAdminSiteAnalytics
};