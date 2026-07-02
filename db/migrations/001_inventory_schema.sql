-- NextAppt PostgreSQL Inventory Schema
-- Migration 001
-- Purpose: create the first appointment inventory tables.
-- Phase 1 keeps businesses.json as the source of truth.
CREATE TABLE IF NOT EXISTS scrape_runs (
  id BIGSERIAL PRIMARY KEY,

  run_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_finished_at TIMESTAMPTZ,

  run_status TEXT NOT NULL DEFAULT 'running',
  trigger_type TEXT NOT NULL DEFAULT 'manual',

  business_name TEXT NOT NULL,
  platform TEXT NOT NULL,

  service_name TEXT,
  service_type TEXT,
  duration_minutes INTEGER,

  scrape_start_date DATE,
  scrape_end_date DATE,

  lookahead_hours INTEGER,
  days_forward INTEGER,
  scrape_window_mode TEXT,

  appointments_found INTEGER NOT NULL DEFAULT 0,

  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS raw_scrape_results (
  id BIGSERIAL PRIMARY KEY,

  scrape_run_id BIGINT REFERENCES scrape_runs(id) ON DELETE SET NULL,

  business_name TEXT NOT NULL,
  platform TEXT NOT NULL,

  service_name TEXT,
  service_type TEXT,
  duration_minutes INTEGER,

  scrape_start_date DATE,
  scrape_end_date DATE,

  raw_response_json JSONB NOT NULL,

  response_size_bytes INTEGER,
  scraper_version TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS confirmed_appointments (
  id BIGSERIAL PRIMARY KEY,

  scrape_run_id BIGINT REFERENCES scrape_runs(id) ON DELETE SET NULL,
  raw_scrape_result_id BIGINT REFERENCES raw_scrape_results(id) ON DELETE SET NULL,

  business_name TEXT NOT NULL,
  platform TEXT NOT NULL,

  service_name TEXT,
  service_category TEXT,
  duration_minutes INTEGER,

  provider_name TEXT,

  booking_url TEXT,

  appointment_start TIMESTAMPTZ NOT NULL,
  appointment_end TIMESTAMPTZ,

  local_date DATE,
  local_time TIME,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',

  source_type TEXT NOT NULL DEFAULT 'confirmed',
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS inferred_appointments (
  id BIGSERIAL PRIMARY KEY,

  parent_confirmed_id BIGINT REFERENCES confirmed_appointments(id) ON DELETE CASCADE,

  business_name TEXT NOT NULL,
  platform TEXT NOT NULL,

  service_name TEXT,
  service_category TEXT,
  duration_minutes INTEGER,

  provider_name TEXT,

  booking_url TEXT,

  appointment_start TIMESTAMPTZ NOT NULL,
  appointment_end TIMESTAMPTZ,

  inference_type TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.950,
  inference_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS appointment_inventory (
  id BIGSERIAL PRIMARY KEY,

  appointment_source TEXT NOT NULL, -- confirmed | inferred

  confirmed_id BIGINT REFERENCES confirmed_appointments(id) ON DELETE CASCADE,
  inferred_id BIGINT REFERENCES inferred_appointments(id) ON DELETE CASCADE,

  business_name TEXT NOT NULL,
  platform TEXT NOT NULL,

  service_name TEXT,
  service_category TEXT,
  duration_minutes INTEGER,

  provider_name TEXT,

  booking_url TEXT,

  appointment_start TIMESTAMPTZ NOT NULL,
  appointment_end TIMESTAMPTZ,

  local_date DATE,
  local_time TIME,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',

  confidence NUMERIC(4,3) NOT NULL,

  inventory_reason TEXT,
  inventory_horizon TEXT,

  searchable BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT appointment_inventory_source_check
    CHECK (
      (appointment_source = 'confirmed' AND confirmed_id IS NOT NULL AND inferred_id IS NULL)
      OR
      (appointment_source = 'inferred' AND inferred_id IS NOT NULL AND confirmed_id IS NULL)
    )
);