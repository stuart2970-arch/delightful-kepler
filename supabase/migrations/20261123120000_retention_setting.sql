-- STYL-264: dashboard retention. 12 months (365 days) and 90 days.
-- A salon may shorten either period. They may not lengthen it.
-- Additive and idempotent. Apply on the local Supabase CLI stack only.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS account_record_retention_days integer NOT NULL DEFAULT 365;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS message_retention_days integer NOT NULL DEFAULT 90;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenants_account_record_retention_days_check'
      AND conrelid = 'public.tenants'::regclass
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_account_record_retention_days_check
      CHECK (account_record_retention_days BETWEEN 1 AND 365);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenants_message_retention_days_check'
      AND conrelid = 'public.tenants'::regclass
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_message_retention_days_check
      CHECK (message_retention_days BETWEEN 1 AND 90);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_retention_shorten_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.account_record_retention_days > OLD.account_record_retention_days THEN
    RAISE EXCEPTION 'account record retention can only be shortened';
  END IF;
  IF NEW.message_retention_days > OLD.message_retention_days THEN
    RAISE EXCEPTION 'message retention can only be shortened';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_retention_shorten_only ON public.tenants;
CREATE TRIGGER tenants_retention_shorten_only
  BEFORE UPDATE OF account_record_retention_days, message_retention_days
  ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_retention_shorten_only();

COMMENT ON COLUMN public.tenants.account_record_retention_days IS
  'STYL-264 Terms 6A.8(b) and DPA 3.3(b). Maximum 365 days (12 months). Shorten only.';

COMMENT ON COLUMN public.tenants.message_retention_days IS
  'STYL-264 Terms 6A.8(b) and DPA 3.3(b). Maximum 90 days. Shorten only.';
