const { loadAdminSettings, isClusterEnabled, shouldSkipVagaroDiscovery } = require("./adminSettingsManager");
function loadCluster(clusterId) {
  const cluster = loadAdminSettings().clusters?.[clusterId];
  if (!cluster) throw new Error(`Cluster not found in PostgreSQL admin settings: ${clusterId}`);
  return { clusterId, ...cluster, enabled: isClusterEnabled(clusterId) && cluster.enabled !== false };
}
function loadAllClusters() {
  const clusters = loadAdminSettings().clusters || {};
  return Object.entries(clusters)
    .map(([clusterId, cluster]) => ({ clusterId, ...cluster }))
    .filter((cluster) => cluster.enabled !== false && isClusterEnabled(cluster.clusterId));
}
function buildFiltersFromClusterRule(cluster, rule = {}) {
  const filters = {
    latitude: cluster.center?.latitude,
    longitude: cluster.center?.longitude,
    maxDistanceMiles: rule.maxDistanceMiles || cluster.defaultFilters?.maxDistanceMiles || cluster.radiusMiles,
    durationMinutes: rule.durationMinutes || undefined,
    priority: rule.servicePriority || rule.priority || undefined,
    serviceType: rule.serviceType || undefined,
    ttlMinutes: rule.ttlMinutes || undefined,
    skipVagaroDiscovery: true
  };
  filters.skipVagaroDiscovery = shouldSkipVagaroDiscovery(filters);
  return filters;
}
module.exports = { loadCluster, loadAllClusters, buildFiltersFromClusterRule };