const express = require("express");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const router = express.Router();

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
    .replace(/\s+/g, " ")
    .trim();
}

function toServiceCategory(value = "") {
  return String(value || "").toLowerCase().replace(/-/g, "_").trim();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getTodayDateKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const map = {};

  parts.forEach((part) => {
    if (part.type !== "literal") map[part.type] = part.value;
  });

  return `${map.year}-${map.month}-${map.day}`;
}

function addDaysToDateKey(dateKey, daysToAdd) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(year, month - 1, day + Number(daysToAdd || 0), 12, 0, 0);

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )}`;
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

  return (
    Boolean(matchedIntent?.intentKey) ||
    medicalWords.some((word) => text.includes(word))
  );
}

function findMatchingIntent(query, intentMap) {
  const text = normalize(query);

  for (const [intentKey, intent] of Object.entries(intentMap || {})) {
    const intentText = normalize(intentKey);
    const aliases = Array.isArray(intent.aliases) ? intent.aliases : [];

    if (text.includes(intentText)) return { intentKey, ...intent };

    for (const alias of aliases) {
      if (text.includes(normalize(alias))) return { intentKey, ...intent };
    }
  }

  return null;
}

function inferDirectServiceFromQuery(query = "") {
  const text = normalize(query);

  if (
    text.includes("swedish") ||
    text.includes("relaxing") ||
    text.includes("relaxation")
  ) {
    return "swedish";
  }

  if (
    text.includes("deep tissue") ||
    text.includes("deep pressure") ||
    text.includes("deep massage")
  ) {
    return "deep_tissue";
  }

  if (
    text.includes("sports massage") ||
    text.includes("sports recovery") ||
    text.includes("athletic recovery")
  ) {
    return "sports";
  }

  if (
    text.includes("prenatal") ||
    text.includes("pregnancy") ||
    text.includes("pregnant")
  ) {
    return "prenatal";
  }

  if (text.includes("ashiatsu")) return "ashiatsu";
  if (text.includes("trigger point")) return "trigger_point";
  if (text.includes("myofascial")) return "myofascial_release";
  if (text.includes("lomi")) return "lomi_lomi";
  if (text.includes("massage")) return "massage";

  return "";
}

function inferAmenityFromQuery(query = "") {
  const text = normalize(query);

  if (text.includes("infrared sauna") || text.includes("sauna")) {
    return "infrared-sauna";
  }

  if (text.includes("cold plunge")) return "cold-plunge";
  if (text.includes("red light")) return "red-light-therapy";
  if (text.includes("compression")) return "compression-therapy";
  if (text.includes("cupping")) return "cupping";

  return "";
}

function inferTimeWindowFromQuery(query = "") {
  const text = normalize(query);

  if (
    text.includes("next available") ||
    text.includes("soonest") ||
    text.includes("asap") ||
    text.includes("right now")
  ) {
    return { hours: "48", timeWindow: "next_available" };
  }

  if (text.includes("today")) return { hours: "24", timeWindow: "today" };

  if (text.includes("tomorrow")) {
    return { hours: "72", timeWindow: "tomorrow" };
  }

  if (text.includes("tonight")) {
    return { hours: "24", timeWindow: "tonight" };
  }

  return { hours: "72", timeWindow: "next_available" };
}

function inferDurationFromQuery(query = "") {
  const text = normalize(query);

  const match = text.match(
    /\b(30|45|50|60|75|80|90|110|120)\s*(minute|min|minutes|mins)?\b/
  );

  if (match) return String(Number(match[1]));

  if (/\b(one|1)\s*(hour|hr)\b/.test(text)) return "60";
  if (/\b(two|2)\s*(hour|hr)\b/.test(text)) return "120";

  return "";
}

function parseLooseTimeToKey(rawHour, rawMinute = "0", rawAmPm = "") {
  let hour = Number(rawHour);
  const minute = Number(rawMinute || 0);
  const ampm = String(rawAmPm || "").toLowerCase();

  if (ampm === "pm" && hour !== 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  return `${pad2(hour)}:${pad2(minute)}`;
}

function inferDateTimeFilters(query = "") {
  const text = normalize(query);
  const today = getTodayDateKey();

  let targetLocalDateKey = "";
  let startTimeKey = "";
  let endTimeKey = "";

  if (text.includes("tomorrow")) {
    targetLocalDateKey = addDaysToDateKey(today, 1);
  } else if (text.includes("today")) {
    targetLocalDateKey = today;
  }

  if (text.includes("morning")) {
    startTimeKey = "05:00";
    endTimeKey = "11:59";
  }

  if (text.includes("afternoon")) {
    startTimeKey = "12:00";
    endTimeKey = "16:59";
  }

  if (text.includes("evening")) {
    startTimeKey = "17:00";
    endTimeKey = "20:59";
  }

  if (text.includes("tonight")) {
    targetLocalDateKey = targetLocalDateKey || today;
    startTimeKey = "17:00";
    endTimeKey = "23:59";
  }

  const betweenMatch = text.match(
    /\bbetween\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(and|to|-)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/
  );

  if (betweenMatch) {
    const startAmPm = betweenMatch[3] || betweenMatch[7] || "";
    const endAmPm = betweenMatch[7] || betweenMatch[3] || "";

    startTimeKey = parseLooseTimeToKey(
      betweenMatch[1],
      betweenMatch[2] || "0",
      startAmPm
    );

    endTimeKey = parseLooseTimeToKey(
      betweenMatch[5],
      betweenMatch[6] || "0",
      endAmPm
    );
  }

  const afterMatch = text.match(/\bafter\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);

  if (afterMatch) {
    startTimeKey = parseLooseTimeToKey(
      afterMatch[1],
      afterMatch[2] || "0",
      afterMatch[3]
    );
  }

  const beforeMatch = text.match(/\bbefore\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);

  if (beforeMatch) {
    endTimeKey = parseLooseTimeToKey(
      beforeMatch[1],
      beforeMatch[2] || "0",
      beforeMatch[3]
    );
  }

  const exactTimeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);

  if (exactTimeMatch && !afterMatch && !beforeMatch && !betweenMatch) {
    const timeKey = parseLooseTimeToKey(
      exactTimeMatch[1],
      exactTimeMatch[2] || "0",
      exactTimeMatch[3]
    );

    const [hour] = timeKey.split(":").map(Number);

    startTimeKey = `${pad2(hour)}:00`;
    endTimeKey = `${pad2(hour)}:59`;
  }

  return {
    targetLocalDateKey,
    startTimeKey,
    endTimeKey
  };
}

function getAppointmentTimeKey(appointment = {}) {
  if (appointment.localTimeKey) return appointment.localTimeKey;

  const raw =
    appointment.time ||
    appointment.rawTime ||
    appointment.startTime ||
    appointment.dateTime ||
    "";

  const normalMatch = String(raw).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);

  if (normalMatch) {
    return parseLooseTimeToKey(
      normalMatch[1],
      normalMatch[2],
      normalMatch[3]
    );
  }

  const isoMatch = String(raw).match(/T(\d{1,2}):(\d{2})/);

  if (isoMatch) {
    return `${pad2(isoMatch[1])}:${pad2(isoMatch[2])}`;
  }

  return "";
}

function appointmentMatchesDateTimeFilters(appointment = {}, filters = {}) {
  const targetLocalDateKey = filters.targetLocalDateKey || "";
  const startTimeKey = filters.startTimeKey || "";
  const endTimeKey = filters.endTimeKey || "";

  if (targetLocalDateKey) {
    if (appointment.localDateKey !== targetLocalDateKey) {
      return false;
    }
  }

  const appointmentTimeKey = getAppointmentTimeKey(appointment);

  if (startTimeKey) {
    if (!appointmentTimeKey || appointmentTimeKey < startTimeKey) {
      return false;
    }
  }

  if (endTimeKey) {
    if (!appointmentTimeKey || appointmentTimeKey > endTimeKey) {
      return false;
    }
  }

  return true;
}

function filterAppointmentsByDateTime(appointments = [], query = "") {
  const filters = inferDateTimeFilters(query);

  if (
    !filters.targetLocalDateKey &&
    !filters.startTimeKey &&
    !filters.endTimeKey
  ) {
    return appointments;
  }

  return appointments.filter((appointment) =>
    appointmentMatchesDateTimeFilters(appointment, filters)
  );
}

function queryLooksLikeFollowUp(query = "", conversationState = {}) {
  const text = normalize(query);
  const previousQuery = String(
    conversationState.lastResolvedQuery || conversationState.lastQuery || ""
  ).trim();

  if (!previousQuery) return false;

  const followUpSignals = [
    "these",
    "those",
    "places",
    "that",
    "them",
    "there",
    "any of these",
    "do any",
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
    "near me",
    "closer",
    "6pm",
    "6 pm",
    "5pm",
    "5 pm",
    "7pm",
    "7 pm",
    "8pm",
    "8 pm",
    "9am",
    "9 am",
    "10am",
    "10 am",
    "11am",
    "11 am"
  ];

  const hasExactTime = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/.test(text);
  const hasDuration = Boolean(inferDurationFromQuery(text));

  return (
    hasExactTime ||
    hasDuration ||
    followUpSignals.some((signal) => text.includes(signal))
  );
}

function mergeQueryWithConversation(query = "", conversationState = {}) {
  const cleanQuery = String(query || "").trim();
  const previousQuery = String(
    conversationState.lastResolvedQuery || conversationState.lastQuery || ""
  ).trim();

  if (!previousQuery || !queryLooksLikeFollowUp(cleanQuery, conversationState)) {
    return cleanQuery;
  }

  return `${previousQuery}. Follow-up refinement: ${cleanQuery}`;
}

function buildNextApptSearchParams(query = "", matchedIntent = null, previousParams = {}) {
  const params = new URLSearchParams();

  params.set("limitPerBusiness", "999");
  params.set("fresh", String(Date.now()));
  params.set("onDemand", "true");

  const recommendedServices = Array.isArray(matchedIntent?.recommendedServices)
    ? matchedIntent.recommendedServices.map(toServiceCategory).filter(Boolean)
    : [];

  const directService = inferDirectServiceFromQuery(query);
  const previousService = previousParams.serviceCategory || previousParams.service || "";
  const serviceCategory = recommendedServices[0] || directService || previousService || "";

  const duration = inferDurationFromQuery(query) || previousParams.duration || "";
  const time = inferTimeWindowFromQuery(query);
  const previousHours = previousParams.hours || "";

  if (serviceCategory) {
    params.set("serviceCategory", serviceCategory);
  } else {
    params.set("search", query);
  }

  if (duration) params.set("duration", duration);

  if (time.hours) {
    params.set("hours", time.hours);
  } else if (previousHours) {
    params.set("hours", previousHours);
  }

  return params;
}

function businessMatchesRecommendedServices(business, services = []) {
  if (!services.length) return false;

  const specialties = Array.isArray(business.specialties)
    ? business.specialties.map(normalize)
    : [];

  return services.some((service) => {
    const target = normalize(service);

    return specialties.some(
      (specialty) => specialty.includes(target) || target.includes(specialty)
    );
  });
}

function businessMatchesAmenity(business, amenity = "") {
  if (!amenity) return true;

  const target = normalize(amenity);

  const amenities = Array.isArray(business.amenities)
    ? business.amenities.map(normalize)
    : [];

  const specialties = Array.isArray(business.specialties)
    ? business.specialties.map(normalize)
    : [];

  const bestFor = Array.isArray(business.positioning?.bestFor)
    ? business.positioning.bestFor.map(normalize)
    : [];

  return [...amenities, ...specialties, ...bestFor].some(
    (item) => item.includes(target) || target.includes(item)
  );
}

function getRelevantBusinesses(query, intent, businessKnowledge) {
  const amenity = inferAmenityFromQuery(query);

  let candidates = Array.isArray(businessKnowledge) ? businessKnowledge : [];

  if (amenity) {
    candidates = candidates.filter((business) =>
      businessMatchesAmenity(business, amenity)
    );
  }

  const recommendedServices = Array.isArray(intent?.recommendedServices)
    ? intent.recommendedServices
    : [];

  const directMatches = candidates.filter((business) =>
    businessMatchesRecommendedServices(business, recommendedServices)
  );

  if (directMatches.length > 0) return directMatches.slice(0, 6);

  const text = normalize(query);

  const keywordMatches = candidates.filter((business) => {
    const haystack = normalize(
      [
        business.businessName,
        business.businessType,
        business.positioning?.shortDescription,
        ...(business.positioning?.bestFor || []),
        ...(business.positioning?.styleTags || []),
        ...(business.specialties || []),
        ...(business.amenities || []),
        ...(business.clientTypes || [])
      ].join(" ")
    );

    return text
      .split(" ")
      .filter((word) => word.length > 3)
      .some((word) => haystack.includes(word));
  });

  if (keywordMatches.length > 0) return keywordMatches.slice(0, 6);

  return candidates.slice(0, 6);
}

function getRelevantReviewSignals(relevantBusinesses, reviewSignals) {
  if (!Array.isArray(reviewSignals)) return [];

  return reviewSignals.filter((signal) =>
    relevantBusinesses.some((business) => business.businessId === signal.businessId)
  );
}

function appointmentMatchesRelevantBusiness(appointment, relevantBusinesses = []) {
  if (!relevantBusinesses.length) return true;

  const relevantNames = relevantBusinesses.map((business) =>
    normalize(business.businessName)
  );

  const apptName = normalize(appointment.businessName);

  return relevantNames.some((name) => apptName === name || apptName.includes(name));
}

async function fetchSearchUrl(url) {
  const response = await fetch(url);
  return response.json();
}

async function fetchLiveAppointments(
  req,
  query,
  intent,
  relevantBusinesses = [],
  previousParams = {}
) {
  const searchParams = buildNextApptSearchParams(query, intent, previousParams);

  const primaryUrl = `${req.protocol}://${req.get("host")}/api/search?${searchParams.toString()}`;

  const primaryData = await fetchSearchUrl(primaryUrl);

  let appointments = Array.isArray(primaryData?.appointments)
    ? primaryData.appointments
    : [];

  const amenity = inferAmenityFromQuery(query);

  if (relevantBusinesses.length > 0 && amenity) {
    appointments = appointments.filter((appointment) =>
      appointmentMatchesRelevantBusiness(appointment, relevantBusinesses)
    );
  }

  appointments = filterAppointmentsByDateTime(appointments, query);

  const fallbackUrls = [];
  const fallbackResults = [];

  if (appointments.length === 0) {
    const broadParams = new URLSearchParams();

    broadParams.set("limitPerBusiness", "999");
    broadParams.set("fresh", String(Date.now()));
    broadParams.set("onDemand", "true");
    broadParams.set("search", query);

    const broadUrl = `${req.protocol}://${req.get("host")}/api/search?${broadParams.toString()}`;

    fallbackUrls.push(broadUrl);

    const broadData = await fetchSearchUrl(broadUrl);

    fallbackResults.push({
      url: broadUrl,
      totalAppointments: broadData?.totalAppointments || 0
    });

    appointments = Array.isArray(broadData?.appointments)
      ? broadData.appointments
      : [];

    if (relevantBusinesses.length > 0 && amenity) {
      appointments = appointments.filter((appointment) =>
        appointmentMatchesRelevantBusiness(appointment, relevantBusinesses)
      );
    }

    appointments = filterAppointmentsByDateTime(appointments, query);
  }

  if (appointments.length === 0) {
    const genericMassageParams = new URLSearchParams();

    genericMassageParams.set("limitPerBusiness", "999");
    genericMassageParams.set("fresh", String(Date.now()));
    genericMassageParams.set("onDemand", "true");
    genericMassageParams.set("serviceCategory", "massage");
    genericMassageParams.set("hours", "72");

    const genericMassageUrl = `${req.protocol}://${req.get("host")}/api/search?${genericMassageParams.toString()}`;

    fallbackUrls.push(genericMassageUrl);

    const genericMassageData = await fetchSearchUrl(genericMassageUrl);

    fallbackResults.push({
      url: genericMassageUrl,
      totalAppointments: genericMassageData?.totalAppointments || 0
    });

    appointments = Array.isArray(genericMassageData?.appointments)
      ? genericMassageData.appointments
      : [];

    if (relevantBusinesses.length > 0 && amenity) {
      appointments = appointments.filter((appointment) =>
        appointmentMatchesRelevantBusiness(appointment, relevantBusinesses)
      );
    }

    appointments = filterAppointmentsByDateTime(appointments, query);
  }

  return {
    url: primaryUrl,
    searchParams: Object.fromEntries(searchParams.entries()),
    data: primaryData,
    appointments,
    fallbackUrls,
    fallbackResults,
    dateTimeFilters: inferDateTimeFilters(query)
  };
}

