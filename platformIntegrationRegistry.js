"use strict";

const PLATFORM_DEFINITIONS = Object.freeze({
  mindbody: {
    label: "Mindbody",
    capabilities: ["scrape", "api", "service_discovery", "provider_selection"],
    required: { scrape: ["bookingUrl"], api: ["credentialId"] },
    optional: ["siteId", "locationId", "sessionTypeId", "providerText"]
  },
  "mindbody-old": {
    label: "Mindbody Legacy",
    capabilities: ["scrape", "provider_selection"],
    required: { scrape: ["bookingUrl"] },
    optional: ["sessionTypeId", "providerText"]
  },
  schedulista: {
    label: "Schedulista",
    capabilities: ["scrape", "service_discovery"],
    required: { scrape: ["bookingUrl"] },
    optional: ["platformServiceId"]
  },
  meevo: {
    label: "Meevo",
    capabilities: ["scrape", "service_discovery", "provider_selection"],
    required: { scrape: ["bookingUrl"] },
    optional: ["categoryName", "providerText"]
  },
  vagaro: {
    label: "Vagaro",
    capabilities: ["scrape", "marketplace_discovery", "service_discovery"],
    required: { scrape: ["bookingUrl"] },
    optional: ["marketplaceBusinessId", "platformServiceId", "providerText"]
  },
  axl3: {
    label: "Acuity / AXL3",
    capabilities: ["scrape", "service_discovery"],
    required: { scrape: ["bookingUrl"] },
    optional: ["platformServiceId"]
  },
  booker: {
    label: "Booker",
    capabilities: ["scrape", "service_discovery", "provider_selection"],
    required: { scrape: ["bookingUrl"] },
    optional: ["platformServiceId", "providerText"]
  },
  zenoti: {
    label: "Zenoti",
    capabilities: ["scrape", "service_discovery", "provider_selection"],
    required: { scrape: ["bookingUrl"] },
    optional: ["centerId", "platformServiceId", "providerText"]
  },
  oakhaven: {
    label: "Oak Haven Custom",
    capabilities: ["scrape"],
    required: { scrape: ["bookingUrl"] },
    optional: ["sessionTypeId"]
  },
  "massage-envy": {
    label: "Massage Envy Custom",
    capabilities: ["scrape", "provider_selection"],
    required: { scrape: ["bookingUrl"] },
    optional: ["locationId", "platformServiceId", "providerText"]
  },
  mangomint: {
    label: "Mangomint",
    capabilities: ["scrape", "service_discovery", "provider_selection"],
    required: { scrape: ["bookingUrl"] },
    optional: ["companyId", "locationId", "platformServiceId", "providerText"]
  },
  "hand-stone": {
    label: "Hand & Stone Custom",
    capabilities: ["scrape", "provider_selection"],
    required: { scrape: ["bookingUrl"] },
    optional: ["locationId", "platformServiceId", "providerText"]
  }
});

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
}

function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getPlatformDefinition(platform) {
  return PLATFORM_DEFINITIONS[normalizeKey(platform)] || null;
}

function listPlatformDefinitions() {
  return Object.entries(PLATFORM_DEFINITIONS).map(([key, definition]) => ({
    key,
    ...definition
  }));
}

function normalizeIntegration(integration = {}, business = {}) {
  const raw = cleanObject(integration.raw_json || integration.rawJson);
  const config = {
    ...cleanObject(raw.config),
    ...cleanObject(integration.config),
    ...cleanObject(integration.integrationConfig)
  };
  const platform = normalizeKey(
    integration.platform || integration.provider || raw.platform || business.platform
  );
  const integrationType = normalizeKey(
    integration.integrationType ||
      integration.integration_type ||
      raw.integrationType ||
      business.integrationType ||
      "scrape"
  ) || "scrape";

  return {
    id: integration.id || integration.integrationId || integration.integration_id || raw.id || null,
    integrationId:
      integration.integrationId || integration.integration_id || integration.id || raw.id || null,
    businessId:
      integration.businessId || integration.business_id || business.businessId || business.id || null,
    name: integration.name || raw.name || `${platform || "unknown"} ${integrationType}`,
    platform,
    integrationType,
    apiProvider:
      integration.apiProvider || integration.api_provider || raw.apiProvider || business.apiProvider || "",
    credentialId:
      integration.credentialId || integration.credential_id || raw.credentialId || business.credentialId || "",
    bookingUrl:
      integration.bookingUrl || integration.booking_url || raw.bookingUrl || business.bookingUrl || "",
    status:
      normalizeKey(integration.status || integration.integrationStatus || integration.integration_status || raw.status || "active") || "active",
    enabled: integration.enabled !== false && raw.enabled !== false,
    priority: Number(integration.priority ?? raw.priority ?? 100),
    isDefault:
      integration.isDefault === true || integration.is_default === true || raw.isDefault === true,
    config,
    capabilities: Array.isArray(integration.capabilities)
      ? integration.capabilities
      : getPlatformDefinition(platform)?.capabilities || [],
    rawJson: { ...raw, ...integration.rawJson }
  };
}

