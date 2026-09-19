const assert = require("assert");
const {
  getBookingWidgets,
  resolveWidgetForService,
  applyWidgetToJob
} = require("../bookingWidgetManager");

const business = {
  businessName: "Verification Clinic",
  platform: "mindbody",
  bookingUrl: "https://example.com/default",
  bookingWidgets: [
    {
      widgetId: "massage",
      label: "Massage",
      platform: "mindbody",
      bookingUrl: "https://example.com/massage",
      serviceTypes: ["massage"],
      enabled: true,
      isDefault: true
    },
    {
      widgetId: "acupuncture",
      label: "Acupuncture",
      platform: "mindbody",
      bookingUrl: "https://example.com/acupuncture",
      serviceTypes: ["acupuncture"],
      enabled: true
    }
  ]
};

assert.equal(getBookingWidgets(business).length, 2);
assert.equal(
  resolveWidgetForService(business, { serviceType: "acupuncture" }).widgetId,
  "acupuncture"
);
assert.equal(
  applyWidgetToJob(business, { serviceType: "acupuncture" }).bookingUrl,
  "https://example.com/acupuncture"
);

const legacy = {
  platform: "meevo",
  bookingUrl: "https://example.com/legacy"
};

assert.equal(getBookingWidgets(legacy).length, 1);
assert.equal(
  resolveWidgetForService(legacy, { serviceType: "massage" }).bookingUrl,
  "https://example.com/legacy"
);

console.log("Multi-widget verification passed.");
