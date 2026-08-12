-- NextAppt manual inventory admin support
-- Safe to run more than once.
-- Default behavior remains scraper-authoritative: manual rows are replaceable unless explicitly protected.

ALTER TABLE appointment_inventory
  ADD COLUMN IF NOT EXISTS scrape_overwrite_protected BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_inventory_scrape_overwrite_protected
  ON appointment_inventory (
    business_service_id,
    local_date,
    local_time
  )
  WHERE scrape_overwrite_protected = TRUE;

CREATE INDEX IF NOT EXISTS idx_inventory_manual_admin
  ON appointment_inventory (
    business_service_id,
    local_date,
    local_time
  )
  WHERE inventory_reason = 'manual_admin';