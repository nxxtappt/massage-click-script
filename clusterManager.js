const fs = require("fs");
const path = require("path");

const {
  isClusterEnabled,
  shouldSkipVagaroDiscovery
} = require("./adminSettingsManager");

const CLUSTERS_DIR = path.join(__dirname, "clusters");

function ensureClustersDir() {
  if (!fs.existsSync(CLUSTERS_DIR)) {
    fs.mkdirSync(CLUSTERS_DIR, { recursive: true });
  }
}

function loadCluster(clusterId) {
  ensureClustersDir();

  const filePath = path.join(CLUSTERS_DIR, `${clusterId}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Cluster file not found: ${filePath}`);
  }

  const cluster = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!isClusterEnabled(cluster.clusterId || clusterId)) {
    return {
      ...cluster,
      enabled: false
    };
  }

  return cluster;
}

function loadAllClusters() {
  ensureClustersDir();

  return fs
    .readdirSync(CLUSTERS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const fullPath = path.join(CLUSTERS_DIR, file);
      return JSON.parse(fs.readFileSync(fullPath, "utf8"));
    })
    .filter((cluster) => cluster.enabled !== false)
    .filter((cluster) => isClusterEnabled(cluster.clusterId));
}

function buildFiltersFromClusterRule(cluster, rule = {}) {
  const filters = {
    latitude: cluster.center.latitude,
    longitude: cluster.center.longitude,
    maxDistanceMiles:
      rule.maxDistanceMiles ||
      cluster.defaultFilters?.maxDistanceMiles ||
      cluster.radiusMiles,

    durationMinutes: rule.durationMinutes || undefined,
    priority: rule.servicePriority || rule.priority || undefined,
    serviceType: rule.serviceType || undefined,

    ttlMinutes: rule.ttlMinutes || undefined,
    skipVagaroDiscovery: true
  };

  filters.skipVagaroDiscovery = shouldSkipVagaroDiscovery(filters);

  return filters;
}

module.exports = {
  loadCluster,
  loadAllClusters,
  buildFiltersFromClusterRule
};