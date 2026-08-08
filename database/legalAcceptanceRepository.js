const db = require("../db");

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

async function getCurrentPolicies() {
  const result = await db.query(
    `SELECT
       policy_type AS "policyType",
       version,
       effective_at AS "effectiveAt",
       public_path AS "publicPath",
       content_sha256 AS "contentSha256"
     FROM legal_policy_versions
     WHERE is_current = TRUE
       AND policy_type IN ('terms', 'privacy')`
  );

  const policies = {};

  for (const row of result.rows) {
    policies[row.policyType] = row;
  }

  if (!policies.terms || !policies.privacy) {
    throw new Error(
      "Current Terms and Privacy policy versions are not configured."
    );
  }

  return policies;
}

async function resolveBusinessNumericId({
  businessId = "",
  businessName = "",
  email = ""
} = {}) {
  const idText = String(businessId || "").trim();
  const nameText = String(businessName || "").trim();
  const emailText = normalizeEmail(email);

  const result = await db.query(
    `SELECT id
     FROM businesses
     WHERE
       ($1 <> '' AND (id::text = $1 OR COALESCE(business_id, '') = $1))
       OR ($2 <> '' AND LOWER(COALESCE(business_name, '')) = LOWER($2))
       OR (
         $3 <> '' AND (
           LOWER(COALESCE(owner_email, '')) = $3
           OR LOWER(COALESCE(claimed_by_email, '')) = $3
           OR LOWER(COALESCE(email, '')) = $3
         )
       )
     ORDER BY
       CASE
         WHEN $1 <> '' AND (id::text = $1 OR COALESCE(business_id, '') = $1) THEN 1
         WHEN $2 <> '' AND LOWER(COALESCE(business_name, '')) = LOWER($2) THEN 2
         ELSE 3
       END,
       id ASC
     LIMIT 1`,
    [idText, nameText, emailText]
  );

  return result.rows[0]?.id || null;
}

async function hasCurrentConsumerAcceptance(userId) {
  const policies = await getCurrentPolicies();

  const result = await db.query(
    `SELECT id
     FROM legal_acceptances
     WHERE subject_type = 'consumer_user'
       AND user_id = $1
       AND terms_version = $2
       AND privacy_version = $3
     LIMIT 1`,
    [userId, policies.terms.version, policies.privacy.version]
  );

  return Boolean(result.rows[0]);
}

async function hasCurrentBusinessAcceptance({
  businessId = "",
  businessName = "",
  email = ""
} = {}) {
  const numericBusinessId = await resolveBusinessNumericId({
    businessId,
    businessName,
    email
  });

  if (!numericBusinessId) return false;

  const policies = await getCurrentPolicies();

  const result = await db.query(
    `SELECT id
     FROM legal_acceptances
     WHERE subject_type = 'business_user'
       AND business_id = $1
       AND LOWER(accepted_by_email) = $2
       AND terms_version = $3
       AND privacy_version = $4
     LIMIT 1`,
    [
      numericBusinessId,
      normalizeEmail(email),
      policies.terms.version,
      policies.privacy.version
    ]
  );

  return Boolean(result.rows[0]);
}

