[1mdiff --git a/adminRoutes.js b/adminRoutes.js[m
[1mindex 30b9ed7..f44d835 100644[m
[1m--- a/adminRoutes.js[m
[1m+++ b/adminRoutes.js[m
[36m@@ -97,6 +97,15 @@[m [mfunction normalizeAdminService(service = {}) {[m
     ["", "anchor", "inferred"],[m
     ""[m
   );[m
[32m+[m[32m  const rawAnchorServiceId = String(service.anchorServiceId || "").trim();[m
[32m+[m[32m  const anchorServiceId = /^\d+$/.test(rawAnchorServiceId)[m
[32m+[m[32m    ? Number(rawAnchorServiceId)[m
[32m+[m[32m    : null;[m
[32m+[m[32m  const anchorServiceKey =[m
[32m+[m[32m    cleanText(service.anchorServiceKey, 500) ||[m
[32m+[m[32m    (rawAnchorServiceId.startsWith("key:")[m
[32m+[m[32m      ? cleanText(rawAnchorServiceId.slice(4), 500)[m
[32m+[m[32m      : "");[m
 [m
   return {[m
     ...service,[m
[36m@@ -110,8 +119,8 @@[m [mfunction normalizeAdminService(service = {}) {[m
     inferenceEnabled:[m
       cleanBoolean(service.inferenceEnabled) || Boolean(inferenceRole),[m
     inferenceRole: inferenceRole || null,[m
[31m-    anchorServiceId: cleanNumberOrNull(service.anchorServiceId),[m
[31m-    anchorServiceKey: cleanText(service.anchorServiceKey, 500),[m
[32m+[m[32m    anchorServiceId,[m
[32m+[m[32m    anchorServiceKey,[m
     inferShorterDurations: cleanBoolean(service.inferShorterDurations),[m
     inferServiceTypes: cleanStringArray(service.inferServiceTypes),[m
     inferStartIntervalMinutes: cleanNumberOrNull(service.inferStartIntervalMinutes),[m
[1mdiff --git a/database/inventoryRepository.js b/database/inventoryRepository.js[m
[1mindex 1280227..80d43d2 100644[m
[1m--- a/database/inventoryRepository.js[m
[1m+++ b/database/inventoryRepository.js[m
[36m@@ -430,6 +430,10 @@[m [masync function insertInferredAppointment(payload = {}, client = db) {[m
       local_time: payload.localTime || payload.localTimeKey || null,[m
       timezone: payload.timezone || DEFAULT_TIMEZONE,[m
       source_type: "inferred",[m
[32m+[m[32m      inference_type:[m
[32m+[m[32m        payload.inferenceType ||[m
[32m+[m[32m        payload.inferenceMode ||[m
[32m+[m[32m        "service_anchor",[m
       confidence:[m
         payload.confidenceScore ??[m
         payload.inferenceConfidence ??[m
[1mdiff --git a/db/migrations/005_inference_pipeline_hardening.sql b/db/migrations/005_inference_pipeline_hardening.sql[m
[1mnew file mode 100644[m
[1mindex 0000000..4dc1332[m
[1m--- /dev/null[m
[1m+++ b/db/migrations/005_inference_pipeline_hardening.sql[m
[36m@@ -0,0 +1,85 @@[m
[32m+[m[32m-- NextAppt inference pipeline hardening[m
[32m+[m[32m-- Safe to run more than once.[m
[32m+[m
[32m+[m[32mALTER TABLE business_services[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS canonical_key TEXT,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS parent_service_text TEXT,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS session_type_id TEXT,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS scrape_directly BOOLEAN NOT NULL DEFAULT TRUE,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS inference_enabled BOOLEAN NOT NULL DEFAULT FALSE,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS inference_role TEXT,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS anchor_service_id BIGINT,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS anchor_service_key TEXT,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS infer_shorter_durations BOOLEAN NOT NULL DEFAULT FALSE,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS infer_service_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS infer_start_interval_minutes INTEGER,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS inference_confidence NUMERIC(4,3),[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS booking_interval_minutes INTEGER;[m
[32m+[m
[32m+[m[32mUPDATE business_services[m
[32m+[m[32mSET canonical_key = CONCAT([m
[32m+[m[32m  COALESCE([m
[32m+[m[32m    NULLIF(LOWER(platform_service_id), ''),[m
[32m+[m[32m    NULLIF(LOWER(service_id), ''),[m
[32m+[m[32m    ''[m
[32m+[m[32m  ),[m
[32m+[m[32m  '|',[m
[32m+[m[32m  LOWER(COALESCE(service_name, '')),[m
[32m+[m[32m  '|',[m
[32m+[m[32m  LOWER(COALESCE(service_type, '')),[m
[32m+[m[32m  '|',[m
[32m+[m[32m  COALESCE(duration_minutes::TEXT, ''),[m
[32m+[m[32m  '|',[m
[32m+[m[32m  id::TEXT[m
[32m+[m[32m)[m
[32m+[m[32mWHERE canonical_key IS NULL OR canonical_key = '';[m
[32m+[m
[32m+[m[32mCREATE UNIQUE INDEX IF NOT EXISTS idx_business_services_business_canonical[m
[32m+[m[32m  ON business_services(business_id, canonical_key);[m
[32m+[m
[32m+[m[32mALTER TABLE confirmed_appointments[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS business_service_id BIGINT,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS raw_json JSONB;[m
[32m+[m
[32m+[m[32mALTER TABLE inferred_appointments[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS business_service_id BIGINT,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS anchor_service_id BIGINT,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS local_date DATE,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS local_time TIME,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Chicago',[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'inferred',[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS raw_json JSONB;[m
[32m+[m
[32m+[m[32mALTER TABLE inferred_appointments[m
[32m+[m[32m  ALTER COLUMN inference_type SET DEFAULT 'service_anchor';[m
[32m+[m
[32m+[m[32mUPDATE inferred_appointments[m
[32m+[m[32mSET inference_type = 'service_anchor'[m
[32m+[m[32mWHERE inference_type IS NULL OR inference_type = '';[m
[32m+[m
[32m+[m[32mALTER TABLE appointment_inventory[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS business_service_id BIGINT,[m
[32m+[m[32m  ADD COLUMN IF NOT EXISTS anchor_service_id BIGINT;[m
[32m+[m
[32m+[m[32mCREATE INDEX IF NOT EXISTS idx_business_services_inference_anchor[m
[32m+[m[32m  ON business_services([m
[32m+[m[32m    business_id,[m
[32m+[m[32m    inference_role,[m
[32m+[m[32m    inference_enabled[m
[32m+[m[32m  )[m
[32m+[m[32m  WHERE enabled IS NOT FALSE;[m
[32m+[m
[32m+[m[32mCREATE INDEX IF NOT EXISTS idx_inventory_anchor_service[m
[32m+[m[32m  ON appointment_inventory([m
[32m+[m[32m    anchor_service_id,[m
[32m+[m[32m    local_date,[m
[32m+[m[32m    local_time[m
[32m+[m[32m  );[m
[32m+[m
[32m+[m[32mCREATE INDEX IF NOT EXISTS idx_inventory_business_service[m
[32m+[m[32m  ON appointment_inventory([m
[32m+[m[32m    business_service_id,[m
[32m+[m[32m    local_date,[m
[32m+[m[32m    local_time[m
[32m+[m[32m  );[m
[32m+[m[41m  [m
[1mdiff --git a/jobBuilder.js b/jobBuilder.js[m
[1mindex a18ece7..f5c642b 100644[m
[1m--- a/jobBuilder.js[m
[1m+++ b/jobBuilder.js[m
[36m@@ -892,6 +892,64 @@[m [mfunction serviceIsInferenceAnchor(service = {}) {[m
   );[m
 }[m
 [m
[32m+[m[32mfunction serviceIsInferredTarget(service = {}) {[m
[32m+[m[32m  const searchInference = service.searchInference || service.inference || {};[m
[32m+[m
[32m+[m[32m  return Boolean([m
[32m+[m[32m    service.inferredFromAnchor === true ||[m
[32m+[m[32m      service.inferenceRole === "inferred" ||[m
[32m+[m[32m      searchInference.role === "inferred" ||[m
[32m+[m[32m      searchInference.inferenceRole === "inferred" ||[m
[32m+[m[32m      searchInference.canBeInferred === true[m
[32m+[m[32m  );[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32mfunction shouldScrapeServiceDirectly(service = {}, filters = {}) {[m
[32m+[m[32m  const forceDirectScrape =[m
[32m+[m[32m    filters.forceDirectScrape === true ||[m
[32m+[m[32m    filters.forceDirectScrape === "true";[m
[32m+[m
[32m+[m[32m  if (forceDirectScrape) {[m
[32m+[m[32m    return true;[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  if (serviceIsInferredTarget(service)) {[m
[32m+[m[32m    return false;[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  return service.scrapeDirectly !== false;[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32mfunction sortServicesForScraping(services = []) {[m
[32m+[m[32m  return [...services].sort((a, b) => {[m
[32m+[m[32m    const anchorDifference =[m
[32m+[m[32m      Number(serviceIsInferenceAnchor(b)) -[m
[32m+[m[32m      Number(serviceIsInferenceAnchor(a));[m
[32m+[m
[32m+[m[32m    if (anchorDifference) {[m
[32m+[m[32m      return anchorDifference;[m
[32m+[m[32m    }[m
[32m+[m
[32m+[m[32m    const priorityRank = {[m
[32m+[m[32m      high: 0,[m
[32m+[m[32m      medium: 1,[m
[32m+[m[32m      normal: 2,[m
[32m+[m[32m      low: 3[m
[32m+[m[32m    };[m
[32m+[m
[32m+[m[32m    const aPriority = priorityRank[normalize(a.priority)] ?? 4;[m
[32m+[m[32m    const bPriority = priorityRank[normalize(b.priority)] ?? 4;[m
[32m+[m
[32m+[m[32m    if (aPriority !== bPriority) {[m
[32m+[m[32m      return aPriority - bPriority;[m
[32m+[m[32m    }[m
[32m+[m
[32m+[m[32m    return String(a.serviceName || "").localeCompare([m
[32m+[m[32m      String(b.serviceName || "")[m
[32m+[m[32m    );[m
[32m+[m[32m  });[m
[32m+[m[32m}[m
[32m+[m
 function businessHasInferenceAnchors(services = []) {[m
   return services.some(serviceIsInferenceAnchor);[m
 }[m
[36m@@ -975,9 +1033,11 @@[m [mfunction buildScrapeJobs(businesses, filters = {}) {[m
       continue;[m
     }[m
 [m
[31m-    const services = filterServicesForInferenceAnchors([m
[31m-      getEnabledServicesForBusiness(business),[m
[31m-      filters[m
[32m+[m[32m    const services = sortServicesForScraping([m
[32m+[m[32m      filterServicesForInferenceAnchors([m
[32m+[m[32m        getEnabledServicesForBusiness(business),[m
[32m+[m[32m        filters[m
[32m+[m[32m      ).filter((service) => shouldScrapeServiceDirectly(service, filters))[m
     );[m
 [m
     for (const service of services) {[m
[36m@@ -1093,6 +1153,9 @@[m [mmodule.exports = {[m
   businessMatchesExactNameOrAlias,[m
   businessPassesBusinessFilter,[m
   serviceIsInferenceAnchor,[m
[32m+[m[32m  serviceIsInferredTarget,[m
[32m+[m[32m  shouldScrapeServiceDirectly,[m
[32m+[m[32m  sortServicesForScraping,[m
   filterServicesForInferenceAnchors,[m
   getScrapeMode,[m
   getResolvedDaysForward,[m
[1mdiff --git a/scrape.js b/scrape.js[m
[1mindex 81e6f1e..c3cf256 100644[m
[1m--- a/scrape.js[m
[1m+++ b/scrape.js[m
[36m@@ -1055,11 +1055,72 @@[m [mresult.businessServiceId = resolveBusinessServiceId([m
 const confirmedAppointments = resultTimesToAppointments(result);[m
 [m
 function toDateKey(displayDate) {[m
[32m+[m[32m  const directMatch = String(displayDate || "").match(/^(\d{4}-\d{2}-\d{2})/);[m
[32m+[m[32m  if (directMatch) return directMatch[1];[m
[32m+[m
   const parsed = new Date(displayDate);[m
   if (Number.isNaN(parsed.getTime())) return "";[m
   return parsed.toISOString().slice(0, 10);[m
 }[m
 [m
[32m+[m[32mfunction getAppointmentLocalDateKey(appointment = {}, fallback = "") {[m
[32m+[m[32m  const candidates = [[m
[32m+[m[32m    appointment.localDateKey,[m
[32m+[m[32m    appointment.dateKey,[m
[32m+[m[32m    appointment.appointmentDate,[m
[32m+[m[32m    appointment.date,[m
[32m+[m[32m    appointment.startTime,[m
[32m+[m[32m    appointment.startDateTime,[m
[32m+[m[32m    appointment.appointmentStart,[m
[32m+[m[32m    appointment.rawDate,[m
[32m+[m[32m    fallback[m
[32m+[m[32m  ];[m
[32m+[m
[32m+[m[32m  for (const candidate of candidates) {[m
[32m+[m[32m    const dateKey = toDateKey(candidate);[m
[32m+[m[32m    if (dateKey) return dateKey;[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  return "";[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32mfunction getAppointmentLocalTimeKey(appointment = {}) {[m
[32m+[m[32m  const candidates = [[m
[32m+[m[32m    appointment.localTimeKey,[m
[32m+[m[32m    appointment.timeKey,[m
[32m+[m[32m    appointment.appointmentTime,[m
[32m+[m[32m    appointment.time,[m
[32m+[m[32m    appointment.startTime,[m
[32m+[m[32m    appointment.startDateTime,[m
[32m+[m[32m    appointment.appointmentStart,[m
[32m+[m[32m    appointment.rawTime[m
[32m+[m[32m  ];[m
[32m+[m
[32m+[m[32m  for (const candidate of candidates) {[m
[32m+[m[32m    const raw = String(candidate || "").trim();[m
[32m+[m[32m    if (!raw) continue;[m
[32m+[m
[32m+[m[32m    const isoMatch = raw.match(/T(\d{1,2}):(\d{2})/);[m
[32m+[m[32m    if (isoMatch) {[m
[32m+[m[32m      return `${String(isoMatch[1]).padStart(2, "0")}:${isoMatch[2]}`;[m
[32m+[m[32m    }[m
[32m+[m
[32m+[m[32m    const displayMatch = raw.match(/(?:^|\s)(\d{1,2}):(\d{2})\s*(AM|PM)?/i);[m
[32m+[m[32m    if (!displayMatch) continue;[m
[32m+[m
[32m+[m[32m    let hour = Number(displayMatch[1]);[m
[32m+[m[32m    const minute = displayMatch[2];[m
[32m+[m[32m    const ampm = String(displayMatch[3] || "").toUpperCase();[m
[32m+[m
[32m+[m[32m    if (ampm === "PM" && hour !== 12) hour += 12;[m
[32m+[m[32m    if (ampm === "AM" && hour === 12) hour = 0;[m
[32m+[m
[32m+[m[32m    return `${String(hour).padStart(2, "0")}:${minute}`;[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  return "";[m
[32m+[m[32m}[m
[32m+[m
 function resultTimesToAppointments(result = {}) {[m
   const localDateKey =[m
     result.localDateKey ||[m
[36m@@ -1149,7 +1210,8 @@[m [mfunction resultTimesToAppointments(result = {}) {[m
         businessServiceId[m
       ),[m
       sourceType: appointment.sourceType || "confirmed",[m
[31m-      localDateKey: appointment.localDateKey || localDateKey[m
[32m+[m[32m      localDateKey: getAppointmentLocalDateKey(appointment, localDateKey),[m
[32m+[m[32m      localTimeKey: getAppointmentLocalTimeKey(appointment)[m
     }));[m
   }[m
 [m
[36m@@ -1172,7 +1234,17 @@[m [mfunction resultTimesToAppointments(result = {}) {[m
     therapistName: result.provider || result.providerText || "",[m
     provider: result.provider || result.providerText || "",[m
 [m
[31m-    localDateKey,[m
[32m+[m[32m    localDateKey: getAppointmentLocalDateKey([m
[32m+[m[32m      {[m
[32m+[m[32m        time,[m
[32m+[m[32m        startTime: time[m
[32m+[m[32m      },[m
[32m+[m[32m      localDateKey[m
[32m+[m[32m    ),[m
[32m+[m[32m    localTimeKey: getAppointmentLocalTimeKey({[m
[32m+[m[32m      time,[m
[32m+[m[32m      startTime: time[m
[32m+[m[32m    }),[m
 [m
     time,[m
     rawTime: time,[m
[1mdiff --git a/server.js b/server.js[m
[1mindex 6e906b2..862a607 100644[m
[1m--- a/server.js[m
[1m+++ b/server.js[m
[36m@@ -38,9 +38,6 @@[m [mconst {[m
 const {[m
   getBusinessPageDataAsync[m
 } = require("./businessManager");[m
[31m-const {[m
[31m-  mergeConfirmedAndInferredAppointments[m
[31m-} = require("./availabilityInferenceEngine");[m
 const app = express();[m
 const PORT = 3000;[m
 const APPOINTMENT_TIME_ZONE = "America/Chicago";[m
[36m@@ -228,49 +225,16 @@[m [mfunction getBusinessConfigByName(businessName) {[m
 }[m
 [m
 function applyInferenceToAppointments(appointments = [], options = {}) {[m
[31m-  if (options.includeInferred !== true) {[m
[31m-    return appointments;[m
[31m-  }[m
[31m-[m
[31m-  if (!Array.isArray(appointments) || appointments.length === 0) {[m
[31m-    return appointments;[m
[31m-  }[m
[31m-[m
[31m-  const grouped = new Map();[m
[31m-[m
[31m-  appointments.forEach((appointment) => {[m
[31m-    const businessName = appointment.businessName || "";[m
[31m-[m
[31m-    if (!businessName) {[m
[31m-      return;[m
[31m-    }[m
[31m-[m
[31m-    if (!grouped.has(businessName)) {[m
[31m-      grouped.set(businessName, []);[m
[31m-    }[m
[31m-[m
[31m-    grouped.get(businessName).push(appointment);[m
[31m-  });[m
[31m-[m
[31m-  const expanded = [];[m
[31m-[m
[31m-  grouped.forEach((businessAppointments, businessName) => {[m
[31m-    const businessConfig = getBusinessConfigByName(businessName);[m
[32m+[m[32m  const inventory = Array.isArray(appointments) ? appointments : [];[m
 [m
[31m-    if (!businessConfig) {[m
[31m-      expanded.push(...businessAppointments);[m
[31m-      return;[m
[31m-    }[m
[31m-[m
[31m-    expanded.push([m
[31m-      ...mergeConfirmedAndInferredAppointments([m
[31m-        businessAppointments,[m
[31m-        businessConfig[m
[31m-      )[m
[32m+[m[32m  if (options.includeInferred === false) {[m
[32m+[m[32m    return inventory.filter([m
[32m+[m[32m      (appointment) =>[m
[32m+[m[32m        String(appointment.sourceType || "").toLowerCase() !== "inferred"[m
     );[m
[31m-  });[m
[32m+[m[32m  }[m
 [m
[31m-  return dedupeAppointments(expanded);[m
[32m+[m[32m  return inventory;[m
 }[m
 [m
 function mergeBusinessesForNormalization(primaryBusinesses, cacheBusinesses) {[m
[36m@@ -1524,6 +1488,9 @@[m [mfunction dedupeAppointmentsByStrictTimeKey(appointments = []) {[m
     const key = [[m
       appointment.businessName || "",[m
       appointment.therapistName || "",[m
[32m+[m[32m      appointment.serviceName || appointment.service || "",[m
[32m+[m[32m      appointment.serviceCategory || appointment.serviceType || "",[m
[32m+[m[32m      appointment.durationMinutes || "",[m
       appointment.startTime || "",[m
       appointment.rawTime || "",[m
       appointment.time || ""[m
[36m@@ -1788,7 +1755,9 @@[m [mfunction getInventoryFiltersForSearch(query = {}, intent = {}) {[m
     hours: query.hours || intent.hours || "",[m
     limit: query.limit || 5000,[m
     limitPerBusiness: query.limitPerBusiness || 999,[m
[31m-    includeInactive: true[m
[32m+[m[32m    includeInactive: true,[m
[32m+[m[32m    includeInferred: query.includeInferred !== "false",[m
[32m+[m[32m    includeConfirmed: query.includeConfirmed !== "false"[m
   };[m
 }[m
 [m
[36m@@ -2094,7 +2063,7 @@[m [mapp.get("/api/search", async (req, res) => {[m
       });[m
     }[m
 [m
[31m-const includeInferred = req.query.includeInferred === "true";[m
[32m+[m[32mconst includeInferred = req.query.includeInferred !== "false";[m
 [m
 const responseAppointments = applyInferenceToAppointments(appointments, {[m
   includeInferred[m
