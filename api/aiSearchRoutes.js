const express = require("express");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const businessManager = require("../businessManager");
const serviceCategoryRepository = require(
  "../database/serviceCategoryRepository"
);

const router = express.Router();
const TIME_ZONE = "America/Chicago";
const MAX_RETURNED_APPOINTMENTS = 30;
const MAX_RELEVANT_BUSINESSES = 6;

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function readJson(relativePath, fallback) {
  const filePath = path.join(__dirname, "..", relativePath);
  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`[AI SEARCH] Failed to read ${relativePath}:`, error.message);
    return fallback;
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s:+&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value) {
  return normalize(value).replace(/\s+/g, "");
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toServiceCategory(value = "") {
  return String(value || "").toLowerCase().replace(/-/g, "_").trim();
}

function getTodayParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const map = {};
  parts.forEach((part) => {
    if (part.type !== "literal") map[part.type] = part.value;
  });

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day)
  };
}

function getTodayDateKey() {
  const now = getTodayParts();
  return `${now.year}-${pad2(now.month)}-${pad2(now.day)}`;
}

function addDaysToDateKey(dateKey, daysToAdd) {
  const [year, month, day] = String(dateKey || getTodayDateKey())
    .split("-")
    .map(Number);

  const date = new Date(year, month - 1, day + Number(daysToAdd || 0), 12, 0, 0);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseLooseTimeToKey(rawHour, rawMinute = "0", rawAmPm = "") {
  let hour = Number(rawHour);
  const minute = Number(rawMinute || 0);
  const ampm = String(rawAmPm || "").toLowerCase();

  if (ampm === "pm" && hour !== 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return "";
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return "";

  return `${pad2(hour)}:${pad2(minute)}`;
}

function inferDurationFromQuery(query = "") {
  const text = normalize(query);

  const match = text.match(/\b(30|45|50|60|75|80|90|110|120)\s*(minute|min|minutes|mins)?\b/);
  if (match) return String(Number(match[1]));

  if (/\b(one|1)\s*(hour|hr)\b/.test(text)) return "60";
  if (/\b(two|2)\s*(hour|hr)\b/.test(text)) return "120";

  return "";
}

function inferDirectServiceFromQuery(query = "") {
  const text = normalize(query);

  if (text.includes("deep tissue") || text.includes("deep pressure") || text.includes("deep massage")) return "deep_tissue";
  if (text.includes("sports massage") || text.includes("sports recovery") || text.includes("athletic recovery")) return "sports";
  if (text.includes("prenatal") || text.includes("pregnancy") || text.includes("pregnant")) return "prenatal";
  if (text.includes("ashiatsu")) return "ashiatsu";
  if (text.includes("trigger point")) return "trigger_point";
  if (text.includes("myofascial")) return "myofascial_release";
  if (text.includes("lomi")) return "lomi_lomi";
  if (text.includes("swedish") || text.includes("relaxing") || text.includes("relaxation")) return "swedish";
  if (text.includes("massage")) return "massage";
  if (text.includes("sauna")) return "infrared_sauna";
  if (text.includes("facial")) return "facial";
  if (text.includes("chiropractor") || text.includes("chiropractic")) return "chiropractic";
  if (text.includes("acupuncture") || text.includes("acupuncturist")) return "acupuncture";

  return "";
}

function inferAmenityFromQuery(query = "") {
  const text = normalize(query);

  if (text.includes("infrared sauna") || text.includes("sauna")) return "infrared sauna";
  if (text.includes("cold plunge")) return "cold plunge";
  if (text.includes("red light")) return "red light therapy";
  if (text.includes("compression")) return "compression therapy";
  if (text.includes("cupping")) return "cupping";

  return "";
}

function inferTimeWindowFromQuery(query = "") {
  const text = normalize(query);

  if (text.includes("today") || text.includes("tonight") || text.includes("asap") || text.includes("right now")) {
    return { hours: "24", timeWindow: "today" };
  }

  if (text.includes("tomorrow")) return { hours: "72", timeWindow: "tomorrow" };
  if (text.includes("weekend")) return { hours: "168", timeWindow: "weekend" };

  return { hours: "72", timeWindow: "next_available" };
}

function inferDateTimeFilters(query = "") {
  const text = normalize(query);
  const today = getTodayDateKey();

  let targetLocalDateKey = "";
  let startTimeKey = "";
  let endTimeKey = "";

  if (text.includes("tomorrow")) targetLocalDateKey = addDaysToDateKey(today, 1);
  else if (text.includes("today") || text.includes("tonight")) targetLocalDateKey = today;

  if (text.includes("morning")) {
    startTimeKey = "05:00";
    endTimeKey = "11:59";
  }

  if (text.includes("afternoon")) {
    startTimeKey = "12:00";
    endTimeKey = "16:59";
  }

  if (text.includes("evening") || text.includes("tonight")) {
    startTimeKey = "17:00";
    endTimeKey = "23:59";
  }

  const betweenMatch = text.match(/\bbetween\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(and|to|-)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (betweenMatch) {
    const startAmPm = betweenMatch[3] || betweenMatch[7] || "";
    const endAmPm = betweenMatch[7] || betweenMatch[3] || "";
    startTimeKey = parseLooseTimeToKey(betweenMatch[1], betweenMatch[2] || "0", startAmPm);
    endTimeKey = parseLooseTimeToKey(betweenMatch[5], betweenMatch[6] || "0", endAmPm);
  }

  const afterMatch = text.match(/\bafter\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (afterMatch) {
    startTimeKey = parseLooseTimeToKey(afterMatch[1], afterMatch[2] || "0", afterMatch[3]);
  }

  const beforeMatch = text.match(/\bbefore\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (beforeMatch) {
    endTimeKey = parseLooseTimeToKey(beforeMatch[1], beforeMatch[2] || "0", beforeMatch[3]);
  }

  const exactTimeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (exactTimeMatch && !afterMatch && !beforeMatch && !betweenMatch) {
    const timeKey = parseLooseTimeToKey(exactTimeMatch[1], exactTimeMatch[2] || "0", exactTimeMatch[3]);
    const [hour] = timeKey.split(":").map(Number);
    if (Number.isFinite(hour)) {
      startTimeKey = `${pad2(hour)}:00`;
      endTimeKey = `${pad2(hour)}:59`;
    }
  }

  return { targetLocalDateKey, startTimeKey, endTimeKey };
}

function getAppointmentTimeKey(appointment = {}) {
  if (appointment.localTimeKey) return appointment.localTimeKey;

  const raw = appointment.time || appointment.rawTime || appointment.startTime || appointment.dateTime || "";
  const normalMatch = String(raw).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (normalMatch) return parseLooseTimeToKey(normalMatch[1], normalMatch[2], normalMatch[3]);

  const isoMatch = String(raw).match(/T(\d{1,2}):(\d{2})/);
  if (isoMatch) return `${pad2(isoMatch[1])}:${pad2(isoMatch[2])}`;

  return "";
}

function appointmentMatchesDateTimeFilters(appointment = {}, filters = {}) {
  if (filters.targetLocalDateKey && appointment.localDateKey !== filters.targetLocalDateKey) return false;

  const timeKey = getAppointmentTimeKey(appointment);
  if (filters.startTimeKey && (!timeKey || timeKey < filters.startTimeKey)) return false;
  if (filters.endTimeKey && (!timeKey || timeKey > filters.endTimeKey)) return false;

  return true;
}

function filterAppointmentsByDateTime(appointments = [], query = "") {
  const filters = inferDateTimeFilters(query);

  if (!filters.targetLocalDateKey && !filters.startTimeKey && !filters.endTimeKey) {
    return appointments;
  }

  return appointments.filter((appointment) => appointmentMatchesDateTimeFilters(appointment, filters));
}

function queryHasAppointmentIntent(query = "") {
  const text = normalize(query);

  const appointmentSignals = [
    "appointment",
    "appointments",
    "available",
    "availability",
    "opening",
    "openings",
    "book",
    "booking",
    "schedule",
    "next available",
    "soonest",
    "asap",
    "right now",
    "near me",
    "nearby",
    "today",
    "tomorrow",
    "tonight"
  ];

  if (appointmentSignals.some((signal) => text.includes(signal))) return true;

  const service = inferDirectServiceFromQuery(text);
  const duration = inferDurationFromQuery(text);
  const dateTimeFilters = inferDateTimeFilters(text);

  return Boolean(service && (duration || dateTimeFilters.startTimeKey || dateTimeFilters.endTimeKey || dateTimeFilters.targetLocalDateKey));
}

function queryHasInfoIntent(query = "") {
  const text = normalize(query);

  const infoSignals = [
    "what is",
    "what are",
    "explain",
    "describe",
    "tell me about",
    "information about",
    "learn about",
    "who is",
    "what does",
    "how does",
    "difference between",
    "reviews",
    "review",
    "specialties",
    "specialty",
    "best for",
    "good for",
    "which business",
    "which one",
    "do they",
    "does it",
    "do any",
    "is there",
    "are there"
  ];

  return infoSignals.some((signal) => text.includes(signal));
}

function queryLooksLikeFollowUp(query = "", conversationState = {}) {
  const text = normalize(query);
  const previousQuery = String(conversationState.lastResolvedQuery || conversationState.lastQuery || "").trim();
  if (!previousQuery) return false;

  const followUpSignals = [
    "these",
    "those",
    "places",
    "that",
    "them",
    "there",
    "any of these",
    "what about",
    "instead",
    "only",
    "just",
    "tomorrow",
    "today",
    "tonight",
    "morning",
    "afternoon",
    "evening",
    "after",
    "before",
    "between",
    "south",
    "north",
    "east",
    "west",
    "closer"
  ];

  const hasExactTime = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/.test(text);
  const hasDuration = Boolean(inferDurationFromQuery(text));
  const hasSignal = followUpSignals.some((signal) => text.includes(signal));

  return hasExactTime || hasDuration || hasSignal;
}

function previousPromptWasAppointmentSearch(conversationState = {}) {
  return ["appointment_search", "appointment_search_followup"].includes(String(conversationState.lastPromptMode || ""));
}

function classifyAiPrompt(query = "", conversationState = {}) {
  const isAppointment = queryHasAppointmentIntent(query);
  const isInfo = queryHasInfoIntent(query);
  const isFollowUp = previousPromptWasAppointmentSearch(conversationState) && queryLooksLikeFollowUp(query, conversationState);

  if (isAppointment) {
    if (isFollowUp && !inferDirectServiceFromQuery(query)) return "appointment_search_followup";
    return "appointment_search";
  }

  if (isInfo) return "business_info";
  if (isFollowUp && !isInfo) return "appointment_search_followup";

  return "general_info";
}

function shouldFetchAppointmentsForPromptMode(promptMode = "") {
  return ["appointment_search", "appointment_search_followup"].includes(promptMode);
}

function mergeQueryWithConversation(query = "", conversationState = {}) {
  const cleanQuery = String(query || "").trim();
  const previousQuery = String(conversationState.lastResolvedQuery || conversationState.lastQuery || "").trim();

  if (!previousQuery || !queryLooksLikeFollowUp(cleanQuery, conversationState)) return cleanQuery;
  if (queryHasAppointmentIntent(cleanQuery) && inferDirectServiceFromQuery(cleanQuery)) return cleanQuery;

  return `${previousQuery}. Follow-up refinement: ${cleanQuery}`;
}

function findMatchingIntent(query, intentMap) {
  const text = normalize(query);

  for (const [intentKey, intent] of Object.entries(intentMap || {})) {
    const aliases = Array.isArray(intent.aliases) ? intent.aliases : [];
    if (text.includes(normalize(intentKey))) return { intentKey, ...intent };

    for (const alias of aliases) {
      if (text.includes(normalize(alias))) return { intentKey, ...intent };
    }
  }

  return null;
}

function getBusinessNamesFromConfig() {
  const businesses = readJson("businesses.json", []);
  if (!Array.isArray(businesses)) return [];

  return businesses
    .map((business) => business.businessName || business.name || "")
    .filter(Boolean);
}

function inferBusinessNameFromQuery(query = "", businessKnowledge = []) {
  const text = normalize(query);
  const textCompact = compact(query);
  const names = [
    ...(Array.isArray(businessKnowledge) ? businessKnowledge.map((b) => b.businessName).filter(Boolean) : []),
    ...getBusinessNamesFromConfig()
  ];

  const uniqueNames = [...new Set(names)].sort((a, b) => String(b).length - String(a).length);

  return (
    uniqueNames.find((name) => {
      const n = normalize(name);
      if (!n) return false;
      return text.includes(n) || textCompact.includes(compact(n));
    }) || ""
  );
}

function businessHaystack(business = {}) {
  return normalize(
    [
      business.businessName,
      business.name,
      business.businessType,
      business.shortDescription,
      business.description,
      business.positioning?.shortDescription,
      ...(business.positioning?.bestFor || []),
      ...(business.positioning?.styleTags || []),
      ...(business.specialties || []),
      ...(business.amenities || []),
      ...(business.clientTypes || []),
      ...(business.searchAliases || [])
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function businessMatchesRecommendedServices(business = {}, services = []) {
  if (!services.length) return false;
  const haystack = businessHaystack(business);

  return services.some((service) => {
    const target = normalize(service);
    return target && (haystack.includes(target) || haystack.includes(target.replace(/_/g, " ")));
  });
}

function businessMatchesAmenity(business = {}, amenity = "") {
  if (!amenity) return true;
  const target = normalize(amenity);
  return businessHaystack(business).includes(target);
}

function getRelevantBusinesses(query, intent, businessKnowledge) {
  const businesses = Array.isArray(businessKnowledge) ? businessKnowledge : [];
  if (!businesses.length) return [];

  const directBusinessName = inferBusinessNameFromQuery(query, businesses);
  if (directBusinessName) {
    const target = normalize(directBusinessName);
    const exact = businesses.filter((business) => normalize(business.businessName) === target);
    if (exact.length) return exact.slice(0, MAX_RELEVANT_BUSINESSES);
  }

  const amenity = inferAmenityFromQuery(query);
  let candidates = amenity ? businesses.filter((business) => businessMatchesAmenity(business, amenity)) : businesses;

  const recommendedServices = Array.isArray(intent?.recommendedServices)
    ? intent.recommendedServices.map(toServiceCategory).filter(Boolean)
    : [];

  const directService = inferDirectServiceFromQuery(query);
  const serviceTerms = [...recommendedServices, directService].filter(Boolean);

  const serviceMatches = candidates.filter((business) => businessMatchesRecommendedServices(business, serviceTerms));
  if (serviceMatches.length) return serviceMatches.slice(0, MAX_RELEVANT_BUSINESSES);

  const words = normalize(query)
    .split(" ")
    .filter((word) => word.length > 3 && !["what", "does", "with", "near", "about", "appointment", "appointments", "available", "availability", "massage"].includes(word));

  const keywordMatches = candidates.filter((business) => {
    const haystack = businessHaystack(business);
    return words.some((word) => haystack.includes(word));
  });

  if (keywordMatches.length) return keywordMatches.slice(0, MAX_RELEVANT_BUSINESSES);

  return candidates.slice(0, MAX_RELEVANT_BUSINESSES);
}

function getRelevantReviewSignals(relevantBusinesses, reviewSignals) {
  if (!Array.isArray(reviewSignals)) return [];
  return reviewSignals.filter((signal) =>
    relevantBusinesses.some((business) => business.businessId && business.businessId === signal.businessId)
  );
}

function appointmentMatchesRelevantBusiness(appointment, relevantBusinesses = [], strict = false) {
  if (!relevantBusinesses.length) return true;

  const apptName = normalize(appointment.businessName || appointment.name || "");
  const relevantNames = relevantBusinesses.map((business) => normalize(business.businessName || business.name || "")).filter(Boolean);

  if (!strict) {
    return relevantNames.some((name) => apptName === name || apptName.includes(name) || name.includes(apptName));
  }

  return relevantNames.some((name) => apptName === name);
}

function appointmentMatchesService(appointment = {}, serviceCategory = "") {
  if (!serviceCategory || serviceCategory === "massage") return true;

  const target = normalize(serviceCategory);
  const haystack = normalize(
    [appointment.serviceCategory, appointment.serviceType, appointment.serviceName, appointment.service].filter(Boolean).join(" ")
  );

  return haystack.includes(target) || haystack.includes(target.replace(/_/g, " "));
}

function appointmentMatchesDuration(appointment = {}, duration = "") {
  if (!duration) return true;
  return Number(appointment.durationMinutes || 0) === Number(duration);
}

function filterAppointmentsByRelevance(appointments = [], options = {}) {
  const {
    query = "",
    relevantBusinesses = [],
    strictBusinessFilter = false,
    serviceCategory = "",
    duration = ""
  } = options;

  let filtered = Array.isArray(appointments) ? appointments : [];

  if (relevantBusinesses.length && strictBusinessFilter) {
    filtered = filtered.filter((appointment) => appointmentMatchesRelevantBusiness(appointment, relevantBusinesses, true));
  }

  if (serviceCategory) {
    filtered = filtered.filter((appointment) => appointmentMatchesService(appointment, serviceCategory));
  }

  if (duration) {
    filtered = filtered.filter((appointment) => appointmentMatchesDuration(appointment, duration));
  }

  filtered = filterAppointmentsByDateTime(filtered, query);

  return filtered;
}

function sortAppointments(appointments = []) {
  return [...appointments].sort((a, b) => {
    const aScore = Number(a.ranking?.score || 0);
    const bScore = Number(b.ranking?.score || 0);
    if (aScore !== bScore) return bScore - aScore;

    const aSort = Number(a.localSortable || 999999999999);
    const bSort = Number(b.localSortable || 999999999999);
    if (aSort !== bSort) return aSort - bSort;

    return String(a.businessName || "").localeCompare(String(b.businessName || ""));
  });
}

function dedupeAppointments(appointments = []) {
  const seen = new Set();
  const output = [];

  for (const appointment of appointments) {
    const key = [
      appointment.businessName,
      appointment.platform,
      appointment.serviceName || appointment.service,
      appointment.durationMinutes,
      appointment.therapistName,
      appointment.startTime,
      appointment.localDateKey,
      appointment.localTimeKey,
      appointment.time
    ]
      .map((value) => normalize(value))
      .join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    output.push(appointment);
  }

  return output;
}

function buildNextApptSearchParams(
  query = "",
  matchedIntent = null,
  previousParams = {},
  businessKnowledge = [],
  categoryMatch = null
) {
  const params = new URLSearchParams();
  params.set("limitPerBusiness", "999");
  params.set("fresh", String(Date.now()));
  params.set("onDemand", "true");

  const recommendedServices = Array.isArray(matchedIntent?.recommendedServices)
    ? matchedIntent.recommendedServices.map(toServiceCategory).filter(Boolean)
    : [];

  const directService =
    inferDirectServiceFromQuery(query);
  const previousService =
    previousParams.serviceCategory ||
    previousParams.service ||
    "";
  const categorySlug =
    categoryMatch?.categorySlug ||
    previousParams.category ||
    previousParams.categorySlug ||
    "";
  const serviceCandidate =
    recommendedServices[0] ||
    directService ||
    previousService ||
    "";
  const serviceCategory =
    toServiceCategory(serviceCandidate) ===
    toServiceCategory(categorySlug)
      ? ""
      : serviceCandidate;

  const duration = inferDurationFromQuery(query) || previousParams.duration || "";
  const time = inferTimeWindowFromQuery(query);
  const previousHours = previousParams.hours || "";
  const businessName = inferBusinessNameFromQuery(query, businessKnowledge) || previousParams.business || "";

  if (businessName) params.set("business", businessName);
  if (categorySlug) {
    params.set(
      "category",
      categorySlug
    );
  }

  if (serviceCategory) {
    params.set("serviceCategory", serviceCategory);
  } else {
    params.set("search", query);
  }

  if (duration) params.set("duration", duration);
  if (time.hours) params.set("hours", time.hours);
  else if (previousHours) params.set("hours", previousHours);

  return params;
}

async function fetchSearchUrl(url) {
  const response = await fetch(url);
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { success: false, error: `Non-JSON response from /api/search: ${text.slice(0, 160)}` };
  }
}

function shouldUseStrictBusinessFilter(query = "", relevantBusinesses = [], businessKnowledge = []) {
  if (!relevantBusinesses.length) return false;
  return Boolean(inferBusinessNameFromQuery(query, businessKnowledge) || inferAmenityFromQuery(query));
}

async function fetchLiveAppointments(req, query, intent, relevantBusinesses = [], previousParams = {}, businessKnowledge = []) {
  const categoryMatch =
    await serviceCategoryRepository
      .inferCategoryFromText(query);

  const searchParams = buildNextApptSearchParams(
    query,
    intent,
    previousParams,
    businessKnowledge,
    categoryMatch
  );
  const primaryUrl = `${req.protocol}://${req.get("host")}/api/search?${searchParams.toString()}`;
  const primaryData = await fetchSearchUrl(primaryUrl);
  const resolvedCategoryMatch =
    categoryMatch ||
    (primaryData?.category
      ? {
          categorySlug:
            primaryData.category.slug,
          category: {
            slug:
              primaryData.category.slug,
            display_name:
              primaryData.category.displayName
          },
          matchedAlias:
            primaryData.categoryMatchedAlias ||
            ""
        }
      : null);

  const serviceCategory = searchParams.get("serviceCategory") || "";
  const duration = searchParams.get("duration") || "";
  const strictBusinessFilter = shouldUseStrictBusinessFilter(query, relevantBusinesses, businessKnowledge);

  let appointments = Array.isArray(primaryData?.appointments) ? primaryData.appointments : [];
  appointments = filterAppointmentsByRelevance(appointments, {
    query,
    relevantBusinesses,
    strictBusinessFilter,
    serviceCategory,
    duration
  });

  const fallbackUrls = [];
  const fallbackResults = [];

  const canUseBroadFallback = !strictBusinessFilter && !duration;

  if (appointments.length === 0 && canUseBroadFallback) {
    const broadParams = new URLSearchParams();
    broadParams.set("limitPerBusiness", "999");
    broadParams.set("fresh", String(Date.now()));
    broadParams.set("onDemand", "true");
    broadParams.set("search", query);

    const broadUrl = `${req.protocol}://${req.get("host")}/api/search?${broadParams.toString()}`;
    fallbackUrls.push(broadUrl);

    const broadData = await fetchSearchUrl(broadUrl);
    fallbackResults.push({ url: broadUrl, totalAppointments: broadData?.totalAppointments || 0 });

    appointments = Array.isArray(broadData?.appointments) ? broadData.appointments : [];
    appointments = filterAppointmentsByRelevance(appointments, {
      query,
      relevantBusinesses,
      strictBusinessFilter: false,
      serviceCategory,
      duration
    });
  }

  if (appointments.length === 0 && !serviceCategory && canUseBroadFallback) {
    const massageParams = new URLSearchParams();
    massageParams.set("limitPerBusiness", "999");
    massageParams.set("fresh", String(Date.now()));
    massageParams.set("onDemand", "true");
    massageParams.set("serviceCategory", "massage");
    massageParams.set("hours", "72");

    const massageUrl = `${req.protocol}://${req.get("host")}/api/search?${massageParams.toString()}`;
    fallbackUrls.push(massageUrl);

    const massageData = await fetchSearchUrl(massageUrl);
    fallbackResults.push({ url: massageUrl, totalAppointments: massageData?.totalAppointments || 0 });

    appointments = Array.isArray(massageData?.appointments) ? massageData.appointments : [];
    appointments = filterAppointmentsByDateTime(appointments, query);
  }

  appointments = sortAppointments(dedupeAppointments(appointments));

  return {
    url: primaryUrl,
    searchParams: Object.fromEntries(searchParams.entries()),
    data: primaryData,
    appointments,
    fallbackUrls,
    fallbackResults,
    dateTimeFilters: inferDateTimeFilters(query),
    categoryMatch:
      resolvedCategoryMatch
  };
}

function queryNeedsMedicalDisclaimer(query = "", matchedIntent = null) {
  const text = normalize(query);
  const medicalWords = [
    "pain",
    "hurt",
    "hurts",
    "injury",
    "injured",
    "sore",
    "soreness",
    "chronic",
    "sciatica",
    "migraine",
    "headache",
    "pregnant",
    "pregnancy",
    "tennis elbow",
    "frozen shoulder",
    "plantar fasciitis",
    "carpal tunnel",
    "arthritis",
    "fibromyalgia"
  ];

  return Boolean(matchedIntent?.intentKey) || medicalWords.some((word) => text.includes(word));
}

function buildRuleBasedIntro(context = {}) {
  const { resolvedQuery = "", userQuery = "", matchedIntent = null, appointments = [] } = context;
  const needsDisclaimer = queryNeedsMedicalDisclaimer(resolvedQuery, matchedIntent);
  const dateTimeFilters = inferDateTimeFilters(resolvedQuery);
  const hasDateTimeFilter = dateTimeFilters.targetLocalDateKey || dateTimeFilters.startTimeKey || dateTimeFilters.endTimeKey;
  const isFollowUp = userQuery && userQuery !== resolvedQuery;

  if (appointments.length > 0) {
    if (needsDisclaimer) {
      return "I can’t give medical advice, but people commonly use appointment-based wellness services for concerns such as tension, soreness, stress, mobility, and recovery. Here are live appointment cards that match your search.";
    }

    if (isFollowUp) return "I updated the appointment cards using your follow-up.";
    return "Here are live appointment cards that match your search.";
  }

  if (hasDateTimeFilter) return "I didn’t find live appointment cards matching that date or time window. Try a broader time window or another appointment category.";
  return "I didn’t find live appointment cards matching that search yet. Try a broader request like ‘massage today,’ ‘chiropractor tomorrow,’ or ‘facial this afternoon.’";
}

function buildRuleBasedTextOnlyAnswer(context = {}) {
  const query = context.resolvedQuery || context.userQuery || "";
  const text = normalize(query);
  const relevantBusinesses = Array.isArray(context.relevantBusinesses) ? context.relevantBusinesses : [];

  if (relevantBusinesses.length > 0 && (context.promptMode === "business_info" || text.includes("business") || text.includes("reviews"))) {
    const business = relevantBusinesses[0];
    const parts = [];

    const description = business.positioning?.shortDescription || business.shortDescription || business.description || "";
    parts.push(description ? `${business.businessName} ${description}` : `${business.businessName} is listed in NextAppt’s Austin wellness data.`);

    const specialties = Array.isArray(business.specialties) ? business.specialties.slice(0, 4) : [];
    if (specialties.length) parts.push(`Specialties mentioned: ${specialties.join(", ")}.`);

    const amenities = Array.isArray(business.amenities) ? business.amenities.slice(0, 3) : [];
    if (amenities.length) parts.push(`Amenities/services mentioned: ${amenities.join(", ")}.`);

    return parts.join(" ");
  }

  const service = inferDirectServiceFromQuery(text);
  if (service === "deep_tissue") return "Deep tissue massage usually uses firmer pressure to work on deeper muscle layers and connective tissue. It is commonly chosen for tension, soreness, and recovery, but it should not replace medical care for injuries or serious symptoms.";
  if (service === "swedish") return "Swedish massage is usually a lighter-to-medium pressure style focused on relaxation, circulation, and general stress relief.";
  if (service === "sports") return "Sports massage is commonly used by active clients for recovery, mobility, and muscle tension related to training or repetitive activity.";
  if (service === "prenatal") return "Prenatal massage is adapted for pregnancy and should be booked with a provider trained for prenatal work. For medical concerns during pregnancy, check with a qualified healthcare professional.";
  if (service === "ashiatsu") return "Ashiatsu is a massage style where the therapist uses their feet, often with overhead support bars, to apply broad and deep pressure.";
  if (service === "infrared_sauna") return "Infrared sauna sessions use infrared heat and are often promoted for relaxation and recovery. Check each business’s details before booking because availability and rules vary.";

  return "I can answer questions about appointment services, Austin wellness businesses, reviews, amenities, and how NextAppt works. For live cards, ask for a service and time, such as ‘deep tissue massage today,’ ‘chiropractor tomorrow,’ or ‘facial after 4.’";
}

async function buildTextOnlyAnswer(context = {}) {
  const client = getOpenAIClient();
  if (!client) return buildRuleBasedTextOnlyAnswer(context);

  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are the AI assistant for NextAppt.ai. Answer informational questions about appointment services, wellness businesses, reviews, amenities, and how NextAppt works. Supported broad categories are supplied by NextAppt data and may include massage, chiropractic, acupuncture, recovery, and skin services. Do not claim live availability was searched. Do not list appointment times. If discussing pain, injury, pregnancy, symptoms, or medical conditions, include a short medical disclaimer. Keep the answer under 5 sentences."
        },
        {
          role: "user",
          content: JSON.stringify({
            userQuery: context.userQuery,
            resolvedQuery: context.resolvedQuery,
            promptMode: context.promptMode,
            matchedIntent: context.matchedIntent,
            relevantBusinesses: context.relevantBusinesses,
            reviewSignals: context.reviewSignals
          })
        }
      ]
    });

    return response.output_text || buildRuleBasedTextOnlyAnswer(context);
  } catch (error) {
    console.error("[AI TEXT ANSWER ERROR]", error.message);
    return buildRuleBasedTextOnlyAnswer(context);
  }
}

async function buildAiIntro(context = {}) {
  const client = getOpenAIClient();
  if (!client) return buildRuleBasedIntro(context);

  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are the AI assistant for NextAppt.ai. Write only a short intro for appointment cards. Do not list businesses or appointment times. Do not invent availability. If no cards matched, clearly say no matching live appointment cards were found. If this is a follow-up, say you updated the results. Keep the answer under 3 sentences."
        },
        {
          role: "user",
          content: JSON.stringify({
            userQuery: context.userQuery,
            resolvedQuery: context.resolvedQuery,
            isFollowUp: context.userQuery !== context.resolvedQuery,
            appointmentCount: context.appointments.length,
            searchParamsUsed: context.searchParamsUsed,
            dateTimeFilters: context.dateTimeFilters,
            needsMedicalDisclaimer: queryNeedsMedicalDisclaimer(context.resolvedQuery, context.matchedIntent)
          })
        }
      ]
    });

    return response.output_text || buildRuleBasedIntro(context);
  } catch (error) {
    console.error("[AI INTRO ERROR]", error.message);
    return buildRuleBasedIntro(context);
  }
}

