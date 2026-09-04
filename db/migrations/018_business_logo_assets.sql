BEGIN;

CREATE TABLE IF NOT EXISTS business_assets (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_bytes BYTEA NOT NULL,
  byte_size INTEGER NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT business_assets_business_type_unique
    UNIQUE (business_id, asset_type),

  CONSTRAINT business_assets_supported_type_check
    CHECK (asset_type = 'logo'),

  CONSTRAINT business_assets_logo_content_type_check
    CHECK (
      content_type IN (
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/gif'
      )
    ),

  CONSTRAINT business_assets_logo_size_check
    CHECK (byte_size BETWEEN 1 AND 3145728),

  CONSTRAINT business_assets_logo_bytes_match_check
    CHECK (octet_length(file_bytes) = byte_size)
);

CREATE INDEX IF NOT EXISTS business_assets_lookup_idx
  ON business_assets (business_id, asset_type);

COMMIT;