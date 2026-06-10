const fs = require("fs");
const path = require("path");

const { searchAppointments } = require("./searchAppointments");

const {
  loadAppointmentCache,
  analyzeTargetsForCache
} = require("./cacheManager");

const {
  buildScrapeJobs
} = require("./jobBuilder");

const {
  getActiveLock
} = require("./searchLockManager");

const {
  normalizeServiceType,
  getCanonicalServiceTypes
} = require("./normalizationUtils");

const DEFAULT_GEO_CLUSTER =
  "austin-central";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readJsonFile(
  fileName,
  fallback
) {
  const filePath = path.join(
    __dirname,
    fileName
  );

  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch (error) {
    console.error(
      `[DECISION] Failed to read ${fileName}:`,
      error.message
    );

    return fallback;
  }
}

function inferServiceType(
  searchText = ""
) {
  const text =
    normalize(searchText);

  if (!text) {
    return "";
  }

  const canonical =
    normalizeServiceType(text);

  if (
    canonical &&
    canonical !== text.replace(/\s+/g, "_")
  ) {
    return canonical;
  }

  const knownTypes =
    typeof getCanonicalServiceTypes === "function"
      ? getCanonicalServiceTypes()
      : [
          "massage",
          "swedish",
          "relaxation",
          "deep_tissue",
          "sports",
          "prenatal",
          "ashiatsu",
          "lomi_lomi",
          "facial",
          "hair",
          "other"
        ];

  if (knownTypes.includes(canonical)) {
    return canonical;
  }

  return "";
}

function inferDurationMinutes(
  searchText = ""
) {
  const text =
    normalize(searchText);

  const match =
    text.match(
      /\b(30|45|50|60|75|80|90|110|120)\s*(minute|min|minutes|mins|hour|hr|hrs)?\b/
    );

  if (match) {
    const number = Number(
      match[1]
    );

    const unit =
      match[2] || "";

    if (
      unit.includes(
        "hour"
      ) ||
      unit.includes("hr")
    ) {
      return number * 60;
    }

    return number;
  }

  if (
    /\b(one|1)\s*(hour|hr)\b/.test(
      text
    )
  )
    return 60;

  if (
    /\b(two|2)\s*(hour|hr)\b/.test(
      text
    )
  )
    return 120;

  return null;
}

function inferTimeWindow(
  searchText = ""
) {
  const text =
    normalize(searchText);

  if (
    text.includes("now") ||
    text.includes("asap") ||
    text.includes(
      "right now"
    )
  ) {
    return "next_2_hours";
  }

  if (
    text.includes(
      "tonight"
    )
  )
    return "tonight";

  if (
    text.includes(
      "tomorrow"
    )
  )
    return "tomorrow";

  if (
    text.includes(
      "weekend"
    )
  )
    return "this_weekend";

  if (
    text.includes("today") ||
    text.includes(
      "near me"
    ) ||
    text.includes("next")
  ) {
    return "today";
  }

  return "next_24_hours";
}

function inferRadiusMiles(
  query = {}
) {
  if (
    query.radiusMiles
  ) {
    return Number(
      query.radiusMiles
    );
  }

  if (
    query.maxDistanceMiles
  ) {
    return Number(
      query.maxDistanceMiles
    );
  }

  const text =
    normalize(
      query.search ||
        query.query ||
        ""
    );

  if (
    text.includes(
      "near me"
    )
  )
    return 3;

  if (
    text.includes(
      "nearby"
    )
  )
    return 3;

  if (
    text.includes(
      "austin"
    )
  )
    return 10;

  return 5;
}

function inferGeoCluster(
  query = {}
) {
  if (
    query.geoCluster
  ) {
    return normalize(
      query.geoCluster
    ).replace(/\s+/g, "-");
  }

  if (query.cluster) {
    return normalize(
      query.cluster
    ).replace(/\s+/g, "-");
  }

  const text =
    normalize(
      query.search ||
        query.query ||
        ""
    );

  if (
    text.includes(
      "south"
    )
  )
    return "south-austin";

  if (
    text.includes(
      "north"
    )
  )
    return "north-austin";

  if (
    text.includes("east")
  )
    return "east-austin";

  if (
    text.includes("west")
  )
    return "west-austin";

  if (
    text.includes(
      "round rock"
    )
  )
    return "round-rock";

  if (
    text.includes(
      "cedar park"
    )
  )
    return "cedar-park";

  if (
    text.includes(
      "buda"
    ) ||
    text.includes(
      "kyle"
    )
  ) {
    return "buda-kyle";
  }

  return DEFAULT_GEO_CLUSTER;
}