router.post("/search", async (req, res) => {
  try {
    const query = String(req.body?.query || "").trim();
    const incomingConversationState =
      req.body?.conversationState && typeof req.body.conversationState === "object"
        ? req.body.conversationState
        : {};

    if (!query) {
      return res.status(400).json({ success: false, error: "Query is required." });
    }

    const intentMap = readJson("ai-data/ai-intent-mapping.json", {});
    const businessKnowledge = readJson("ai-data/business-knowledge.json", []);
    const reviewSignals = readJson("ai-data/business-review-signals.json", []);

    const promptMode = classifyAiPrompt(query, incomingConversationState);
    const shouldShowAppointmentCards = shouldFetchAppointmentsForPromptMode(promptMode);
    const resolvedQuery = shouldShowAppointmentCards ? mergeQueryWithConversation(query, incomingConversationState) : query;
    const previousParams = shouldShowAppointmentCards ? incomingConversationState.lastSearchParams || {} : {};

    const matchedIntent =
      findMatchingIntent(resolvedQuery, intentMap) ||
      (shouldShowAppointmentCards ? incomingConversationState.lastIntent : null) ||
      null;

    const relevantBusinesses = getRelevantBusinesses(resolvedQuery, matchedIntent, businessKnowledge);

    let liveAppointments = {
      url: "",
      searchParams: {},
      data: {},
      appointments: [],
      fallbackUrls: [],
      fallbackResults: [],
      dateTimeFilters: inferDateTimeFilters(resolvedQuery)
    };

    if (shouldShowAppointmentCards) {
      liveAppointments = await fetchLiveAppointments(
        req,
        resolvedQuery,
        matchedIntent,
        relevantBusinesses,
        previousParams,
        businessKnowledge
      );
    }

    const appointments = Array.isArray(liveAppointments.appointments)
      ? liveAppointments.appointments.slice(0, MAX_RETURNED_APPOINTMENTS)
      : [];

    const context = {
      userQuery: query,
      resolvedQuery,
      promptMode,
      shouldShowAppointmentCards,
      matchedIntent,
      relevantBusinesses,
      appointments,
      searchParamsUsed: liveAppointments.searchParams,
      dateTimeFilters: liveAppointments.dateTimeFilters,
      categoryMatch:
        liveAppointments.categoryMatch || null,
      reviewSignals: getRelevantReviewSignals(relevantBusinesses, reviewSignals)
    };

    const answer = shouldShowAppointmentCards ? await buildAiIntro(context) : await buildTextOnlyAnswer(context);

    return res.json({
      success: true,
      query,
      resolvedQuery,
      promptMode,
      shouldShowAppointmentCards,
      matchedIntent,
      searchUrlUsed: liveAppointments.url,
      searchParamsUsed: liveAppointments.searchParams,
      category:
        liveAppointments.categoryMatch
          ? {
              slug:
                liveAppointments.categoryMatch.categorySlug,
              displayName:
                liveAppointments.categoryMatch.category.display_name,
              matchedAlias:
                liveAppointments.categoryMatch.matchedAlias
            }
          : null,
      answer,
      appointments,
      relevantBusinesses,
      conversationState: {
        lastQuery: query,
        lastResolvedQuery: resolvedQuery,
        lastPromptMode: promptMode,
        lastIntent: shouldShowAppointmentCards ? matchedIntent : null,
        lastSearchParams: shouldShowAppointmentCards ? liveAppointments.searchParams : {}
      },
      debug: {
        originalQuery: query,
        resolvedQuery,
        promptMode,
        shouldShowAppointmentCards,
        previousSearchParams: previousParams,
        primarySearchUrl: liveAppointments.url,
        fallbackUrls: liveAppointments.fallbackUrls,
        fallbackResults: liveAppointments.fallbackResults,
        primaryTotalAppointments: liveAppointments.data?.totalAppointments || 0,
        returnedAppointmentCount: appointments.length,
        dateTimeFilters: liveAppointments.dateTimeFilters,
        directServiceDetected: inferDirectServiceFromQuery(resolvedQuery),
        businessDetected: inferBusinessNameFromQuery(resolvedQuery, businessKnowledge),
        amenityDetected: inferAmenityFromQuery(resolvedQuery),
        categoryDetected:
          liveAppointments.categoryMatch
            ? {
                slug:
                  liveAppointments.categoryMatch.categorySlug,
                matchedAlias:
                  liveAppointments.categoryMatch.matchedAlias
              }
            : null,
        needsMedicalDisclaimer: queryNeedsMedicalDisclaimer(resolvedQuery, matchedIntent),
        followUpDetected: query !== resolvedQuery
      }
    });
  } catch (error) {
    console.error("[AI SEARCH ERROR]", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;