function buildRuleBasedIntro(query, matchedIntent, appointments = [], originalQuery = "") {
  const needsDisclaimer = queryNeedsMedicalDisclaimer(query, matchedIntent);
  const amenity = inferAmenityFromQuery(query);
  const isFollowUp = originalQuery && originalQuery !== query;
  const dateTimeFilters = inferDateTimeFilters(query);
  const hasDateTimeFilter =
    dateTimeFilters.targetLocalDateKey ||
    dateTimeFilters.startTimeKey ||
    dateTimeFilters.endTimeKey;

  if (appointments.length > 0) {
    if (needsDisclaimer) {
      return "I can’t give medical advice, but people commonly seek massage for muscle tension, soreness, stress, and recovery. Here are live appointment times that match your search.";
    }

    if (amenity) {
      return "Here are businesses with matching amenities and live massage appointment times.";
    }

    if (isFollowUp) {
      return "I updated the appointment results using your follow-up.";
    }

    return "Here are live appointment times that match your search.";
  }

  if (hasDateTimeFilter) {
    return "I didn’t find live appointment cards matching that date or time window. Try a broader time, like afternoon, evening, or tomorrow.";
  }

  if (needsDisclaimer) {
    return "I can’t give medical advice, but people commonly seek massage for muscle tension, soreness, stress, and recovery. I didn’t find live appointment cards that match your search yet.";
  }

  if (amenity) {
    return "I didn’t find live massage appointment cards for businesses matching that amenity yet.";
  }

  return "I didn’t find live appointment cards that match your search yet.";
}

