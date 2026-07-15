function normalize(value) {
  return String(value || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeServiceType(value) {
  return String(value || "").toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_").trim();
}

function getServiceDuration(service = {}) {
  const duration = Number(service.durationMinutes || service.duration || 0);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function getServiceId(service = {}) {
  return service.id || service.businessServiceId || service.business_service_id || null;
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
  const nested =
    service.searchInference && typeof service.searchInference === "object"
      ? service.searchInference
      : {};

  return {
    ...nested,
    enabled:
      nested.enabled !== undefined
        ? nested.enabled
        : service.inferenceEnabled === true,
    isInferenceAnchor:
      nested.isInferenceAnchor === true ||
      nested.inferenceRole === "anchor" ||
      service.inferenceRole === "anchor",
    canBeInferred:
      nested.canBeInferred === true ||
      nested.inferenceRole === "inferred" ||
      service.inferenceRole === "inferred",
    inferShorterDurations:
      nested.inferShorterDurations === true ||
      service.inferShorterDurations === true,
    inferServiceTypes: Array.isArray(nested.inferServiceTypes)
      ? nested.inferServiceTypes
      : Array.isArray(service.inferServiceTypes)
        ? service.inferServiceTypes
        : [],
    inferStartIntervalMinutes:
      nested.inferStartIntervalMinutes ||
      service.inferStartIntervalMinutes,
    confidence:
      nested.confidence ??
      service.inferenceConfidence,
    anchorServiceId:
      nested.anchorServiceId ||
      service.anchorServiceId ||
      service.anchor_service_id ||
      null,
    anchorServiceKey:
      nested.anchorServiceKey ||
      service.anchorServiceKey ||
      service.anchor_service_key ||
      null
  };
}

function serviceCanBeInferred(service = {}) {
  const inference = getSearchInference(service);
  return inference.enabled !== false && inference.canBeInferred === true;
}

function serviceIsInferenceAnchor(service = {}) {
  const inference = getSearchInference(service);
  return inference.enabled !== false && inference.isInferenceAnchor === true;
}

function serviceAllowsShorterDurationInference(service = {}) {
  return getSearchInference(service).inferShorterDurations === true;
}

function getInferServiceTypes(service = {}) {
  return getSearchInference(service).inferServiceTypes
    .map(normalizeServiceType)
    .filter(Boolean);
}

function getInferStartIntervalMinutes(service = {}, fallback = 15) {
  const value = Number(
    getSearchInference(service).inferStartIntervalMinutes ||
    service.bookingIntervalMinutes ||
    fallback
  );
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getInferenceConfidence(service = {}, fallback = 0.85) {
  const value = Number(
    getSearchInference(service).confidence ??
    service.inferenceConfidence ??
    fallback
  );
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback;
}

function servicesMatch(a = {}, b = {}) {
  const aId = getServiceId(a);
  const bId = getServiceId(b);
  if (aId && bId) return String(aId) === String(bId);

  const identifiers = [
    ["platformServiceId", "platformServiceId"],
    ["serviceButtonId", "serviceButtonId"],
    ["sessionTypeId", "sessionTypeId"],
    ["canonicalKey", "canonicalKey"],
    ["canonical_key", "canonical_key"],
    ["serviceId", "serviceId"]
  ];

  for (const [aKey, bKey] of identifiers) {
    const av = a[aKey];
    const bv = b[bKey];
    if (av && bv && String(av) === String(bv)) {
      const ad = getServiceDuration(a);
      const bd = getServiceDuration(b);
      return !ad || !bd || ad === bd;
    }
  }

  const aName = normalize(a.serviceName || a.name || "");
  const bName = normalize(b.serviceName || b.name || "");
  const aType = normalizeServiceType(a.serviceType || a.serviceCategory || "");
  const bType = normalizeServiceType(b.serviceType || b.serviceCategory || "");
  const aDuration = getServiceDuration(a);
  const bDuration = getServiceDuration(b);

  if (aName && bName && aName === bName && aDuration === bDuration) return true;
  return Boolean(aType && bType && aType === bType && aDuration === bDuration);
}

function findMatchingBusinessService(scrapedService = {}, businessConfig = {}) {
  const services = Array.isArray(businessConfig.services) ? businessConfig.services : [];
  return services.find((service) => servicesMatch(scrapedService, service)) || null;
}

function sortServicesForInference(services = []) {
  return [...services].sort((a, b) => {
    const durationDiff = (getServiceDuration(b) || 0) - (getServiceDuration(a) || 0);
    return durationDiff || String(a.serviceName || "").localeCompare(String(b.serviceName || ""));
  });
}

function getDefaultBusinessInferenceRules(businessConfig = {}) {
  const rules =
    businessConfig.inferenceRules &&
    typeof businessConfig.inferenceRules === "object"
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
  if (explicitTypes.length) return explicitTypes;

  const mapped =
    getDefaultBusinessInferenceRules(businessConfig).serviceMappings[anchorType];

  return Array.isArray(mapped)
    ? mapped.map(normalizeServiceType).filter(Boolean)
    : [];
}

function candidateTargetsAnchor(service = {}, anchorService = {}) {
  const inference = getSearchInference(service);
  const anchorId = getServiceId(anchorService);
  const anchorKey = getServiceKey(anchorService);

  if (
    inference.anchorServiceId &&
    anchorId &&
    String(inference.anchorServiceId) !== String(anchorId)
  ) {
    return false;
  }

  if (
    inference.anchorServiceKey &&
    String(inference.anchorServiceKey) !== String(anchorKey)
  ) {
    return false;
  }

  return true;
}

function getCandidateServices(anchorService = {}, businessConfig = {}) {
  const services = Array.isArray(businessConfig.services) ? businessConfig.services : [];
  const anchorDuration = getServiceDuration(anchorService);
  const anchorType = normalizeServiceType(anchorService.serviceType || "");
  const allowedTypes = new Set(
    [anchorType, ...getMappedServiceTypes(anchorService, businessConfig)].filter(Boolean)
  );
  const autoInferShorter = serviceAllowsShorterDurationInference(anchorService);

  return services.filter((service) => {
    if (!serviceIsEnabled(service)) return false;
    if (getServiceKey(service) === getServiceKey(anchorService)) return false;
    if (!candidateTargetsAnchor(service, anchorService)) return false;

    const duration = getServiceDuration(service);
    if (!duration || !anchorDuration) return false;

    const explicitlyInferable = serviceCanBeInferred(service);

    if (autoInferShorter) {
      if (duration >= anchorDuration) return false;
    } else {
      if (!explicitlyInferable || duration !== anchorDuration) return false;
    }

    const serviceType = normalizeServiceType(service.serviceType || "");
    return allowedTypes.has(serviceType);
  });
}

function buildInferencePlan(scrapedService = {}, businessConfig = {}) {
  const anchorService = findMatchingBusinessService(scrapedService, businessConfig);
  const businessName = businessConfig.businessName || businessConfig.name || "";

  if (!anchorService) {
    return {
      canInfer: false,
      reason: "No matching canonical service found.",
      businessName,
      scrapedService,
      anchorService: null,
      inferServices: []
    };
  }

  if (!serviceIsEnabled(anchorService)) {
    return {
      canInfer: false,
      reason: "Matched service is disabled.",
      businessName,
      scrapedService,
      anchorService,
      inferServices: []
    };
  }

  if (!serviceIsInferenceAnchor(anchorService)) {
    return {
      canInfer: false,
      reason: "Matched service is not an inference anchor.",
      businessName,
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
    reason: candidates.length
      ? "Inference plan created."
      : "No enabled inferable services matched this anchor.",
    businessName,
    anchorService: {
      id: getServiceId(anchorService),
      serviceName: anchorService.serviceName || "",
      serviceType: anchorService.serviceType || "",
      durationMinutes: getServiceDuration(anchorService),
      sessionTypeId: anchorService.sessionTypeId || null,
      platformServiceId: anchorService.platformServiceId || null,
      serviceId: anchorService.serviceId || null,
      inferStartIntervalMinutes: getInferStartIntervalMinutes(anchorService),
      inferenceConfidence: getInferenceConfidence(anchorService)
    },
    inferServices: candidates.map((service) => ({
      id: getServiceId(service),
      anchorServiceId:
        getSearchInference(service).anchorServiceId ||
        getServiceId(anchorService),
      anchorServiceKey:
        getSearchInference(service).anchorServiceKey ||
        getServiceKey(anchorService),
      serviceName: service.serviceName || "",
      serviceType: service.serviceType || "",
      durationMinutes: getServiceDuration(service),
      sessionTypeId: service.sessionTypeId || null,
      platformServiceId: service.platformServiceId || null,
      serviceId: service.serviceId || null,
      price: service.price || null,
      inferStartIntervalMinutes: getInferStartIntervalMinutes(
        service,
        getInferStartIntervalMinutes(anchorService)
      ),
      inferenceConfidence: getInferenceConfidence(
        service,
        getInferenceConfidence(anchorService)
      ),
      source: "inference_plan"
    }))
  };
}

module.exports = {
  getInferencePlan: buildInferencePlan,
  buildInferencePlan,
  normalize,
  normalizeServiceType,
  getServiceDuration,
  findMatchingBusinessService,
  getCandidateServices
};