function buildLegacyIntegration(business = {}) {
  if (!business.platform && !business.integrationType && !business.bookingUrl) return null;
  return normalizeIntegration(
    {
      id: `legacy:${business.businessId || business.id || business.businessName || "business"}`,
      platform: business.platform,
      integrationType: business.integrationType || "scrape",
      apiProvider: business.apiProvider,
      credentialId: business.credentialId,
      bookingUrl: business.bookingUrl,
      status: business.integrationStatus || "active",
      enabled: business.enabled !== false,
      isDefault: true,
      config: business.integrationConfig || {}
    },
    business
  );
}

function normalizeBusinessIntegrations(business = {}) {
  const source = Array.isArray(business.integrations) ? business.integrations : [];
  const normalized = source.map((item) => normalizeIntegration(item, business));
  if (!normalized.length) {
    const legacy = buildLegacyIntegration(business);
    if (legacy) normalized.push(legacy);
  }
  return normalized.sort((a, b) => {
    const defaultDiff = Number(b.isDefault) - Number(a.isDefault);
    return defaultDiff || a.priority - b.priority;
  });
}

function integrationIsUsable(integration = {}) {
  return integration.enabled !== false && !["disabled", "inactive", "deleted"].includes(normalizeKey(integration.status));
}

function resolveEnabledIntegration(business = {}, options = {}) {
  const integrations = normalizeBusinessIntegrations(business).filter(integrationIsUsable);
  const requestedId = String(options.integrationId || options.id || "");
  const requestedPlatform = normalizeKey(options.platform || "");
  const requestedType = normalizeKey(options.integrationType || "");

  return (
    integrations.find((item) => requestedId && String(item.integrationId || item.id) === requestedId) ||
    integrations.find((item) => requestedPlatform && item.platform === requestedPlatform && (!requestedType || item.integrationType === requestedType)) ||
    integrations.find((item) => item.isDefault) ||
    integrations[0] ||
    null
  );
}

function readPath(source, path) {
  return String(path).split(".").reduce((value, key) => (value == null ? undefined : value[key]), source);
}

function validateIntegration(integration = {}, business = {}) {
  const definition = getPlatformDefinition(integration.platform);
  const errors = [];
  const warnings = [];
  if (!integration.platform) errors.push("Integration platform is required.");
  if (!definition) errors.push(`Unsupported integration platform: ${integration.platform || "unknown"}.`);
  const required = definition?.required?.[integration.integrationType] || [];
  const validationSource = { ...business, ...integration, ...integration.config };
  required.forEach((field) => {
    if (readPath(validationSource, field) === undefined || readPath(validationSource, field) === null || readPath(validationSource, field) === "") {
      errors.push(`${definition.label} ${integration.integrationType} integration requires ${field}.`);
    }
  });
  if (integration.integrationType === "api" && !integration.apiProvider) {
    warnings.push("API integration has no explicit apiProvider; platform will be used as the provider.");
  }
  return { valid: errors.length === 0, errors, warnings, definition };
}

function applyIntegrationToJob(job = {}, integration = {}) {
  return {
    ...job,
    platform: integration.platform || job.platform,
    integrationId: integration.integrationId || integration.id || null,
    integrationType: integration.integrationType || job.integrationType || "scrape",
    apiProvider: integration.apiProvider || job.apiProvider || integration.platform || "",
    credentialId: integration.credentialId || job.credentialId || "",
    bookingUrl: integration.bookingUrl || job.bookingUrl || "",
    integrationConfig: { ...integration.config },
    integration
  };
}

module.exports = {
  PLATFORM_DEFINITIONS,
  normalizeKey,
  getPlatformDefinition,
  listPlatformDefinitions,
  normalizeIntegration,
  normalizeBusinessIntegrations,
  resolveEnabledIntegration,
  validateIntegration,
  applyIntegrationToJob,
  integrationIsUsable
};