function buildSearchIntent(
  query = {}
) {
  const rawSearch =
    query.search ||
    query.query ||
    "";

  const explicitServiceType =
    query.serviceType ||
    query.serviceCategory ||
    query.service ||
    "";

  const serviceType =
    explicitServiceType
      ? normalizeServiceType(explicitServiceType)
      : inferServiceType(rawSearch);

  const durationMinutes =
    query.durationMinutes
      ? Number(
          query.durationMinutes
        )
      : query.duration
        ? Number(
            query.duration
          )
        : inferDurationMinutes(
            rawSearch
          );

  const timeWindow =
    query.timeWindow ||
    inferTimeWindow(
      rawSearch
    );

  const radiusMiles =
    inferRadiusMiles(query);

  const geoCluster =
    inferGeoCluster(query);

  const intentKey = [
    geoCluster,
    `${radiusMiles}mi`,
    serviceType ||
      "any_service",
    durationMinutes ||
      "any_duration",
    timeWindow
  ].join("|");

  return {
    rawSearch,
    intentKey,
    serviceType,
    durationMinutes,
    timeWindow,
    radiusMiles,
    geoCluster
  };
}

function getAgeMinutes(item) {
  const checked =
    item.lastChecked ||
    item.cachedAt;

  if (!checked) {
    return null;
  }

  const checkedTime =
    new Date(checked).getTime();

  if (
    Number.isNaN(
      checkedTime
    )
  ) {
    return null;
  }

  return Math.round(
    (Date.now() -
      checkedTime) /
      60000
  );
}

function getCacheFreshnessBucket(
  ageMinutes
) {
  if (
    ageMinutes === null
  )
    return "unknown";

  if (ageMinutes <= 15)
    return "hot_cache";

  if (ageMinutes <= 60)
    return "warm_cache";

  if (ageMinutes <= 360)
    return "stale_cache";

  return "expired_cache";
}

function getBestCacheBucket(
  cachedResults = []
) {
  if (
    !cachedResults.length
  ) {
    return {
      bucket:
        "missing_cache",
      youngestAgeMinutes:
        null,
      oldestAgeMinutes:
        null
    };
  }

  const ages =
    cachedResults
      .map(getAgeMinutes)
      .filter(
        (age) =>
          typeof age ===
          "number"
      );

  if (!ages.length) {
    return {
      bucket: "unknown",
      youngestAgeMinutes:
        null,
      oldestAgeMinutes:
        null
    };
  }

  return {
    bucket:
      getCacheFreshnessBucket(
        Math.min(...ages)
      ),

    youngestAgeMinutes:
      Math.min(...ages),

    oldestAgeMinutes:
      Math.max(...ages)
  };
}

function searchCacheForIntent(
  intent
) {
  return searchAppointments(
    {
      serviceType:
        intent.serviceType ||
        undefined,

      durationMinutes:
        intent.durationMinutes ||
        undefined,

      hasTimes: true,

      limit: 25
    }
  );
}

function isSearchSpecificEnoughForLiveScrape(
  intent
) {
  if (!intent) {
    return false;
  }

  const hasService =
    Boolean(
      intent.serviceType
    );

  const hasDuration =
    Boolean(
      intent.durationMinutes
    );

  if (
    hasService &&
    hasDuration
  ) {
    return true;
  }

  const liveScrapeAllowedServiceTypes =
    typeof getCanonicalServiceTypes === "function"
      ? getCanonicalServiceTypes().filter((type) => type !== "other")
      : [
          "massage",
          "swedish",
          "relaxation",
          "deep_tissue",
          "sports",
          "prenatal",
          "ashiatsu",
          "lomi_lomi",
          "facial",
          "hair"
        ];

  if (
    hasService &&
    liveScrapeAllowedServiceTypes.includes(
      normalizeServiceType(intent.serviceType)
    )
  ) {
    return true;
  }

  return false;
}

