"use strict";

require("dotenv").config();

const {
  initializeAdminSettings,
  refreshAdminSettings,
  loadAdminSettings
} = require("./adminSettingsManager");
const { runDueSchedules } = require("./schedulerV2");
const scrapeJobRepository = require("./database/scrapeJobRepository");

let running = false;
let stopping = false;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function initializeScheduler() {
  await initializeAdminSettings();
  return loadAdminSettings();
}

function schedulerIsEnabled(settings) {
  return (
    settings.scraping?.enabled !== false &&
    settings.scraping?.scheduledScrapingEnabled !== false &&
    settings.scheduler?.enabled !== false
  );
}

async function runScrapeOnce(extraArgs = [], options = {}) {
  const settings = await refreshAdminSettings();
  const job = await scrapeJobRepository.enqueueJob({
    source: options.source || "legacy_scheduler_run_once",
    scriptName: "scrape.js",
    args: Array.isArray(extraArgs) ? extraArgs : [],
    priority: options.priority || 100,
    maxAttempts: options.maxAttempts || settings.scheduler?.jobMaxAttempts || 3,
    timeoutSeconds:
      options.timeoutSeconds || settings.scheduler?.jobTimeoutSeconds || 1800,
    requestedBy: options.requestedBy || "scheduler-process",
    requestPayload: options.requestPayload || {}
  });

  return { success: true, queued: true, job };
}

async function runOnceFromSettings(options = {}) {
  if (running) {
    return {
      success: false,
      skipped: true,
      reason: "scheduler_already_running",
      results: []
    };
  }

  running = true;

  try {
    const settings = await refreshAdminSettings();
    if (!schedulerIsEnabled(settings)) {
      return {
        success: false,
        skipped: true,
        reason: "scheduled_scraping_disabled",
        results: []
      };
    }

    const results = await runDueSchedules({
      force: options.force === true,
      requestedBy: options.requestedBy || "scheduler-process"
    });

    return {
      success: true,
      results,
      jobsQueued: results.reduce(
        (sum, result) => sum + Number(result.jobsQueued || 0),
        0
      )
    };
  } finally {
    running = false;
  }
}

async function startScheduler() {
  await initializeScheduler();

  while (!stopping) {
    try {
      const result = await runOnceFromSettings();
      if (result.jobsQueued) {
        console.log(`[SCHEDULER] Queued ${result.jobsQueued} scrape job(s).`);
      }
    } catch (error) {
      console.error("[SCHEDULER] Poll failed:", error);
    }

    const settings = await refreshAdminSettings();
    const pollSeconds = Math.max(
      10,
      Number(
        process.env.SCHEDULER_POLL_SECONDS ||
        settings.scheduler?.pollIntervalSeconds ||
        30
      )
    );

    await sleep(pollSeconds * 1000);
  }
}

async function stopScheduler(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[SCHEDULER] Received ${signal}; stopping.`);
}

process.on("SIGTERM", () => stopScheduler("SIGTERM"));
process.on("SIGINT", () => stopScheduler("SIGINT"));

async function runCli() {
  await initializeScheduler();

  if (process.argv.includes("--once")) {
    const result = await runOnceFromSettings({
      force: process.argv.includes("--force")
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  await startScheduler();
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error("[SCHEDULER] Fatal error:", error);
    process.exit(1);
  });
}

module.exports = {
  initializeScheduler,
  runScrapeOnce,
  runOnceFromSettings,
  startScheduler,
  stopScheduler,
  schedulerIsEnabled
};