const crypto = require("crypto");

const db = require("./db");

const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const LOGO_ASSET_TYPE = "logo";
const SUPPORTED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertLogoInput({ buffer, contentType }) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1) {
    throw createHttpError("The uploaded logo file is empty.", 400);
  }

  if (buffer.length > MAX_LOGO_BYTES) {
    throw createHttpError("Logo file is too large. Maximum size is 3MB.", 413);
  }

  if (!SUPPORTED_CONTENT_TYPES.has(contentType)) {
    throw createHttpError("Unsupported logo file type.", 400);
  }
}

async function resolveBusinessForUpdate(client, idOrBusinessName) {
  const value = String(idOrBusinessName || "").trim();

  if (!value) {
    return null;
  }

  const result = await client.query(
    `
      SELECT id, business_id, business_name, logo_alt
      FROM businesses
      WHERE id::text = $1
         OR lower(business_id) = lower($1)
         OR lower(business_name) = lower($1)
         OR lower(display_name) = lower($1)
         OR lower(
              regexp_replace(
                regexp_replace(business_name, '&', ' and ', 'g'),
                '[^a-zA-Z0-9]+',
                '-',
                'g'
              )
            ) = lower($1)
      ORDER BY
        CASE
          WHEN lower(business_id) = lower($1) THEN 0
          WHEN id::text = $1 THEN 1
          ELSE 2
        END
      LIMIT 1
      FOR UPDATE
    `,
    [value]
  );

  return result.rows[0] || null;
}

async function saveBusinessLogoAsset(
  idOrBusinessName,
  { buffer, contentType, logoAlt = "" } = {}
) {
  assertLogoInput({ buffer, contentType });

  if (!db.pool || typeof db.pool.connect !== "function") {
    throw createHttpError("Database connection is unavailable.", 503);
  }

  const checksumSha256 = crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
  const version = checksumSha256.slice(0, 16);
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const business = await resolveBusinessForUpdate(
      client,
      idOrBusinessName
    );

    if (!business) {
      throw createHttpError("Business not found.", 404);
    }

    const publicBusinessId = business.business_id;
    const logoUrl =
      `/api/business-dashboard/logo/${encodeURIComponent(publicBusinessId)}` +
      `?v=${version}`;
    const resolvedLogoAlt =
      String(logoAlt || "").trim() ||
      business.logo_alt ||
      `${business.business_name} logo`;

    await client.query(
      `
        INSERT INTO business_assets (
          business_id,
          asset_type,
          content_type,
          file_bytes,
          byte_size,
          checksum_sha256,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT (business_id, asset_type)
        DO UPDATE SET
          content_type = EXCLUDED.content_type,
          file_bytes = EXCLUDED.file_bytes,
          byte_size = EXCLUDED.byte_size,
          checksum_sha256 = EXCLUDED.checksum_sha256,
          updated_at = NOW()
      `,
      [
        business.id,
        LOGO_ASSET_TYPE,
        contentType,
        buffer,
        buffer.length,
        checksumSha256
      ]
    );

    await client.query(
      `
        UPDATE businesses
        SET
          logo_url = $2,
          logo_alt = $3,
          updated_at = NOW()
        WHERE id = $1
      `,
      [business.id, logoUrl, resolvedLogoAlt]
    );

    await client.query("COMMIT");

    return {
      businessId: publicBusinessId,
      businessName: business.business_name,
      logoUrl,
      logoAlt: resolvedLogoAlt,
      contentType,
      byteSize: buffer.length,
      checksumSha256,
      version
    };
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "42P01") {
      throw createHttpError(
        "Persistent logo storage is not installed. Run migration 018_business_logo_assets.sql.",
        503
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

async function getBusinessLogoAsset(publicBusinessId) {
  const value = String(publicBusinessId || "").trim();

  if (!value) {
    return null;
  }

  try {
    const result = await db.query(
      `
        SELECT
          ba.content_type,
          ba.file_bytes,
          ba.byte_size,
          ba.checksum_sha256,
          ba.updated_at,
          b.business_id,
          b.business_name
        FROM business_assets ba
        INNER JOIN businesses b ON b.id = ba.business_id
        WHERE lower(b.business_id) = lower($1)
          AND ba.asset_type = $2
        LIMIT 1
      `,
      [value, LOGO_ASSET_TYPE]
    );

    return result.rows[0] || null;
  } catch (error) {
    if (error.code === "42P01") {
      return null;
    }

    throw error;
  }
}

module.exports = {
  MAX_LOGO_BYTES,
  SUPPORTED_CONTENT_TYPES,
  saveBusinessLogoAsset,
  getBusinessLogoAsset
};