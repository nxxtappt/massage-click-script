"use strict";
require("dotenv").config();
const { loadAdminSettings } = require("../adminSettingsManager");
const repository = require("../database/schedulerRepository");

async function run() {
  const settings = loadAdminSettings();
  const defaultInterval = Number(settings.scraping?.defaultIntervalMinutes || 15);
  const groups = [];
  for (const [clusterId, cluster] of Object.entries(settings.clusters || {})) {
    const group = await repository.saveGroup({ name: `Legacy ${clusterId}`, description: "Migrated from admin cluster settings", enabled: cluster.enabled !== false, selector: { legacyClusterId: clusterId } });
    groups.push(group);
    await repository.saveSchedule({ name: `Legacy ${clusterId} schedule`, enabled: cluster.enabled !== false && settings.scraping?.scheduledScrapingEnabled !== false, timezone: "America/Chicago", groupId: group.id, calendarRules: { intervalMinutes: Number(cluster.intervalMinutes || defaultInterval), daysOfWeek: ["MO","TU","WE","TH","FR","SA","SU"] }, scrapeOptions: { lookaheadHours: Number(settings.scraping?.defaultLookaheadHours || 48) } });
  }
  console.log(JSON.stringify({ migratedGroups: groups.length }, null, 2));
}
run().catch((error) => { console.error(error); process.exit(1); });