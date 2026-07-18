BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE business_integrations
    ADD COLUMN IF NOT EXISTS name TEXT;

ALTER TABLE business_integrations
    ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100;

ALTER TABLE business_integrations
    ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE business_integrations
    ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE business_integrations
    ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE business_integrations
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE business_integrations
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE business_integrations
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS business_integrations_business_enabled_idx
    ON business_integrations (business_id, enabled);

CREATE UNIQUE INDEX IF NOT EXISTS business_integrations_one_default_idx
    ON business_integrations (business_id)
    WHERE is_default = TRUE
      AND enabled = TRUE;

ALTER TABLE business_services
    ADD COLUMN IF NOT EXISTS integration_id BIGINT
    REFERENCES business_integrations(id)
    ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS app_settings (
    settings_key TEXT PRIMARY KEY,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (settings_key, settings)
VALUES ('admin', '{}'::jsonb)
ON CONFLICT (settings_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS scrape_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    selector JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scrape_group_businesses (
    group_id UUID NOT NULL
        REFERENCES scrape_groups(id)
        ON DELETE CASCADE,
    business_id BIGINT NOT NULL
        REFERENCES businesses(id)
        ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, business_id)
);

CREATE TABLE IF NOT EXISTS scrape_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    timezone TEXT NOT NULL DEFAULT 'America/Chicago',
    group_id UUID
        REFERENCES scrape_groups(id)
        ON DELETE SET NULL,
    business_id BIGINT
        REFERENCES businesses(id)
        ON DELETE CASCADE,
    calendar_rules JSONB NOT NULL DEFAULT
        '{"daysOfWeek":["MO","TU","WE","TH","FR","SA","SU"],"times":["00:00"]}'::jsonb,
    scrape_options JSONB NOT NULL DEFAULT '{}'::jsonb,
    next_run_at TIMESTAMPTZ,
    last_evaluated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schedule_has_target
        CHECK (
            group_id IS NOT NULL
            OR business_id IS NOT NULL
        )
);

CREATE INDEX IF NOT EXISTS scrape_schedules_due_idx
    ON scrape_schedules (enabled, next_run_at);

CREATE TABLE IF NOT EXISTS scrape_schedule_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL
        REFERENCES scrape_schedules(id)
        ON DELETE CASCADE,
    exception_date DATE NOT NULL,
    action TEXT NOT NULL DEFAULT 'skip'
        CHECK (action IN ('skip','run','override')),
    override_time TIME,
    reason TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (schedule_id, exception_date)
);

CREATE TABLE IF NOT EXISTS scrape_schedule_locks (
    schedule_id UUID NOT NULL
        REFERENCES scrape_schedules(id)
        ON DELETE CASCADE,
    occurrence_key TEXT NOT NULL,
    locked_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (schedule_id, occurrence_key)
);

CREATE INDEX IF NOT EXISTS scrape_schedule_locks_expiry_idx
    ON scrape_schedule_locks (locked_until);

CREATE TABLE IF NOT EXISTS scrape_schedule_history (
    id BIGSERIAL PRIMARY KEY,
    schedule_id UUID
        REFERENCES scrape_schedules(id)
        ON DELETE SET NULL,
    occurrence_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'started',
    businesses_selected INTEGER NOT NULL DEFAULT 0,
    jobs_built INTEGER NOT NULL DEFAULT 0,
    jobs_rejected INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (schedule_id, occurrence_key)
);

CREATE INDEX IF NOT EXISTS scrape_schedule_history_started_idx
    ON scrape_schedule_history (started_at DESC);

COMMIT;