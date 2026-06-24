const express = require("express");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function readJson(relativePath, fallback) {
  const filePath = path.join(__dirname, "..", relativePath);

  if (!fs.existsSync(filePath)) {
    return fallback;
  }

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

function findMatchingIntent(query, intentMap) {
  const text = normalize(query);

  for (const [intentKey, intent] of Object.entries(intentMap || {})) {
    const intentText = normalize(intentKey);
    const aliases = Array.isArray(intent.aliases) ? intent.aliases : [];

    if (text.includes(intentText)) {
      return {
        intentKey,
        ...intent
      };
    }

    for (const alias of aliases) {
      if (text.includes(normalize(alias))) {
        return {
          intentKey,
          ...intent
        };
      }
    }
  }

  return null;
}

function businessMatchesRecommendedServices(business, services = []) {
  if (!services.length) return false;

  const specialties = Array.isArray(business.specialties)
    ? business.specialties.map(normalize)
    : [];

  return services.some((service) => {
    const target = normalize(service);
    return specialties.some((specialty) => specialty.includes(target) || target.includes(specialty));
  });
}

function getRelevantBusinesses(query, intent, businessKnowledge) {
  const recommendedServices = Array.isArray(intent?.recommendedServices)
    ? intent.recommendedServices
    : [];

  const directMatches = businessKnowledge.filter((business) =>
    businessMatchesRecommendedServices(business, recommendedServices)
  );

  if (directMatches.length > 0) {
    return directMatches.slice(0, 6);
  }

  const text = normalize(query);

  return businessKnowledge
    .filter((business) => {
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
    })
    .slice(0, 6);
}

async function fetchLiveAppointments(req, query, intent) {
  const searchParams = new URLSearchParams();

  searchParams.set("limitPerBusiness", "999");
  searchParams.set("fresh", String(Date.now()));
  searchParams.set("onDemand", "true");

  if (query) {
    searchParams.set("search", query);
  }

  const recommendedServices = Array.isArray(intent?.recommendedServices)
    ? intent.recommendedServices
    : [];

  if (recommendedServices[0]) {
    searchParams.set("service", recommendedServices[0]);
  }

  const url = `${req.protocol}://${req.get("host")}/api/search?${searchParams.toString()}`;

  const response = await fetch(url);
  const data = await response.json();

  return {
    url,
    data
  };
}

router.post("/search", async (req, res) => {
  try {
    const query = String(req.body?.query || "").trim();

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Query is required."
      });
    }

    const serviceTaxonomy = readJson("ai-data/ai-service-taxonomy.json", {});
    const intentMap = readJson("ai-data/ai-intent-mapping.json", {});
    const businessKnowledge = readJson("ai-data/business-knowledge.json", []);
    const reviewSignals = readJson("ai-data/business-review-signals.json", []);

    const matchedIntent = findMatchingIntent(query, intentMap);

    const relevantBusinesses = getRelevantBusinesses(
      query,
      matchedIntent,
      Array.isArray(businessKnowledge) ? businessKnowledge : []
    );

    const liveAppointments = await fetchLiveAppointments(req, query, matchedIntent);

    const appointments = Array.isArray(liveAppointments.data?.appointments)
      ? liveAppointments.data.appointments.slice(0, 20)
      : [];

    const context = {
      userQuery: query,
      matchedIntent,
      relevantBusinesses,
      appointments,
      serviceTaxonomy,
      reviewSignals: Array.isArray(reviewSignals)
        ? reviewSignals.filter((signal) =>
            relevantBusinesses.some((business) => business.businessId === signal.businessId)
          )
        : []
    };

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: "You are the AI assistant for NextAppt.ai. Give a brief, non-medical explanation of what appointment types may fit the user's request. Do not list businesses. Do not invent appointment availability. Do not say no appointments are available unless the provided appointments array is empty. Keep the answer under 4 sentences."
        },
        {
          role: "user",
          content: JSON.stringify(context)
        }
      ]
    });

res.json({
  success: true,
  query,
  matchedIntent,
  answer: response.output_text,
  appointments,
  relevantBusinesses
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