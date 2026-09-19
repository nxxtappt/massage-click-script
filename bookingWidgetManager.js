const crypto = require("crypto");

function slugify(value = "") {
  return String(value || "widget")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "widget";
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function normalizeWidget(raw = {}, index = 0) {
  const bookingUrl = raw.bookingUrl || raw.booking_url || raw.url || "";
  const label =
    raw.label || raw.widgetName || raw.widget_name || raw.name || `Booking Widget ${index + 1}`;
  const widgetId =
    raw.widgetId ||
    raw.widget_id ||
    raw.integrationId ||
    raw.integration_id ||
    raw.id ||
    `${slugify(label)}-${crypto.createHash("sha1").update(`${bookingUrl}:${index}`).digest("hex").slice(0, 8)}`;

  return {
    ...raw,
    id: widgetId,
    widgetId,
    widgetName: label,
    label,
    platform: raw.platform || raw.provider || "",
    bookingUrl,
    integrationType:
      raw.integrationType || raw.integration_type || raw.type || "scrape",
    apiProvider: raw.apiProvider || raw.api_provider || "",
    credentialId: raw.credentialId || raw.credential_id || "",
    enabled: raw.enabled !== false,
    isDefault: raw.isDefault === true || raw.is_default === true,
    serviceIds: unique(raw.serviceIds || raw.service_ids || []),
    serviceTypes: unique(raw.serviceTypes || raw.service_types || []),
    serviceNames: unique(raw.serviceNames || raw.service_names || [])
  };
}

function getBookingWidgets(business = {}) {
  const configured = Array.isArray(business.bookingWidgets)
    ? business.bookingWidgets
    : Array.isArray(business.booking_widgets)
      ? business.booking_widgets
      : Array.isArray(business.integrations)
        ? business.integrations
        : [];

  const widgets = configured.map(normalizeWidget).filter((widget) => {
    return widget.bookingUrl || widget.platform || widget.integrationType === "api";
  });

  if (widgets.length) return widgets;

  if (!business.bookingUrl && !business.platform && business.integrationType !== "api") {
    return [];
  }

  return [
    normalizeWidget(
      {
        widgetId: "default",
        label: "Primary booking widget",
        platform: business.platform || "",
        bookingUrl: business.bookingUrl || "",
        integrationType: business.integrationType || "scrape",
        apiProvider: business.apiProvider || "",
        credentialId: business.credentialId || "",
        enabled: true,
        isDefault: true
      },
      0
    )
  ];
}

function serviceIdentityValues(service = {}) {
  return unique([
    service.serviceId,
    service.platformServiceId,
    service.serviceButtonId
  ]).map(normalize);
}

function widgetMatchesService(widget = {}, service = {}) {
  const widgetServiceIds = unique(widget.serviceIds).map(normalize);
  const widgetServiceTypes = unique(widget.serviceTypes).map(normalize);
  const widgetServiceNames = unique(widget.serviceNames).map(normalize);
  const serviceIds = serviceIdentityValues(service);
  const serviceType = normalize(service.serviceType || service.serviceCategory);
  const serviceName = normalize(service.serviceName || service.service);

  return Boolean(
    (widgetServiceIds.length && serviceIds.some((id) => widgetServiceIds.includes(id))) ||
      (widgetServiceTypes.length && widgetServiceTypes.includes(serviceType)) ||
      (widgetServiceNames.length && widgetServiceNames.includes(serviceName))
  );
}

function resolveWidgetForService(business = {}, service = {}, requestedWidget = "") {
  const widgets = getBookingWidgets(business).filter((widget) => widget.enabled !== false);
  if (!widgets.length) return null;

  const explicitId =
    requestedWidget ||
    service.bookingWidgetId ||
    service.booking_widget_id ||
    service.widgetId ||
    service.widget_id ||
    service.integrationId ||
    service.integration_id ||
    "";

  if (explicitId) {
    const explicit = widgets.find((widget) => {
      return normalize(widget.widgetId) === normalize(explicitId) ||
        normalize(widget.label) === normalize(explicitId);
    });
    if (explicit) return explicit;
    // A manual widget filter must never silently run a different widget.
    if (requestedWidget) return null;
  }

  const matched = widgets.find((widget) => widgetMatchesService(widget, service));
  if (matched) return matched;

  return widgets.find((widget) => widget.isDefault) || widgets[0];
}

function applyWidgetToJob(business = {}, service = {}, requestedWidget = "") {
  const widget = resolveWidgetForService(business, service, requestedWidget);
  if (!widget) return {};

  return {
    widgetId: widget.widgetId,
    widgetName: widget.label,
    bookingWidgetId: widget.widgetId,
    bookingWidgetName: widget.label,
    bookingUrl: widget.bookingUrl || business.bookingUrl || "",
    platform: widget.platform || business.platform || "",
    integrationType: widget.integrationType || business.integrationType || "scrape",
    apiProvider: widget.apiProvider || business.apiProvider || "",
    credentialId: widget.credentialId || business.credentialId || "",
    bookingWidget: widget
  };
}

function getPublicBookingWidgets(business = {}) {
  return getBookingWidgets(business)
    .filter((widget) => widget.enabled !== false)
    .map((widget) => ({
      widgetId: widget.widgetId,
      label: widget.label,
      platform: widget.platform,
      bookingUrl: widget.bookingUrl,
      isDefault: widget.isDefault,
      serviceIds: widget.serviceIds,
      serviceTypes: widget.serviceTypes,
      serviceNames: widget.serviceNames
    }));
}

module.exports = {
  normalizeWidget,
  getBookingWidgets,
  resolveWidgetForService,
  applyWidgetToJob,
  getPublicBookingWidgets
};