function buildFiltersFromIntent(
  intent,
  query = {}
) {
  return {
    search:
      intent.rawSearch ||
      "",

    serviceType:
      intent.serviceType
        ? normalizeServiceType(intent.serviceType)
        : "",

    durationMinutes:
      intent.durationMinutes ||
      null,

    platform:
      query.platform ||
      "",

    business:
      query.business ||
      "",

    latitude:
      query.latitude
        ? Number(
            query.latitude
          )
        : null,

    longitude:
      query.longitude
        ? Number(
            query.longitude
          )
        : null,

    maxDistanceMiles:
      intent.radiusMiles ||
      null,

    onDemand: true
  };
}

function buildTargetsForIntent(
  intent,
  query = {}
) {
  const businesses =
    readJsonFile(
      "businesses.json",
      []
    );

  if (
    !Array.isArray(
      businesses
    )
  ) {
    return [];
  }

  const filters =
    buildFiltersFromIntent(
      intent,
      query
    );

  const jobs =
    buildScrapeJobs(
      businesses,
      filters
    );

  return jobs.map(
    (job) => ({
      businessName:
        job.businessName ||
        job.name ||
        "",

      platform:
        job.platform ||
        "",

      serviceName:
        job.serviceName ||
        "",

      serviceType:
        normalizeServiceType(
          job.serviceType ||
            job.serviceCategory ||
            job.serviceName ||
            ""
        ),

      durationMinutes:
        job.durationMinutes ||
        null,

      priority:
        job.priority ||
        job.servicePriority ||
        "",

      discoveryStatus:
        job.discoveryStatus ||
        "",

      distanceMiles:
        typeof job.distanceMiles ===
        "number"
          ? job.distanceMiles
          : null,

      bookingUrl:
        job.bookingUrl ||
        "",

      platformServiceId:
        job.platformServiceId ||
        "",

      serviceButtonId:
        job.serviceButtonId ||
        "",

      serviceId:
        job.serviceId ||
        ""
    })
  );
}

function prioritizeTargets(
  targets = []
) {
  const priorityWeight = {
    critical: 100,
    high: 80,
    medium: 50,
    low: 10
  };

  return [...targets]
    .sort((a, b) => {
      const aPriority =
        priorityWeight[
          normalize(a.priority)
        ] || 0;

      const bPriority =
        priorityWeight[
          normalize(b.priority)
        ] || 0;

      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }

      const aDistance =
        typeof a.distanceMiles ===
        "number"
          ? a.distanceMiles
          : 999;

      const bDistance =
        typeof b.distanceMiles ===
        "number"
          ? b.distanceMiles
          : 999;

      if (aDistance !== bDistance) {
        return aDistance - bDistance;
      }

      return String(
        a.businessName || ""
      ).localeCompare(
        String(
          b.businessName || ""
        )
      );
    });
}

function loadSystemSettings() {
  return readJsonFile(
    "admin-settings.json",
    {}
  );
}