async function recordConsumerAcceptance({
  userId,
  email,
  acceptanceText,
  source = "consumer_account_login",
  ipAddress = null,
  userAgent = null,
  requestId = null,
  metadata = {}
}) {
  const policies = await getCurrentPolicies();

  const insertResult = await db.query(
    `INSERT INTO legal_acceptances (
       subject_type,
       user_id,
       business_id,
       accepted_by_email,
       terms_version,
       privacy_version,
       terms_content_sha256,
       privacy_content_sha256,
       terms_accepted,
       privacy_acknowledged,
       age_18_confirmed,
       business_authority_confirmed,
       acceptance_text,
       acceptance_method,
       source,
       ip_address,
       user_agent,
       request_id,
       metadata
     )
     VALUES (
       'consumer_user',
       $1,
       NULL,
       $2,
       $3,
       $4,
       $5,
       $6,
       TRUE,
       TRUE,
       TRUE,
       FALSE,
       $7,
       'clickwrap',
       $8,
       $9::inet,
       $10,
       $11,
       $12::jsonb
     )
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      userId,
      normalizeEmail(email),
      policies.terms.version,
      policies.privacy.version,
      policies.terms.contentSha256,
      policies.privacy.contentSha256,
      acceptanceText,
      source,
      ipAddress,
      userAgent,
      requestId,
      JSON.stringify(metadata || {})
    ]
  );

  if (insertResult.rows[0]) {
    return insertResult.rows[0];
  }

  const existing = await db.query(
    `SELECT *
     FROM legal_acceptances
     WHERE subject_type = 'consumer_user'
       AND user_id = $1
       AND terms_version = $2
       AND privacy_version = $3
     ORDER BY accepted_at DESC
     LIMIT 1`,
    [userId, policies.terms.version, policies.privacy.version]
  );

  return existing.rows[0] || null;
}

async function recordBusinessAcceptance({
  businessId,
  businessName,
  email,
  acceptanceText,
  source = "business_account_login",
  ipAddress = null,
  userAgent = null,
  requestId = null,
  metadata = {}
}) {
  const numericBusinessId = await resolveBusinessNumericId({
    businessId,
    businessName,
    email
  });

  if (!numericBusinessId) {
    throw new Error(
      "Could not match this verified business session to a PostgreSQL business record."
    );
  }

  const policies = await getCurrentPolicies();

  const insertResult = await db.query(
    `INSERT INTO legal_acceptances (
       subject_type,
       user_id,
       business_id,
       accepted_by_email,
       terms_version,
       privacy_version,
       terms_content_sha256,
       privacy_content_sha256,
       terms_accepted,
       privacy_acknowledged,
       age_18_confirmed,
       business_authority_confirmed,
       acceptance_text,
       acceptance_method,
       source,
       ip_address,
       user_agent,
       request_id,
       metadata
     )
     VALUES (
       'business_user',
       NULL,
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       TRUE,
       TRUE,
       TRUE,
       TRUE,
       $7,
       'clickwrap',
       $8,
       $9::inet,
       $10,
       $11,
       $12::jsonb
     )
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      numericBusinessId,
      normalizeEmail(email),
      policies.terms.version,
      policies.privacy.version,
      policies.terms.contentSha256,
      policies.privacy.contentSha256,
      acceptanceText,
      source,
      ipAddress,
      userAgent,
      requestId,
      JSON.stringify(metadata || {})
    ]
  );

  if (insertResult.rows[0]) {
    return insertResult.rows[0];
  }

  const existing = await db.query(
    `SELECT *
     FROM legal_acceptances
     WHERE subject_type = 'business_user'
       AND business_id = $1
       AND LOWER(accepted_by_email) = $2
       AND terms_version = $3
       AND privacy_version = $4
     ORDER BY accepted_at DESC
     LIMIT 1`,
    [
      numericBusinessId,
      normalizeEmail(email),
      policies.terms.version,
      policies.privacy.version
    ]
  );

  return existing.rows[0] || null;
}

async function listAcceptanceHistory({
  userId = null,
  businessId = null,
  email = ""
} = {}) {
  const clauses = [];
  const values = [];

  if (userId) {
    values.push(userId);
    clauses.push(`user_id = $${values.length}`);
  }

  if (businessId) {
    values.push(businessId);
    clauses.push(`business_id = $${values.length}`);
  }

  if (email) {
    values.push(normalizeEmail(email));
    clauses.push(`LOWER(accepted_by_email) = $${values.length}`);
  }

  if (!clauses.length) return [];

  const result = await db.query(
    `SELECT
       id,
       subject_type AS "subjectType",
       user_id AS "userId",
       business_id AS "businessId",
       accepted_by_email AS "acceptedByEmail",
       terms_version AS "termsVersion",
       privacy_version AS "privacyVersion",
       acceptance_method AS "acceptanceMethod",
       source,
       ip_address::text AS "ipAddress",
       user_agent AS "userAgent",
       accepted_at AS "acceptedAt"
     FROM legal_acceptances
     WHERE ${clauses.join(" OR ")}
     ORDER BY accepted_at DESC`,
    values
  );

  return result.rows;
}

module.exports = {
  getCurrentPolicies,
  resolveBusinessNumericId,
  hasCurrentConsumerAcceptance,
  hasCurrentBusinessAcceptance,
  recordConsumerAcceptance,
  recordBusinessAcceptance,
  listAcceptanceHistory
};