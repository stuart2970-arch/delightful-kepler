-- STYL-275, STYL-276, STYL-277. Account closure hold.
-- Data and the StyleFlo number are kept for 31 days after the account closes,
-- then deleted and released on the same day. The earlier 30-day wording is
-- replaced. Dashboard retention (20261123120000_retention_setting.sql) stays
-- 365 days for account records and 90 days for messages. This file does not
-- edit that migration.
-- Additive and idempotent. Apply on the local Supabase CLI stack only.
-- The app ignores this table until FAILED_PAYMENT_FLOW_ENABLED=true.

ALTER TABLE public.tenant_phone_number_purchases
  DROP CONSTRAINT IF EXISTS tenant_phone_number_purchases_status_check;

ALTER TABLE public.tenant_phone_number_purchases
  ADD CONSTRAINT tenant_phone_number_purchases_status_check
  CHECK (status IN ('pending', 'active', 'orphan', 'unknown', 'held', 'released'));

CREATE TABLE IF NOT EXISTS public.account_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('trial_ended', 'plan_cancelled', 'failed_payment')),
  source_key text NOT NULL,
  closed_at timestamptz NOT NULL,
  shadow_number text,
  mobile_number text,
  number_state text NOT NULL DEFAULT 'none'
    CHECK (number_state IN ('none', 'held', 'released')),
  reminder_sent_at timestamptz,
  deleted_at timestamptz,
  released_at timestamptz,
  confirmation_sent_at timestamptz,
  reopened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT account_closures_source_key UNIQUE (source_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS account_closures_open_tenant_idx
  ON public.account_closures (tenant_id)
  WHERE reopened_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS account_closures_due_idx
  ON public.account_closures (closed_at)
  WHERE reopened_at IS NULL AND deleted_at IS NULL;

ALTER TABLE public.account_closures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.account_closures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_closures TO postgres, service_role;

COMMENT ON TABLE public.account_closures IS
  'STYL-275/276/277. One closure holds salon data and any StyleFlo number for 31 days. Reopening before deletion day cancels both. Port-out is handled by hand and is not recorded here.';

COMMENT ON COLUMN public.tenant_phone_number_purchases.status IS
  'pending, active, orphan, unknown, held (account closed, number not released), or released.';
