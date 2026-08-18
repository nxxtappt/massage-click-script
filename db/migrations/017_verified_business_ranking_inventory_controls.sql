-- 017_verified_business_ranking_inventory_controls.sql
-- Adds durable admin-controlled public search placement and inventory display controls.

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS verified_rank INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS public_inventory_visible BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS public_inventory_limit INTEGER NOT NULL DEFAULT 4;

UPDATE businesses
SET verified_rank = GREATEST(0, LEAST(100, COALESCE(verified_rank, 0))),
    public_inventory_limit = GREATEST(1, LEAST(20, COALESCE(public_inventory_limit, 4))),
    public_inventory_visible = COALESCE(public_inventory_visible, TRUE);

CREATE INDEX IF NOT EXISTS idx_businesses_verified_public_rank
  ON businesses (verification_status, verified_rank DESC, business_name)
  WHERE enabled = TRUE AND public_inventory_visible = TRUE;

COMMENT ON COLUMN businesses.verified_rank IS
  'Admin-controlled rank from 0-100. Applied only to verified businesses in public search ordering.';
COMMENT ON COLUMN businesses.public_inventory_visible IS
  'When false, this business inventory remains stored/admin-visible but is hidden from public inventoryManager consumers.';
COMMENT ON COLUMN businesses.public_inventory_limit IS
  'Maximum number of appointment-time buttons rendered per business search card. Clamped to 1-20.';

COMMIT;