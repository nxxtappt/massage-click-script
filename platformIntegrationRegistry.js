"use strict";

const PLATFORM_DEFINITIONS = require("./public/platformDefinitions");

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
}

function normalizeIntegrationType(value) {
  const normalized = normalizeKey(value || "scrape");
  if (normalized === "scraper") return "scrape";
  if (normalized === "api-integration") return "api";
  return normalized || "scrape";
}

function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function valueIsPresent(value) {
  return value !== undefined && value !== null && value !== "";
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

function getFieldCandidates(field = {}) {
  return [field.key, ...(Array.isArray(field.aliases) ? field.aliases : [])].filter(Boolean);
}

function readPath(source, path) {
  return String(path)
    .split(".")
    .reduce((value, key) => (value == null ? undefined : value[key]), source);
}

function readConfiguredField(field = {}, ...sources) {
  const candidates = getFieldCandidates(field);

  for (const source of sources) {
    const object = cleanObject(source);

    for (const candidate of candidates) {
      const directValue = readPath(object, candidate);
      if (valueIsPresent(directValue)) return directValue;

      const configValue = readPath(cleanObject(object.config), candidate);
      if (valueIsPresent(configValue)) return configValue;

      const integrationConfigValue = readPath(
        cleanObject(object.integrationConfig),
        candidate
      );
      if (valueIsPresent(integrationConfigValue)) return integrationConfigValue;
    }
  }

  return field.defaultValue;
}

function fieldIsRequired(field = {}, integrationType = "scrape") {
  if (field.required === true) return true;

  const requiredFor = Array.isArray(field.requiredFor) ? field.requiredFor : [];
  return requiredFor.map(normalizeIntegrationType).includes(
    normalizeIntegrationType(integrationType)
  );
}

function collectPlatformConfig(platform, integration = {}, business = {}, existingConfig = {}) {
  const definition = getPlatformDefinition(platform);
  const config = { ...cleanObject(existingConfig) };

  for (const field of definition?.integrationFields || []) {
    if (field.storage !== "config") continue;

    const value = readConfiguredField(field, integration, business, config);
    if (valueIsPresent(value)) {
      config[field.key] = value;
    }
  }

  return config;
}

function normalizeIntegration(integration = {}, business = {}) {
  const raw = cleanObject(integration.raw_json || integration.rawJson);
  const platform = normalizeKey(
    integration.platform ||
      integration.provider ||
      raw.platform ||
      business.platform
  );
  const integrationType = normalizeIntegrationType(
    integration.integrationType ||
      integration.integration_type ||
      raw.integrationType ||
      business.integrationType ||
      business.integration_type ||
      "scrape"
  );

  const baseConfig = {
    ...cleanObject(raw.config),
    ...cleanObject(business.integrationConfig),
    ...cleanObject(integration.config),
    ...cleanObject(integration.integrationConfig)
  };

  const config = collectPlatformConfig(
    platform,
    integration,
    business,
    baseConfig
  );

  return {
    id:
      integration.id ||
      integration.integrationId ||
      integration.integration_id ||
      raw.id ||
      null,
    integrationId:
      integration.integrationId ||
      integration.integration_id ||
      integration.id ||
      raw.id ||
      null,
    businessId:
      integration.businessId ||
      integration.business_id ||
      business.businessId ||
      business.business_id ||
      business.id ||
      null,
    name:
      integration.name ||
      raw.name ||
      `${platform || "unknown"} ${integrationType}`,
    platform,
    integrationType,
    apiProvider:
      integration.apiProvider ||
      integration.api_provider ||
      raw.apiProvider ||
      business.apiProvider ||
      business.api_provider ||
      "",
    credentialId:
      integration.credentialId ||
      integration.credential_id ||
      raw.credentialId ||
      business.credentialId ||
      business.credential_id ||
      "",
    bookingUrl:
      integration.bookingUrl ||
      integration.booking_url ||
      raw.bookingUrl ||
      business.bookingUrl ||
      business.booking_url ||
      "",
    status:
      normalizeKey(
        integration.status ||
          integration.integrationStatus ||
          integration.integration_status ||
          raw.status ||
          "active"
      ) || "active",
    enabled: integration.enabled !== false && raw.enabled !== false,
    priority: Number(integration.priority ?? raw.priority ?? 100),
    isDefault:
      integration.isDefault === true ||
      integration.is_default === true ||
      raw.isDefault === true,
    config,
    capabilities: Array.isArray(integration.capabilities)
      ? integration.capabilities
      : getPlatformDefinition(platform)?.capabilities || [],
    rawJson: {
      ...raw,
      ...cleanObject(integration.rawJson),
      platform,
      integrationType,
      bookingUrl:
        integration.bookingUrl ||
        integration.booking_url ||
        raw.bookingUrl ||
        business.bookingUrl ||
        business.booking_url ||
        "",
      config
    }
  };
}

function buildLegacyIntegration(business = {}) {
  if (!business.platform && !business.integrationType && !business.bookingUrl) {
    return null;
  }

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
  const source = Array.isArray(business.integrations)
    ? business.integrations
    : [];
  const normalized = source.map((item) => normalizeIntegration(item, business));

  if (!normalized.length) {
    const legacy = buildLegacyIntegration(business);
    if (legacy) normalized.push(legacy);
  }

  return normalized.sort((a, b) => {
    const defaultDifference = Number(b.isDefault) - Number(a.isDefault);
    return defaultDifference || a.priority - b.priority;
  });
}

function integrationIsUsable(integration = {}) {
  return (
    integration.enabled !== false &&
    !["disabled", "inactive", "deleted"].includes(
      normalizeKey(integration.status)
    )
  );
}

function resolveEnabledIntegration(business = {}, options = {}) {
  const integrations = normalizeBusinessIntegrations(business).filter(
    integrationIsUsable
  );
  const requestedId = String(options.integrationId || options.id || "");
  const requestedPlatform = normalizeKey(options.platform || "");
  const requestedType = normalizeIntegrationType(options.integrationType || "");

  return (
    integrations.find(
      (item) =>
        requestedId && String(item.integrationId || item.id) === requestedId
    ) ||
    integrations.find(
      (item) =>
        requestedPlatform &&
        item.platform === requestedPlatform &&
        (!options.integrationType || item.integrationType === requestedType)
    ) ||
    integrations.find((item) => item.isDefault) ||
    integrations[0] ||
    null
  );
}

function validateIntegration(integration = {}, business = {}) {
  const normalized = normalizeIntegration(integration, business);
  const definition = getPlatformDefinition(normalized.platform);
  const errors = [];
  const warnings = [];

  if (!normalized.platform) {
    errors.push("Integration platform is required.");
  }

  if (!definition) {
    errors.push(
      `Unsupported integration platform: ${normalized.platform || "unknown"}.`
    );
  }

  for (const field of definition?.integrationFields || []) {
    if (!fieldIsRequired(field, normalized.integrationType)) continue;

    const value = readConfiguredField(
      field,
      normalized,
      normalized.config,
      business
    );

    if (!valueIsPresent(value)) {
      errors.push(
        `${definition.label} ${normalized.integrationType} integration requires ${field.label || field.key}.`
      );
    }
  }

  if (normalized.integrationType === "api" && !normalized.apiProvider) {
    warnings.push(
      "API integration has no explicit apiProvider; platform will be used as the provider."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    definition
  };
}

function normalizeServiceConfigMap(config = {}) {
  const serviceConfigs = config.serviceConfigs;

  if (Array.isArray(serviceConfigs)) {
    return serviceConfigs;
  }

  return cleanObject(serviceConfigs);
}

function getServiceIdentityCandidates(service = {}) {
  return [
    service.businessServiceId,
    service.serviceDatabaseId,
    service.id,
    service.canonicalKey,
    service.anchorServiceKey,
    service.platformServiceId,
    service.serviceId,
    service.serviceButtonId,
    service.serviceName && service.durationMinutes
      ? `${service.serviceName}|${service.durationMinutes}`
      : "",
    service.serviceName
  ]
    .filter(valueIsPresent)
    .map((value) => String(value));
}

function serviceConfigMatches(serviceConfig = {}, service = {}) {
  const serviceCandidates = new Set(getServiceIdentityCandidates(service));
  const configCandidates = getServiceIdentityCandidates(serviceConfig);

  if (configCandidates.some((value) => serviceCandidates.has(value))) {
    return true;
  }

  return (
    serviceConfig.serviceName &&
    service.serviceName &&
    String(serviceConfig.serviceName).trim().toLowerCase() ===
      String(service.serviceName).trim().toLowerCase() &&
    (!serviceConfig.durationMinutes ||
      !service.durationMinutes ||
      Number(serviceConfig.durationMinutes) === Number(service.durationMinutes))
  );
}

function resolveServiceConfig(config = {}, service = {}) {
  const source = normalizeServiceConfigMap(config);

  if (Array.isArray(source)) {
    return cleanObject(source.find((item) => serviceConfigMatches(item, service)));
  }

  for (const candidate of getServiceIdentityCandidates(service)) {
    if (source[candidate] && typeof source[candidate] === "object") {
      return cleanObject(source[candidate]);
    }
  }

  const values = Object.values(source).filter(
    (item) => item && typeof item === "object" && !Array.isArray(item)
  );

  return cleanObject(values.find((item) => serviceConfigMatches(item, service)));
}

function validateJobConfiguration(job = {}, definition = null) {
  const platformDefinition =
    definition || getPlatformDefinition(job.platform || job.integration?.platform);
  const integrationType = normalizeIntegrationType(
    job.integrationType || job.integration?.integrationType || "scrape"
  );
  const errors = [];
  const warnings = [];

  if (!platformDefinition) {
    return { valid: true, errors, warnings, definition: null };
  }

  for (const field of platformDefinition.serviceFields || []) {
    if (!fieldIsRequired(field, integrationType)) continue;

    const value = readConfiguredField(
      field,
      job,
      job.serviceConfig,
      job.integrationConfig
    );

    if (!valueIsPresent(value)) {
      errors.push(
        `${platformDefinition.label} service "${job.serviceName || "Unnamed service"}" requires ${field.label || field.key}.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    definition: platformDefinition
  };
}

function applyIntegrationToJob(job = {}, integration = {}) {
  const normalizedIntegration = normalizeIntegration(integration, job);
  const config = cleanObject(normalizedIntegration.config);
  const serviceConfig = resolveServiceConfig(config, job);

  const resolved = {
    ...config,
    ...job,
    ...serviceConfig,
    platform: normalizedIntegration.platform || job.platform,
    integrationId:
      normalizedIntegration.integrationId || normalizedIntegration.id || null,
    integrationType:
      normalizedIntegration.integrationType || job.integrationType || "scrape",
    apiProvider:
      normalizedIntegration.apiProvider ||
      job.apiProvider ||
      normalizedIntegration.platform ||
      "",
    credentialId:
      normalizedIntegration.credentialId || job.credentialId || "",
    bookingUrl:
      normalizedIntegration.bookingUrl || config.bookingUrl || job.bookingUrl || "",
    integrationConfig: config,
    serviceConfig,
    integration: normalizedIntegration
  };

  const existingValidation = cleanObject(job.integrationValidation);
  const jobConfigurationValidation = validateJobConfiguration(
    resolved,
    getPlatformDefinition(resolved.platform)
  );
  const errors = [
    ...(Array.isArray(existingValidation.errors)
      ? existingValidation.errors
      : []),
    ...jobConfigurationValidation.errors
  ];
  const warnings = [
    ...(Array.isArray(existingValidation.warnings)
      ? existingValidation.warnings
      : []),
    ...jobConfigurationValidation.warnings
  ];

  return {
    ...resolved,
    integrationValidation: {
      valid: errors.length === 0,
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
      definition:
        jobConfigurationValidation.definition || existingValidation.definition || null
    }
  };
}

module.exports = {
  PLATFORM_DEFINITIONS,
  normalizeKey,
  normalizeIntegrationType,
  getPlatformDefinition,
  listPlatformDefinitions,
  normalizeIntegration,
  normalizeBusinessIntegrations,
  resolveEnabledIntegration,
  validateIntegration,
  validateJobConfiguration,
  applyIntegrationToJob,
  integrationIsUsable,
  resolveServiceConfig,
  getServiceIdentityCandidates
};