function decideSearchAction(
  query = {}
) {
  const settings =
    loadSystemSettings();

  const intent =
    buildSearchIntent(
      query
    );

  const activeLock =
    getActiveLock(
      intent.intentKey
    );

  const cache =
    loadAppointmentCache();

  const cachedResults =
    searchCacheForIntent(
      intent
    );

  const cacheInfo =
    getBestCacheBucket(
      cachedResults
    );

  const scrapingEnabled =
    settings.scraping
      ?.enabled !== false;

  const onDemandEnabled =
    settings.scraping
      ?.onDemandEnabled !==
      false &&
    settings.onDemand
      ?.enabled !== false;

  const maxJobsPerSearch =
    Number(
      settings.onDemand
        ?.maxJobsPerSearch ||
        10
    );

  let targets =
    buildTargetsForIntent(
      intent,
      query
    );

  targets =
    prioritizeTargets(
      targets
    );

  const targetCacheAnalysis =
    analyzeTargetsForCache(
      targets
    );

  const freshTargets =
    targetCacheAnalysis.freshTargets;

  const staleTargets =
    targetCacheAnalysis.staleTargets;

  const missingTargets =
    targetCacheAnalysis.missingTargets;

  let targetsToScrape =
    [
      ...staleTargets.map(
        (x) => x.target
      ),

      ...missingTargets.map(
        (x) => x.target
      )
    ];

  targetsToScrape =
    prioritizeTargets(
      targetsToScrape
    );

  const freshCachedResults =
    freshTargets.map(
      (x) => x.cacheEntry
    );

  const matchingTargetCount =
    targets.length;

  const specificEnough =
    isSearchSpecificEnoughForLiveScrape(
      intent
    );

  let decision =
    "defer_or_deny_scrape";

  let serveCache = false;

  let queueRefresh = false;

  let liveScrapeNow = false;

  let reason = "";

  if (activeLock) {
    decision =
      freshCachedResults.length >
      0
        ? "serve_cache_refresh_already_running"
        : "refresh_already_running";

    serveCache =
      freshCachedResults.length >
      0;

    reason =
      "A scrape is already running for this exact search intent.";
  } else if (
    freshTargets.length ===
      targets.length &&
    targets.length > 0
  ) {
    decision =
      "serve_fresh_cache";

    serveCache = true;

    reason =
      "All matching targets are already cached fresh.";
  } else if (
    freshTargets.length > 0 &&
    targetsToScrape.length >
      0
  ) {
    decision =
      "partial_cache_and_live_scrape";

    serveCache = true;

    liveScrapeNow =
      scrapingEnabled &&
      onDemandEnabled;

    reason =
      "Some targets are cached fresh while others require refresh.";
  } else if (
    !scrapingEnabled
  ) {
    decision =
      "defer_or_deny_scrape";

    serveCache =
      freshCachedResults.length >
      0;

    reason =
      "Scraping disabled.";
  } else if (
    !onDemandEnabled
  ) {
    decision =
      "queue_refresh_only";

    serveCache =
      freshCachedResults.length >
      0;

    reason =
      "On-demand scraping disabled.";
  } else if (
    !specificEnough
  ) {
    decision =
      "defer_or_deny_scrape";

    serveCache =
      freshCachedResults.length >
      0;

    reason =
      "Search too broad for live scraping.";
  } else if (
    matchingTargetCount ===
    0
  ) {
    decision =
      "defer_or_deny_scrape";

    serveCache =
      freshCachedResults.length >
      0;

    reason =
      "No matching targets found.";
  } else if (
    targetsToScrape.length >
    maxJobsPerSearch
  ) {
    decision =
      "partial_priority_scrape";

    serveCache =
      freshCachedResults.length >
      0;

    liveScrapeNow = true;

    targetsToScrape =
      targetsToScrape.slice(
        0,
        maxJobsPerSearch
      );

    reason =
      `Limited live scrape to top ${maxJobsPerSearch} priority targets.`;
  } else {
    decision =
      "live_scrape_now";

    serveCache =
      freshCachedResults.length >
      0;

    liveScrapeNow = true;

    reason =
      "Targets require live scraping.";
  }

  return {
    intentKey:
      intent.intentKey,

    intent,

    decision,

    serveCache,

    queueRefresh,

    liveScrapeNow,

    reason,

    lock: {
      isLocked:
        Boolean(
          activeLock
        ),

      activeLock
    },

    cache: {
      totalCacheEntries:
        Array.isArray(
          cache
        )
          ? cache.length
          : 0,

      matchingCachedResults:
        cachedResults.length,

      freshnessBucket:
        cacheInfo.bucket,

      youngestAgeMinutes:
        cacheInfo.youngestAgeMinutes,

      oldestAgeMinutes:
        cacheInfo.oldestAgeMinutes
    },

    scrapePlanning: {
      matchingTargetCount,

      targetsToScrapeCount:
        targetsToScrape.length,

      freshTargetCount:
        freshTargets.length,

      staleTargetCount:
        staleTargets.length,

      missingTargetCount:
        missingTargets.length,

      maxJobsPerSearch,

      specificEnoughForLiveScrape:
        specificEnough,

      scrapingEnabled,

      onDemandEnabled
    },

    targetCacheAnalysis,

    targets,

    targetsToScrape,

    freshCachedResults,

    cachedResults
  };
}

function runCli() {
  const query = {};

  process.argv
    .slice(2)
    .forEach((arg) => {
      if (
        !arg.startsWith(
          "--"
        )
      ) {
        return;
      }

      const [key, value] =
        arg
          .replace(
            /^--/,
            ""
          )
          .split("=");

      query[key] =
        value === undefined
          ? true
          : value;
    });

  const decision =
    decideSearchAction(
      query
    );

  console.log(
    "\n===== SEARCH DECISION ====="
  );

  console.log(
    JSON.stringify(
      decision,
      null,
      2
    )
  );
}

if (require.main === module) {
  runCli();
}

module.exports = {
  decideSearchAction,
  buildSearchIntent,
  buildTargetsForIntent,
  inferServiceType,
  inferDurationMinutes,
  inferTimeWindow
};