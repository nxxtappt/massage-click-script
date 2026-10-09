-- Only new analytics-owned objects. No triggers or changes to operational tables.
CREATE TABLE IF NOT EXISTS market_analytics_runs (
 id bigserial PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('daily','forward','backfill')),
 snapshot_date date NOT NULL,
 timezone text NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL CHECK (status IN ('complete','missed')),
 definition_version integer NOT NULL DEFAULT 1,
 note text NOT NULL,
 UNIQUE(kind,snapshot_date,timezone)
);
CREATE TABLE IF NOT EXISTS market_analytics_totals (
 run_id bigint NOT NULL REFERENCES market_analytics_runs(id) ON DELETE CASCADE,
 appointment_date date NOT NULL,
 city text NOT NULL,
 state text NOT NULL,
 industry text NOT NULL,
 confirmed_cards bigint NOT NULL,
 inferred_only_cards bigint NOT NULL,
 unknown_source_cards bigint NOT NULL,
 total_cards bigint NOT NULL,
 businesses_with_cards bigint NOT NULL,
 raw_rows bigint NOT NULL,
 PRIMARY KEY(run_id,appointment_date,city,state,industry)
);
CREATE INDEX IF NOT EXISTS market_analytics_totals_date_idx ON market_analytics_totals(appointment_date,city,industry);
CREATE TABLE IF NOT EXISTS market_analytics_worker_state (
 worker_key text PRIMARY KEY,
 heartbeat_at timestamptz NOT NULL,
 last_error text
);
