"use strict";
const db = require("../db");

async function query(text, params = []) {
  if (typeof db.query !== "function") throw new Error("Database query function is unavailable.");
  return db.query(text, params);
}

async function resolveInternalBusinessId(idOrName) {
  const { rows } = await query(`SELECT id FROM businesses WHERE business_id=$1 OR business_name=$1 OR id::text=$1 LIMIT 1`, [String(idOrName)]);
  return rows[0]?.id || null;
}

async function syncBusinessIntegrations(idOrName, integrations = []) {
  const businessId = await resolveInternalBusinessId(idOrName);
  if (!businessId) throw new Error("Business not found while saving integrations.");
  const keepIds = [];
  for (const item of integrations) {
    const id = /^\d+$/.test(String(item.id || item.integrationId || "")) ? Number(item.id || item.integrationId) : null;
    const { rows } = await query(`INSERT INTO business_integrations (id, business_id, name, platform, integration_type, api_provider, credential_id, status, enabled, priority, is_default, config, capabilities, raw_json, updated_at) VALUES (COALESCE($1, nextval(pg_get_serial_sequence('business_integrations','id'))),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, platform=EXCLUDED.platform, integration_type=EXCLUDED.integration_type, api_provider=EXCLUDED.api_provider, credential_id=EXCLUDED.credential_id, status=EXCLUDED.status, enabled=EXCLUDED.enabled, priority=EXCLUDED.priority, is_default=EXCLUDED.is_default, config=EXCLUDED.config, capabilities=EXCLUDED.capabilities, raw_json=EXCLUDED.raw_json, updated_at=NOW() RETURNING id`, [id, businessId, item.name || "", item.platform || "", item.integrationType || "scrape", item.apiProvider || "", item.credentialId || "", item.status || "active", item.enabled !== false, Number(item.priority || 100), item.isDefault === true, JSON.stringify(item.config || {}), JSON.stringify(item.capabilities || []), JSON.stringify(item.rawJson || {})]);
    keepIds.push(rows[0].id);
  }
  if (keepIds.length) {
    await query(`DELETE FROM business_integrations WHERE business_id=$1 AND NOT (id = ANY($2::bigint[]))`, [businessId, keepIds]);
  } else {
    await query(`DELETE FROM business_integrations WHERE business_id=$1`, [businessId]);
  }
  return keepIds;
}

module.exports = { syncBusinessIntegrations, resolveInternalBusinessId };