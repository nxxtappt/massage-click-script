BEGIN;

-- Ensure the existing legacy table has all new PostgreSQL subscription columns.

ALTER TABLE business_subscriptions
  ADD COLUMN IF NOT EXISTS subscription_status TEXT;

ALTER TABLE business_subscriptions
  ADD COLUMN IF NOT EXISTS billing_provider TEXT;

ALTER TABLE business_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

ALTER TABLE business_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

ALTER TABLE business_subscriptions
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE business_subscriptions
  ADD COLUMN IF NOT EXISTS public_profile JSONB;

ALTER TABLE business_subscriptions
  ADD COLUMN IF NOT EXISTS active_deal JSONB;

ALTER TABLE business_subscriptions
  ADD COLUMN IF NOT EXISTS booking_integration JSONB;


-- Migrate values from the legacy schema.

UPDATE business_subscriptions
SET
  plan = COALESCE(NULLIF(plan, ''), 'verified_basic'),

  subscription_status = COALESCE(
    NULLIF(subscription_status, ''),
    NULLIF(status, ''),
    'active'
  ),

  billing_provider = COALESCE(
    NULLIF(billing_provider, ''),
    raw_json ->> 'billingProvider',
    'manual_admin'
  ),

  stripe_customer_id = COALESCE(
    NULLIF(stripe_customer_id, ''),
    raw_json ->> 'stripeCustomerId'
  ),

  stripe_subscription_id = COALESCE(
    NULLIF(stripe_subscription_id, ''),
    raw_json ->> 'stripeSubscriptionId'
  ),

  notes = COALESCE(
    notes,
    raw_json ->> 'notes',
    ''
  ),

  public_profile = COALESCE(
    public_profile,
    raw_json -> 'publicProfile',
    raw_json -> 'businessProfile',
    '{}'::jsonb
  ),

  active_deal = COALESCE(
    active_deal,
    raw_json -> 'activeDeal',
    raw_json -> 'cardPromotion',
    '{}'::jsonb
  ),

  booking_integration = COALESCE(
    booking_integration,
    raw_json -> 'bookingIntegration',
    raw_json -> 'bookingWidget',
    '{}'::jsonb
  ),

  updated_at = COALESCE(updated_at, NOW()),
  created_at = COALESCE(created_at, NOW());


-- Normalize legacy values that do not match the new application rules.

UPDATE business_subscriptions
SET plan = 'verified_basic'
WHERE plan IS NULL
   OR plan NOT IN ('verified_basic', 'premium');

UPDATE business_subscriptions
SET subscription_status = 'active'
WHERE subscription_status IS NULL
   OR subscription_status NOT IN (
     'active',
     'inactive',
     'trialing',
     'past_due',
     'canceled'
   );


-- Resolve missing numeric business IDs using the legacy business_name column.

UPDATE business_subscriptions bs
SET business_id = b.id
FROM businesses b
WHERE bs.business_id IS NULL
  AND LOWER(bs.business_name) = LOWER(b.business_name);


-- Remove legacy subscription rows that cannot be matched to a business.
-- The application requires every subscription to reference businesses.id.

DELETE FROM business_subscriptions
WHERE business_id IS NULL;


-- Remove duplicate subscription rows before adding the unique constraint.
-- Preserve the most recently updated row, using the largest ID as a tiebreaker.

DELETE FROM business_subscriptions older
USING business_subscriptions newer
WHERE older.business_id = newer.business_id
  AND (
    newer.updated_at > older.updated_at
    OR (
      newer.updated_at = older.updated_at
      AND newer.id > older.id
    )
  );


-- Ensure every current business has exactly one subscription record.
-- business_name, status and raw_json remain populated because they are required
-- by the legacy table schema.

INSERT INTO business_subscriptions (
  business_id,
  business_name,
  plan,
  status,
  subscription_status,
  billing_provider,
  notes,
  public_profile,
  active_deal,
  booking_integration,
  raw_json,
  created_at,
  updated_at
)
SELECT
  b.id,
  b.business_name,
  'verified_basic',
  'active',
  'active',
  'manual_admin',
  '',
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  NOW(),
  NOW()
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1
  FROM business_subscriptions bs
  WHERE bs.business_id = b.id
);


-- Add defaults.

ALTER TABLE business_subscriptions
  ALTER COLUMN plan SET DEFAULT 'verified_basic';

ALTER TABLE business_subscriptions
  ALTER COLUMN subscription_status SET DEFAULT 'active';

ALTER TABLE business_subscriptions
  ALTER COLUMN billing_provider SET DEFAULT 'manual_admin';

ALTER TABLE business_subscriptions
  ALTER COLUMN notes SET DEFAULT '';

ALTER TABLE business_subscriptions
  ALTER COLUMN public_profile SET DEFAULT '{}'::jsonb;

ALTER TABLE business_subscriptions
  ALTER COLUMN active_deal SET DEFAULT '{}'::jsonb;

ALTER TABLE business_subscriptions
  ALTER COLUMN booking_integration SET DEFAULT '{}'::jsonb;


-- Existing rows are now populated, so these can safely become NOT NULL.

ALTER TABLE business_subscriptions
  ALTER COLUMN business_id SET NOT NULL;

ALTER TABLE business_subscriptions
  ALTER COLUMN plan SET NOT NULL;

ALTER TABLE business_subscriptions
  ALTER COLUMN subscription_status SET NOT NULL;

ALTER TABLE business_subscriptions
  ALTER COLUMN billing_provider SET NOT NULL;

ALTER TABLE business_subscriptions
  ALTER COLUMN notes SET NOT NULL;

ALTER TABLE business_subscriptions
  ALTER COLUMN public_profile SET NOT NULL;

ALTER TABLE business_subscriptions
  ALTER COLUMN active_deal SET NOT NULL;

ALTER TABLE business_subscriptions
  ALTER COLUMN booking_integration SET NOT NULL;


-- Ensure the business foreign key exists.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_subscriptions_business_id_fkey'
  ) THEN
    ALTER TABLE business_subscriptions
      ADD CONSTRAINT business_subscriptions_business_id_fkey
      FOREIGN KEY (business_id)
      REFERENCES businesses(id)
      ON DELETE CASCADE;
  END IF;
END
$$;


-- Remove the earlier partial unique index, which cannot satisfy
-- ON CONFLICT (business_id).

DROP INDEX IF EXISTS
  idx_business_subscriptions_business_id_unique;


-- Add a real unique constraint so repository upserts using
-- ON CONFLICT (business_id) work correctly.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_subscriptions_business_id_key'
  ) THEN
    ALTER TABLE business_subscriptions
      ADD CONSTRAINT business_subscriptions_business_id_key
      UNIQUE (business_id);
  END IF;
END
$$;


-- Supporting indexes.

CREATE INDEX IF NOT EXISTS
  idx_business_subscriptions_plan
ON business_subscriptions(plan);

CREATE INDEX IF NOT EXISTS
  idx_business_subscriptions_subscription_status
ON business_subscriptions(subscription_status);

COMMIT;