const { spawn } = require("child_process");

const {
  loadAdminSettings,
  getClusterIntervalMinutes,
  isClusterEnabled
} = require("./adminSettingsManager");

let running = false;

function runScrapeOnce(extraArgs = []) {
  return new Promise((resolve) => {
    if (running) {
      console.log("[SCHEDULER] Scrape already running. Skipping this tick.");
      resolve({
        success: false,
        skipped: true,
        reason: "scrape_already_running"
      });
      return;
    }

    running = true;

    const args = ["scrape.js", ...extraArgs];

    console.log(`[SCHEDULER] Starting: node ${args.join(" ")}`);

    const child = spawn("node", args, {
      cwd: __dirname,
      stdio: "inherit",
      shell: true
    });

    child.on("close", (code) => {
      running = false;

      console.log(`[SCHEDULER] Scrape finished with code ${code}`);

      resolve({
        success: code === 0,
        code
      });
    });

    child.on("error", (error) => {
      running = false;

      console.error("[SCHEDULER] Failed to start scrape:", error.message);

      resolve({
        success: false,
        error: error.message
      });
    });
  });
}

async function runOnceFromSettings() {
  const settings = loadAdminSettings();

  if (settings.scraping.enabled === false) {
    console.log("[SCHEDULER] Scraping disabled. No run started.");
    return;
  }

  if (settings.scraping.scheduledScrapingEnabled === false) {
    console.log("[SCHEDULER] Scheduled scraping disabled. No run started.");
    return;
  }

  await runScrapeOnce([]);
}

function getEnabledClusterIds(settings) {
  const clusters = settings.clusters || {};

  return Object.keys(clusters).filter((clusterId) => {
    return isClusterEnabled(clusterId);
  });
}

function startScheduler() {
  const settings = loadAdminSettings();

  if (settings.scraping.enabled === false) {
    console.log("[SCHEDULER] Scraping disabled.");
    return;
  }

  if (settings.scraping.scheduledScrapingEnabled === false) {
    console.log("[SCHEDULER] Scheduled scraping disabled.");
    return;
  }

  const clusterIds = getEnabledClusterIds(settings);

  if (!clusterIds.length) {
    const intervalMinutes = settings.scraping.defaultIntervalMinutes || 15;

    console.log(`[SCHEDULER] No clusters enabled. Running global scrape every ${intervalMinutes} minutes.`);

    runScrapeOnce([]);

    setInterval(() => {
      runScrapeOnce([]);
    }, intervalMinutes * 60 * 1000);

    return;
  }

  clusterIds.forEach((clusterId) => {
    const intervalMinutes = getClusterIntervalMinutes(clusterId);

    console.log(`[SCHEDULER] Cluster ${clusterId}: every ${intervalMinutes} minutes.`);

    runScrapeOnce([`--cluster=${clusterId}`]);

    setInterval(() => {
      runScrapeOnce([`--cluster=${clusterId}`]);
    }, intervalMinutes * 60 * 1000);
  });
}

async function runCli() {
  const args = process.argv.slice(2);

  if (args.includes("--once")) {
    await runOnceFromSettings();
    return;
  }

  startScheduler();
}

if (require.main === module) {
  runCli();
}

module.exports = {
  runScrapeOnce,
  runOnceFromSettings,
  startScheduler
};