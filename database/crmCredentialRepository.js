"use strict";
const crypto = require("crypto");
const db = require("../db");
const { encryptCredential, decryptCredential } = require("../crmCredentialVault");

async function getConnectionStatus(publicBusinessId) {
  const { rows } = await db.query(
    `SELECT i.api_provider AS provider, i.credential_id AS "credentialId",
            c.verified_at AS "verifiedAt",
            (c.credential_id IS NOT NULL AND c.status = 'active') AS connected
       FROM businesses b
       LEFT JOIN LATERAL (
         SELECT * FROM business_integrations
         WHERE business_id = b.id AND enabled IS NOT FALSE
         ORDER BY is_default DESC, priority ASC, id ASC LIMIT 1
       ) i ON TRUE
       LEFT JOIN crm_credentials c
         ON c.business_id = b.id AND c.credential_id = i.credential_id
      WHERE b.business_id = $1 LIMIT 1`,
    [publicBusinessId]
  );
  return rows[0] || { connected: false, provider: null, credentialId: null };
}

async function readCredential(credentialId, businessNameOrId) {
  const { rows } = await db.query(
    `SELECT c.encrypted_value AS "encryptedValue", c.iv, c.auth_tag AS "authTag",
            c.key_version AS "keyVersion", c.metadata, c.provider,
            b.business_id AS "publicBusinessId"
       FROM crm_credentials c
       JOIN businesses b ON b.id = c.business_id
       JOIN business_integrations i ON i.business_id = b.id
         AND i.credential_id = c.credential_id AND i.enabled IS NOT FALSE
         AND i.integration_type = 'api'
      WHERE c.credential_id = $1 AND c.status = 'active'
        AND (b.business_id = $2 OR LOWER(b.business_name) = LOWER($2))
      LIMIT 1`,
    [credentialId, businessNameOrId]
  );
  const row = rows[0];
  if (!row) throw new Error("No active CRM credential belongs to this business and integration.");
  return {
    provider: row.provider,
    apiKey: decryptCredential(row, {
      credentialId,
      publicBusinessId: row.publicBusinessId,
      provider: row.provider
    }),
    metadata: row.metadata || {}
  };
}

async function promoteVerifiedCredential({ publicBusinessId, provider, apiKey, metadata }) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const businessResult = await client.query(
      "SELECT id, business_id FROM businesses WHERE business_id=$1 FOR UPDATE",
      [publicBusinessId]
    );
    const business = businessResult.rows[0];
    if (!business) throw new Error("Business does not exist in PostgreSQL.");

    const currentResult = await client.query(
      `SELECT id, credential_id, api_provider
         FROM business_integrations
        WHERE business_id=$1 AND (api_provider=$2 OR platform=$2)
        ORDER BY is_default DESC, priority ASC, id ASC LIMIT 1 FOR UPDATE`,
      [business.id, provider]
    );
    const current = currentResult.rows[0] || null;
    const credentialId = current?.api_provider === provider && current.credential_id
      ? current.credential_id
      : `crm-${crypto.randomUUID()}`;
    const encrypted = encryptCredential(apiKey, {
      credentialId, publicBusinessId: business.business_id, provider
    });
    const stored = await client.query(
      `INSERT INTO crm_credentials
        (credential_id, business_id, provider, encrypted_value, iv, auth_tag,
         key_version, metadata, status, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'active',NOW())
       ON CONFLICT (credential_id) DO UPDATE SET
         encrypted_value=EXCLUDED.encrypted_value, iv=EXCLUDED.iv,
         auth_tag=EXCLUDED.auth_tag, key_version=EXCLUDED.key_version,
         metadata=EXCLUDED.metadata, status='active', verified_at=NOW(), updated_at=NOW()
       WHERE crm_credentials.business_id=EXCLUDED.business_id
         AND crm_credentials.provider=EXCLUDED.provider
       RETURNING credential_id`,
      [credentialId, business.id, provider, encrypted.encryptedValue,
        encrypted.iv, encrypted.authTag, encrypted.keyVersion,
        JSON.stringify(metadata)]
    );
    if (stored.rowCount !== 1) throw new Error("Credential ID belongs to a different business.");

    // Only one default is allowed per business; avoid saveBusinessFull's delete/recreate.
    await client.query(
      "UPDATE business_integrations SET is_default=false WHERE business_id=$1 AND is_default=true",
      [business.id]
    );
    if (current) {
      await client.query(
        `UPDATE business_integrations
            SET platform=$2, api_provider=$2, credential_id=$3,
                integration_type='api', is_default=true, enabled=true,
                status='active', config=COALESCE(config,'{}'::jsonb) || $4::jsonb,
                raw_json=COALESCE(raw_json,'{}'::jsonb) ||
                  jsonb_build_object('credentialId',$3::text,'apiProvider',$2::text,'integrationType','api'),
                updated_at=NOW()
          WHERE id=$1 AND business_id=$5`,
        [current.id, provider, credentialId, JSON.stringify(metadata), business.id]
      );
    } else {
      await client.query(
        `INSERT INTO business_integrations
          (business_id, name, platform, api_provider, credential_id,
           integration_type, is_default, enabled, status, priority, config, raw_json)
         VALUES ($1,$2,$3,$3,$4,'api',true,true,'active',20,$5::jsonb,
           jsonb_build_object('credentialId',$4::text,'apiProvider',$3::text,'integrationType','api'))`,
        [business.id, `${provider} API`, provider, credentialId, JSON.stringify(metadata)]
      );
    }
    await client.query(
      `UPDATE businesses SET platform=$2,
          raw_json=COALESCE(raw_json,'{}'::jsonb) ||
            jsonb_build_object('integrationType','api','apiProvider',$2::text,'credentialId',$3::text),
          updated_at=NOW() WHERE id=$1`,
      [business.id, provider, credentialId]
    );
    await client.query("COMMIT");
    return { credentialId, provider, connected: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { getConnectionStatus, readCredential, promoteVerifiedCredential };
