const { getInferencePlan } = require("./availabilityInferencePlanner");

const {
  buildAvailabilityWindowsFromAppointments
} = require("./availabilityWindowUtils");

const {
  generateSlotsFromWindows
} = require("./availabilityWindowSlotGenerator");

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

function getAppointmentServiceType(appointment = {}) {
  return normalizeServiceType(
    appointment.serviceType ||
      appointment.serviceCategory ||
      appointment.service ||
      appointment.serviceName ||
      ""
  );
}

function getAppointmentDuration(appointment = {}) {
  const duration = Number(
    appointment.durationMinutes ||
      appointment.duration ||
      0
  );

  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function getAppointmentTimeKey(appointment = {}) {
  if (appointment.localTimeKey) return appointment.localTimeKey;

  const raw =
    appointment.time ||
    appointment.displayTime ||
    appointment.rawTime ||
    appointment.startTime ||
    "";

  const normalMatch = String(raw).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);

  if (normalMatch) {
    let hour = Number(normalMatch[1]);
    const minute = Number(normalMatch[2]);
    const ampm = normalMatch[3].toUpperCase();

    if (ampm === "PM" && hour !== 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const isoMatch = String(raw).match(/T(\d{1,2}):(\d{2})/);

  if (isoMatch) {
    return `${String(isoMatch[1]).padStart(2, "0")}:${String(
      isoMatch[2]
    ).padStart(2, "0")}`;
  }

  return "";
}

function getAppointmentDateKey(appointment = {}) {
  return (
    appointment.localDateKey ||
    appointment.dateKey ||
    appointment.appointmentDate ||
    appointment.date ||
    ""
  );
}

function serviceMatchesAppointment(service = {}, appointment = {}) {
  const serviceType = normalizeServiceType(service.serviceType || "");
  const appointmentType = getAppointmentServiceType(appointment);

  const serviceDuration = Number(service.durationMinutes || 0);
  const appointmentDuration = getAppointmentDuration(appointment);

  return Boolean(
    serviceType &&
      appointmentType &&
      serviceType === appointmentType &&
      serviceDuration === appointmentDuration
  );
}

function makeInferenceKey(appointment = {}) {
  const timeKey =
    appointment.localTimeKey ||
    getAppointmentTimeKey(appointment) ||
    appointment.rawTime ||
    appointment.time ||
    "";

  const dateKey =
    appointment.localDateKey ||
    getAppointmentDateKey(appointment) ||
    "";

  return [
    normalize(appointment.businessName),
    normalize(appointment.therapistName || appointment.providerKey || appointment.provider || ""),
    normalize(appointment.serviceName),
    normalizeServiceType(appointment.serviceType || appointment.serviceCategory),
    appointment.durationMinutes || "",
    dateKey,
    timeKey
  ].join("|");
}

function buildFallbackInferencePlan(anchorAppointment = {}, businessConfig = {}) {
  const services = Array.isArray(businessConfig.services)
    ? businessConfig.services
    : [];

  const anchorServiceType = getAppointmentServiceType(anchorAppointment);
  const anchorDuration = getAppointmentDuration(anchorAppointment);

  const anchorService = services.find((service) => {
    return (
      normalizeServiceType(service.serviceType) === anchorServiceType &&
      Number(service.durationMinutes) === Number(anchorDuration)
    );
  });

  if (!anchorService) {
    return {
      canInfer: false,
      anchorService: null,
      inferServices: []
    };
  }

  const anchorAllowsInference =
    anchorService.canInfer === true ||
    anchorService.inferenceRole === "anchor" ||
    anchorService.inference?.role === "anchor";

  if (!anchorAllowsInference) {
    return {
      canInfer: false,
      anchorService,
      inferServices: []
    };
  }

  const inferServices = services.filter((service) => {
    if (service === anchorService) return false;
    if (service.enabled === false) return false;

    const sameServiceType =
      normalizeServiceType(service.serviceType) === anchorServiceType;

    const shorterOrEqualDuration =
      Number(service.durationMinutes || 0) <= Number(anchorDuration);

    return (
      sameServiceType &&
      shorterOrEqualDuration &&
      (
        service.inferredFromAnchor === true ||
        service.inferenceRole === "inferred" ||
        service.inference?.role === "inferred" ||
        anchorService.inferShorterDurations === true ||
        anchorService.inference?.inferShorterDurations === true
      )
    );
  });

  return {
    canInfer: inferServices.length > 0,
    anchorService,
    inferServices
  };
}

function getResolvedInferencePlan(anchorAppointment = {}, businessConfig = {}) {
  const plannerPlan = getInferencePlan(
    {
      serviceType: getAppointmentServiceType(anchorAppointment),
      durationMinutes: getAppointmentDuration(anchorAppointment),
      serviceName: anchorAppointment.serviceName || anchorAppointment.service || ""
    },
    businessConfig
  );

  if (plannerPlan?.canInfer) {
    return plannerPlan;
  }

  return buildFallbackInferencePlan(anchorAppointment, businessConfig);
}

function getConfidenceForWindow(window = {}, options = {}) {
  if (typeof options.confidenceScore === "number") {
    return options.confidenceScore;
  }

  const sourceCount = Array.isArray(window.sourceAppointments)
    ? window.sourceAppointments.length
    : 0;

  if (sourceCount >= 2) return 0.9;
  return 0.85;
}

function inferAppointmentsFromWindow(window = {}, businessConfig = {}, options = {}) {
  const includeAnchorDuplicate = options.includeAnchorDuplicate === true;

  const sourceAppointments = Array.isArray(window.sourceAppointments)
    ? window.sourceAppointments
    : [];

  if (!sourceAppointments.length) {
    return [];
  }

  const anchorAppointment = sourceAppointments[0];

  const anchorServiceType = getAppointmentServiceType(anchorAppointment);
  const anchorDuration = getAppointmentDuration(anchorAppointment);

  if (!anchorServiceType || !anchorDuration) {
    return [];
  }

  const plan = getResolvedInferencePlan(anchorAppointment, businessConfig);

  if (!plan.canInfer) {
    return [];
  }

  const inferred = [];

  for (const service of plan.inferServices || []) {
    const inferredDuration = Number(service.durationMinutes || 0);

if (!inferredDuration) {
  continue;
}

if (
  normalizeServiceType(service.serviceType) === anchorServiceType &&
  Number(inferredDuration) === Number(anchorDuration)
) {
  continue;
}

    const slots = generateSlotsFromWindows([window], {
      durationMinutes: inferredDuration,
      stepMinutes:
        plan.anchorService?.inferStartIntervalMinutes ||
        service.inferStartIntervalMinutes ||
        options.stepMinutes ||
        15,

      confidenceScore: getConfidenceForWindow(window, options),
      inferenceMode: options.inferenceMode || "window_based",

      serviceTemplate: {
        ...anchorAppointment,

        serviceName: service.serviceName,
        service: service.serviceName,
        serviceType: service.serviceType,
        serviceCategory: service.serviceType,
        durationMinutes: inferredDuration,

        sessionTypeId: service.sessionTypeId || null,
        platformServiceId: service.platformServiceId || null,
        serviceId: service.serviceId || null,
        price: service.price || anchorAppointment.price || null
      }
    });

    for (const slot of slots) {
      const matchesExistingAnchor = sourceAppointments.some((sourceAppointment) => {
        return (
          !includeAnchorDuplicate &&
          serviceMatchesAppointment(service, sourceAppointment) &&
          slot.localDateKey === getAppointmentDateKey(sourceAppointment) &&
          slot.localTimeKey === getAppointmentTimeKey(sourceAppointment)
        );
      });

      if (matchesExistingAnchor) {
        continue;
      }

      inferred.push({
        ...slot,

        sourceType: "inferred",
        confidence: slot.confidence || "medium_high",
        confidenceScore: slot.confidenceScore,
        inferenceConfidence: slot.confidenceScore,

        inferredFrom: {
          businessName:
            anchorAppointment.businessName ||
            businessConfig.businessName ||
            "",
          serviceName:
            anchorAppointment.serviceName ||
            anchorAppointment.service ||
            "",
          serviceType: anchorServiceType,
          durationMinutes: anchorDuration,
          localDateKey: getAppointmentDateKey(anchorAppointment),
          localTimeKey: getAppointmentTimeKey(anchorAppointment),
          startTime: anchorAppointment.startTime || "",
          sourceType: anchorAppointment.sourceType || "scraped",
          sourceAppointmentCount: sourceAppointments.length
        },

        inferenceWindow: {
          ...(slot.inferenceWindow || {}),
          sourceAppointmentCount: sourceAppointments.length
        },

        inferenceAnchorDurationMinutes: anchorDuration,
        inferenceGeneratedAt: new Date().toISOString()
      });
    }
  }

  return inferred;
}

function inferAppointmentsFromConfirmedAppointment(
  appointment = {},
  businessConfig = {},
  options = {}
) {
  const windows = buildAvailabilityWindowsFromAppointments([appointment]);

  return windows.flatMap((window) =>
    inferAppointmentsFromWindow(window, businessConfig, options)
  );
}

function inferAppointmentsFromResults(appointments = [], businessConfig = {}, options = {}) {
  if (!Array.isArray(appointments) || appointments.length === 0) {
    return [];
  }

  const windows = buildAvailabilityWindowsFromAppointments(appointments);

  const inferred = windows.flatMap((window) =>
    inferAppointmentsFromWindow(window, businessConfig, options)
  );

  const seen = new Set();

  return inferred.filter((item) => {
    const key = makeInferenceKey(item);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function mergeConfirmedAndInferredAppointments(
  appointments = [],
  businessConfig = {},
  options = {}
) {
  const confirmed = Array.isArray(appointments) ? appointments : [];
  const inferred = inferAppointmentsFromResults(confirmed, businessConfig, options);

  const seen = new Set();
  const merged = [];

  [...confirmed, ...inferred].forEach((appointment) => {
    const key = makeInferenceKey(appointment);

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(appointment);
  });

  return merged;
}

module.exports = {
  inferAppointmentsFromConfirmedAppointment,
  inferAppointmentsFromResults,
  mergeConfirmedAndInferredAppointments
};