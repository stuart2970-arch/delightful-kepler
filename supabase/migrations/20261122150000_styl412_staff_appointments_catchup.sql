-- STYL-412: idempotent catch-up for production schema drift.
-- Additive only. No DROP. No UPDATE of existing rows. No data rewrite.
-- Safe to apply on staging (columns already exist) and, later, on production by name.
-- Do not apply with `supabase db push`.

-- Staging migration 20260813120000_multi_colleague_rbac_calendar.sql added these
-- staff columns. Production never received that migration, so /api/staff/me
-- (which filters and updates on user_id, and writes avatar_url / bio) does
-- nothing useful there. Policies from that migration are intentionally not
-- repeated here: recreating them would drop the live policies.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS google_access_token text,
  ADD COLUMN IF NOT EXISTS google_refresh_token text,
  ADD COLUMN IF NOT EXISTS google_token_expiry timestamptz,
  ADD COLUMN IF NOT EXISTS bio text;

CREATE INDEX IF NOT EXISTS idx_staff_user_id ON public.staff(user_id);

-- Appointments reconciliation (22 Nov 2026 production vs staging):
--
-- Production has is_blockout and blockout_reason. No migration in this repo
-- created them; the dashboard already ignores rows where is_blockout is true
-- (ChatbotManagerView). Staging is missing the columns, so this catch-up adds
-- them. On production the ADD is a no-op.
--
-- Nullability is intentionally left alone.
-- Staging (this repo's migrations) requires service_id, customer_name and
-- customer_email. Production allows those to be null. customer_phone is
-- already nullable on both.
-- Setting NOT NULL on production would fail while any null row exists, and
-- filling those nulls would be a data rewrite.
-- Dropping NOT NULL on staging would weaken the booking contract (CreateBooking
-- and the calendar always write those fields) and would be a DROP.
-- New bookings keep writing non-null service_id, customer_name and customer_email.
-- Blockout rows on production may continue to store null customer fields;
-- this migration does not change that.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS is_blockout boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blockout_reason text;

COMMENT ON COLUMN public.appointments.is_blockout IS
  'STYL-412: true for calendar blockouts. Production already had this column; staging catch-up. Default false does not rewrite existing booking rows.';

COMMENT ON COLUMN public.appointments.blockout_reason IS
  'STYL-412: optional reason for a blockout row. Nullable. No backfill.';
