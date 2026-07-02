function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeServiceType(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_")
    .trim();
}

function getServiceDuration(service = {}) {
  const duration = Number(service.durationMinutes || service.duration || 0);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function getServiceKey(service = {}) {
  return [
    normalize(service.serviceName || service.name || ""),
    normalizeServiceType(service.serviceType || service.serviceCategory || ""),
    getServiceDuration(service) || ""
  ].join("|");
}

function serviceIsEnabled(service = {}) {
  return service.enabled !== false;
}

function getSearchInference(service = {}) {
  return service.searchInference && typeof service.searchInference === "object"
    ? service.searchInference
    : {};
}

function serviceCanBeInferred(service = {}) {
  const inference = getSearchInference(service);
  return inference.canBeInferred === true;
}

function serviceIsInferenceAnchor(service = {}) {
  const inference = getSearchInference(service);
  return inference.isInferenceAnchor === true;
}

function serviceAllowsShorterDurationInference(service = {}) {
  const inference = getSearchInference(service);
  return inference.inferShorterDurations === true;
}

function getInferServiceTypes(service = {}) {
  const inference = getSearchInference(service);

  if (!Array.isArray(inference.inferServiceTypes)) {
    return [];
  }

  return inference.inferServiceTypes
    .map(normalizeServiceType)
    .filter(Boolean);
}

function getInferStartIntervalMinutes(service = {}, fallback = 15) {
  const inference = getSearchInference(service);
  const value = Number(inference.inferStartIntervalMinutes || fallback);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function servicesMatch(a = {}, b = {}) {
  const aName = normalize(a.serviceName || a.name || "");
  const bName = normalize(b.serviceName || b.name || "");

  const aType = normalizeServiceType(a.serviceType || a.serviceCategory || "");
  const bType = normalizeServiceType(b.serviceType || b.serviceCategory || "");

  const aDuration = getServiceDuration(a);
  const bDuration = getServiceDuration(b);

  if (aName && bName && aName === bName) {
    return true;
  }

  return Boolean(aType && bType && aType === bType && aDuration === bDuration);
}

function findMatchingBusinessService(scrapedService = {}, businessConfig = {}) {
  const services = Array.isArray(businessConfig.services)
    ? businessConfig.services
    : [];

  return (
    services.find((service) => servicesMatch(scrapedService, service)) || null
  );
}

function sortServicesForInference(services = []) {
  return [...services].sort((a, b) => {
    const bDuration = getServiceDuration(b) || 0;
    const aDuration = getServiceDuration(a) || 0;

    if (aDuration !== bDuration) {
      return bDuration - aDuration;
    }

    return String(a.serviceName || "").localeCompare(
      String(b.serviceName || "")
    );
  });
}

function getDefaultBusinessInferenceRules(businessConfig = {}) {
  const rules =
    businessConfig.inferenceRules && typeof businessConfig.inferenceRules === "object"
      ? businessConfig.inferenceRules
      : {};

  return {
    inferDownwardOnly: rules.inferDownwardOnly !== false,
    durationIntervalMinutes: Number(rules.durationIntervalMinutes || 15),
    serviceMappings:
      rules.serviceMappings && typeof rules.serviceMappings === "object"
        ? rules.serviceMappings
        : {}
  };
}

function getMappedServiceTypes(anchorService = {}, businessConfig = {}) {
  const anchorType = normalizeServiceType(
    anchorService.serviceType || anchorService.serviceCategory || ""
  );

  const explicitTypes = getInferServiceTypes(anchorService);

  if (explicitTypes.length > 0) {
    return explicitTypes;
  }

  const rules = getDefaultBusinessInferenceRules(businessConfig);
  const mapped = rules.serviceMappings[anchorType];

  if (!Array.isArray(mapped)) {
    return [];
  }

  return mapped.map(normalizeServiceType).filter(Boolean);
}

function getCandidateServices(anchorService = {}, businessConfig = {}) {
  const services = Array.isArray(businessConfig.services)
    ? businessConfig.services
    : [];

  const anchorDuration = getServiceDuration(anchorService);
  const anchorType = normalizeServiceType(anchorService.serviceType || "");
  const mappedServiceTypes = getMappedServiceTypes(anchorService, businessConfig);

  const allowedTypes = new Set([
    anchorType,
    ...mappedServiceTypes
  ].filter(Boolean));

  return services.filter((service) => {
    if (!serviceIsEnabled(service)) {
      return false;
    }

    if (!serviceCanBeInferred(service)) {
      return false;
    }

    const duration = getServiceDuration(service);

    if (!duration || !anchorDuration) {
      return false;
    }

    if (serviceAllowsShorterDurationInference(anchorService)) {
      if (duration > anchorDuration) {
        return false;
      }
    } else if (duration !== anchorDuration) {
      return false;
    }

    const serviceType = normalizeServiceType(service.serviceType || "");

    if (!allowedTypes.has(serviceType)) {
      return false;
    }

    if (getServiceKey(service) === getServiceKey(anchorService)) {
      return false;
    }

    return true;
  });
}

function buildInferencePlan(scrapedService = {}, businessConfig = {}) {
  const anchorService = findMatchingBusinessService(scrapedService, businessConfig);

  if (!anchorService) {
    return {
      canInfer: false,
      reason: "No matching service found in businessConfig.services.",
      businessName: businessConfig.businessName || businessConfig.name || "",
      scrapedService,
      anchorService: null,
      inferServices: []
    };
  }

  if (!serviceIsEnabled(anchorService)) {
    return {
      canInfer: false,
      reason: "Matched service is disabled.",
      businessName: businessConfig.businessName || businessConfig.name || "",
      scrapedService,
      anchorService,
      inferServices: []
    };
  }

  if (!serviceIsInferenceAnchor(anchorService)) {
    return {
      canInfer: false,
      reason: "Matched service is not an inference anchor.",
      businessName: businessConfig.businessName || businessConfig.name || "",
      scrapedService,
      anchorService,
      inferServices: []
    };
  }

  const candidates = sortServicesForInference(
    getCandidateServices(anchorService, businessConfig)
  );

  return {
    canInfer: candidates.length > 0,
    reason:
      candidates.length > 0
        ? "Inference plan created."
        : "No enabled inferable services matched this anchor.",
    businessName: businessConfig.businessName || businessConfig.name || "",
    anchorService: {
      serviceName: anchorService.serviceName || "",
      serviceType: anchorService.serviceType || "",
      durationMinutes: getServiceDuration(anchorService),
      sessionTypeId: anchorService.sessionTypeId || null,
      platformServiceId: anchorService.platformServiceId || null,
      serviceId: anchorService.serviceId || null,
      inferStartIntervalMinutes: getInferStartIntervalMinutes(anchorService)
    },
    inferServices: candidates.map((service) => ({
      serviceName: service.serviceName || "",
      serviceType: service.serviceType || "",
      durationMinutes: getServiceDuration(service),
      sessionTypeId: service.sessionTypeId || null,
      platformServiceId: service.platformServiceId || null,
      serviceId: service.serviceId || null,
      price: service.price || null,
      source: "inference_plan"
    }))
  };
}

function getInferencePlan(scrapedService = {}, businessConfig = {}) {
  return buildInferencePlan(scrapedService, businessConfig);
}

module.exports = {
  getInferencePlan,
  buildInferencePlan,

  // Exported for testing/debugging.
  normalize,
  normalizeServiceType,
  getServiceDuration,
  findMatchingBusinessService,
  getCandidateServices
};