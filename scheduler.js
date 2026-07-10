require("dotenv").config();
const { spawn } = require("child_process");
const { initializeAdminSettings, loadAdminSettings, getClusterIntervalMinutes, isClusterEnabled } = require("./adminSettingsManager");
const { initializeAppointmentCache } = require("./cacheManager");
const businessManager = require("./businessManager");
let running = false;

function runScrapeOnce(extraArgs = []) {
  return new Promise((resolve) => {
    if (running) return resolve({ success: false, skipped: true, reason: "scrape_already_running" });
    running = true;
    const child = spawn(process.execPath, ["scrape.js", ...extraArgs], { cwd: __dirname, stdio: "inherit", shell: false });
    child.on("close", (code) => { running = false; resolve({ success: code === 0, code }); });
    child.on("error", (error) => { running = false; resolve({ success: false, error: error.message }); });
  });
}
async function initializeScheduler() {
  await initializeAdminSettings();
  await initializeAppointmentCache();
  await businessManager.getAllBusinesses({ includeDisabled: true });
}
async function runOnceFromSettings() {
  await initializeScheduler();
  const settings = loadAdminSettings();
  if (settings.scraping.enabled === false || settings.scraping.scheduledScrapingEnabled === false) return { success: false, skipped: true };
  return runScrapeOnce([]);
}
function getEnabledClusterIds(settings) {
  return Object.keys(settings.clusters || {}).filter(isClusterEnabled);
}
async function startScheduler() {
  await initializeScheduler();
  const settings = loadAdminSettings();
  if (settings.scraping.enabled === false || settings.scraping.scheduledScrapingEnabled === false) return;
  const clusterIds = getEnabledClusterIds(settings);
  const schedule = (args, minutes) => { runScrapeOnce(args); setInterval(() => runScrapeOnce(args), minutes * 60000); };
  if (!clusterIds.length) return schedule([], settings.scraping.defaultIntervalMinutes || 15);
  clusterIds.forEach((id) => schedule([`--cluster=${id}`], getClusterIntervalMinutes(id)));
}
async function runCli() { process.argv.includes("--once") ? await runOnceFromSettings() : await startScheduler(); }
if (require.main === module) runCli().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { runScrapeOnce, runOnceFromSettings, startScheduler, initializeScheduler };