async function buildAiIntro(context) {
  const client = getOpenAIClient();

  if (!client) {
    return buildRuleBasedIntro(
      context.resolvedQuery,
      context.matchedIntent,
      context.appointments,
      context.userQuery
    );
  }

  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are the AI assistant for NextAppt.ai. Write only a short helpful intro for the user. Do not list businesses. Do not list appointment times. Do not invent availability. Only include a medical disclaimer if the user mentions pain, injury, pregnancy, a medical condition, or symptoms. If this was a follow-up refinement, say that you updated the results. If no results match a requested date/time, clearly say no live appointment cards matched that time window. Keep the answer under 3 sentences."
        },
        {
          role: "user",
          content: JSON.stringify({
            userQuery: context.userQuery,
            resolvedQuery: context.resolvedQuery,
            isFollowUp: context.userQuery !== context.resolvedQuery,
            matchedIntent: context.matchedIntent,
            appointmentCount: context.appointments.length,
            searchParamsUsed: context.searchParamsUsed,
            dateTimeFilters: context.dateTimeFilters,
            amenity: inferAmenityFromQuery(context.resolvedQuery),
            needsMedicalDisclaimer: queryNeedsMedicalDisclaimer(
              context.resolvedQuery,
              context.matchedIntent
            ),
            relevantBusinessNames: context.relevantBusinesses.map(
              (business) => business.businessName
            )
          })
        }
      ]
    });

    return (
      response.output_text ||
      buildRuleBasedIntro(
        context.resolvedQuery,
        context.matchedIntent,
        context.appointments,
        context.userQuery
      )
    );
  } catch (error) {
    console.error("[AI INTRO ERROR]", error.message);

    return buildRuleBasedIntro(
      context.resolvedQuery,
      context.matchedIntent,
      context.appointments,
      context.userQuery
    );
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
      return res.status(400).json({
        success: false,
        error: "Query is required."
      });
    }

    const resolvedQuery = mergeQueryWithConversation(
      query,
      incomingConversationState
    );

    const previousParams = incomingConversationState.lastSearchParams || {};

    const intentMap = readJson("ai-data/ai-intent-mapping.json", {});
    const businessKnowledge = readJson("ai-data/business-knowledge.json", []);
    const reviewSignals = readJson("ai-data/business-review-signals.json", []);

    const matchedIntent =
      findMatchingIntent(resolvedQuery, intentMap) ||
      incomingConversationState.lastIntent ||
      null;

    const relevantBusinesses = getRelevantBusinesses(
      resolvedQuery,
      matchedIntent,
      Array.isArray(businessKnowledge) ? businessKnowledge : []
    );

    const liveAppointments = await fetchLiveAppointments(
      req,
      resolvedQuery,
      matchedIntent,
      relevantBusinesses,
      previousParams
    );

    const appointments = Array.isArray(liveAppointments.appointments)
      ? liveAppointments.appointments.slice(0, 30)
      : [];

    const context = {
      userQuery: query,
      resolvedQuery,
      matchedIntent,
      relevantBusinesses,
      appointments,
      searchParamsUsed: liveAppointments.searchParams,
      dateTimeFilters: liveAppointments.dateTimeFilters,
      reviewSignals: getRelevantReviewSignals(relevantBusinesses, reviewSignals)
    };

    const answer = await buildAiIntro(context);

    res.json({
      success: true,
      query,
      resolvedQuery,
      matchedIntent,
      searchUrlUsed: liveAppointments.url,
      searchParamsUsed: liveAppointments.searchParams,
      answer,
      appointments,
      relevantBusinesses,
      conversationState: {
        lastQuery: query,
        lastResolvedQuery: resolvedQuery,
        lastIntent: matchedIntent,
        lastSearchParams: liveAppointments.searchParams
      },
      debug: {
        originalQuery: query,
        resolvedQuery,
        previousSearchParams: previousParams,
        primarySearchUrl: liveAppointments.url,
        fallbackUrls: liveAppointments.fallbackUrls,
        fallbackResults: liveAppointments.fallbackResults,
        primaryTotalAppointments: liveAppointments.data?.totalAppointments || 0,
        returnedAppointmentCount: appointments.length,
        dateTimeFilters: liveAppointments.dateTimeFilters,
        amenityDetected: inferAmenityFromQuery(resolvedQuery),
        needsMedicalDisclaimer: queryNeedsMedicalDisclaimer(
          resolvedQuery,
          matchedIntent
        ),
        followUpDetected: query !== resolvedQuery
      }
    });
  } catch (error) {
    console.error("[AI SEARCH ERROR]", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;