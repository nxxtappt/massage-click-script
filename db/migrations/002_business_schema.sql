-- NextAppt PostgreSQL Business Schema
-- Migration 002
-- Purpose: move business identity, locations, services, integrations, claims, and subscriptions into PostgreSQL.

CREATE TABLE IF NOT EXISTS businesses (
  id BIGSERIAL PRIMARY KEY,
  business_id TEXT UNIQUE,
  business_name TEXT NOT NULL,
  display_name TEXT,
  business_category TEXT NOT NULL DEFAULT 'wellness',
  platform TEXT,
  booking_url TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,
  owner_email TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unclaimed',
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_by_email TEXT,
  claim_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority TEXT,
  discovery_status TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_locations (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  location_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_services (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  service_type TEXT,
  duration_minutes INTEGER,
  price TEXT,
  platform_service_id TEXT,
  service_button_id TEXT,
  service_id TEXT,
  category_text TEXT,
  provider_text TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority TEXT,
  discovery_status TEXT,
  days_forward INTEGER,
  lookahead_hours INTEGER,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_integrations (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  integration_type TEXT,
  api_provider TEXT,
  credential_id TEXT,
  platform TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_claims (
  id BIGSERIAL PRIMARY KEY,
  claim_id TEXT UNIQUE,
  business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
  business_name TEXT NOT NULL,
  owner_name TEXT,
  email TEXT,
  phone TEXT,
  website TEXT,
  status TEXT NOT NULL DEFAULT 'claimed_pending',
  notes TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT REFERENCES businesses(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  plan TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
