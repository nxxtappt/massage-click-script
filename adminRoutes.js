const express = require("express");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const {
  loadAdminSettings,
  saveAdminSettings
} = require("./adminSettingsManager");

const {
  clearAppointmentCache,
  getCacheStats,
  getCachedAppointments
} = require("./cacheManager");

const router = express.Router();

const {
  loadBusinessSubscriptions,
  setBusinessSubscription
} = require("./businessSubscriptionManager");

const BUSINESSES_FILE = path.join(__dirname, "businesses.json");
const RESULTS_FILE = path.join(__dirname, "results.json");
const ERROR_LOGS_FILE = path.join(__dirname, "errorLogs.json");

let schedulerRunInProgress = false;
let scrapeRunInProgress = false;

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`[ADMIN ROUTES] Failed to read ${filePath}:`, error.message);
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function addArg(args, key, value) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return;
  args.push(`--${key}=${cleaned}`);
}

function runNodeScript(scriptName, args = []) {
  return new Promise((resolve) => {
    const child = spawn("node", [scriptName, ...args], {
      cwd: __dirname,
      shell: false,
      stdio: "ignore",
      detached: true
    });

    child.on("error", (error) => {
      resolve({ success: false, error: error.message });
    });

    child.unref();

    resolve({ success: true });
  });
}

function buildScrapeArgsFromBody(body = {}) {
  const args = [];

  addArg(args, "platform", body.platform);
  addArg(args, "business", body.business);
  addArg(args, "service", body.service);
  addArg(args, "serviceType", body.serviceType);
  addArg(args, "durationMinutes", body.durationMinutes);
  addArg(args, "priority", body.priority);
  addArg(args, "discoveryStatus", body.discoveryStatus);
  addArg(args, "latitude", body.latitude);
  addArg(args, "longitude", body.longitude);
  addArg(args, "maxDistanceMiles", body.maxDistanceMiles);

  if (body.forceRefresh === true) args.push("--forceRefresh=true");
  if (body.manual === true) args.push("--manual=true");
  if (body.onDemand === true) args.push("--onDemand=true");
  if (body.ignoreServiceRules === true) args.push("--ignoreServiceRules=true");
  if (body.skipVagaroDiscovery === true) args.push("--skipVagaroDiscovery=true");

  return args;
}

router.get("/debug/routes", (req, res) => {
  res.json({
    success: true,
    message: "adminRoutes.js is loaded correctly",
    file: __filename,
    routes: [
      "GET /api/admin/businesses",
      "POST /api/admin/businesses/save",
      "GET /api/admin/results",
      "GET /api/admin/errors",
      "GET /api/admin/settings",
      "POST /api/admin/settings/save",
      "GET /api/admin/cache/stats",
      "GET /api/admin/cache/items",
      "POST /api/admin/cache/clear",
      "POST /api/admin/scheduler/run-once",
      "POST /api/admin/scrape/run-once",
      "POST /api/admin/scrape/targeted"
    ]
  });
});

router.get("/businesses", (req, res) => {
  res.json({
    success: true,
    businesses: readJsonFile(BUSINESSES_FILE, [])
  });
});

router.get("/business-subscriptions", (req, res) => {
  try {
    res.json({
      success: true,
      subscriptions: loadBusinessSubscriptions()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/business-subscriptions", (req, res) => {
  try {
    const {
      businessName,
      plan,
      subscriptionStatus,
      notes
    } = req.body || {};

    if (!businessName) {
      return res.status(400).json({
        success: false,
        error: "businessName is required."
      });
    }

    const subscription = setBusinessSubscription(businessName, {
      plan,
      subscriptionStatus,
      billingProvider: "manual_admin",
      notes
    });

    res.json({
      success: true,
      message: "Business subscription updated.",
      businessName,
      subscription
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/businesses/save", (req, res) => {
  const businesses = req.body?.businesses;

  if (!Array.isArray(businesses)) {
    return res.status(400).json({
      success: false,
      error: "businesses must be an array"
    });
  }

  writeJsonFile(BUSINESSES_FILE, businesses);

  res.json({
    success: true,
    count: businesses.length
  });
});

router.get("/results", (req, res) => {
  res.json({
    success: true,
    results: readJsonFile(RESULTS_FILE, [])
  });
});

router.get("/errors", (req, res) => {
  res.json({
    success: true,
    errors: readJsonFile(ERROR_LOGS_FILE, [])
  });
});

router.get("/settings", (req, res) => {
  res.json({
    success: true,
    settings: loadAdminSettings()
  });
});

router.post("/settings/save", (req, res) => {
  const settings = req.body?.settings;

  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return res.status(400).json({
      success: false,
      error: "settings must be an object"
    });
  }

  res.json({
    success: true,
    settings: saveAdminSettings(settings)
  });
});

router.get("/cache/stats", (req, res) => {
  res.json({
    success: true,
    stats: getCacheStats()
  });
});

router.get("/cache/items", (req, res) => {
  const items = getCachedAppointments(req.query || {});

  res.json({
    success: true,
    count: items.length,
    items
  });
});

router.post("/cache/clear", (req, res) => {
  clearAppointmentCache();

  res.json({
    success: true,
    message: "Appointment cache cleared."
  });
});

router.post("/scheduler/run-once", async (req, res) => {
  if (schedulerRunInProgress) {
    return res.status(409).json({
      success: false,
      error: "A scheduler run is already being started."
    });
  }

  schedulerRunInProgress = true;

  try {
    const result = await runNodeScript("scheduler.js", ["--once"]);

    res.json({
      success: result.success,
      message: result.success ? "Scheduler run started." : "Scheduler failed to start.",
      error: result.error || null
    });
  } finally {
    setTimeout(() => {
      schedulerRunInProgress = false;
    }, 5000);
  }
});

router.post("/scrape/run-once", async (req, res) => {
  if (scrapeRunInProgress) {
    return res.status(409).json({
      success: false,
      error: "A scrape run is already being started."
    });
  }

  scrapeRunInProgress = true;

  try {
    const args = buildScrapeArgsFromBody(req.body || {});
    const result = await runNodeScript("scrape.js", args);

    res.json({
      success: result.success,
      message: result.success ? "Scrape run started." : "Scrape failed to start.",
      args,
      error: result.error || null
    });
  } finally {
    setTimeout(() => {
      scrapeRunInProgress = false;
    }, 5000);
  }
});

router.post("/scrape/targeted", async (req, res) => {
  if (scrapeRunInProgress) {
    return res.status(409).json({
      success: false,
      error: "A scrape run is already being started."
    });
  }

  const body = req.body || {};

  if (
    !body.platform &&
    !body.business &&
    !body.service &&
    !body.serviceType &&
    !body.durationMinutes
  ) {
    return res.status(400).json({
      success: false,
      error: "Choose at least one target: platform, business, service, service type, or duration."
    });
  }

  scrapeRunInProgress = true;

  try {
    const args = buildScrapeArgsFromBody({
      ...body,
      manual: body.manual !== false,
      forceRefresh: body.forceRefresh !== false
    });

    const result = await runNodeScript("scrape.js", args);

    res.json({
      success: result.success,
      message: result.success ? "Targeted scrape started." : "Targeted scrape failed to start.",
      args,
      error: result.error || null
    });
  } finally {
    setTimeout(() => {
      scrapeRunInProgress = false;
    }, 5000);
  }
});

module.exports = router;