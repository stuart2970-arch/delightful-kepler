-- STYL-265: business on/off controls for enquiry details (#41) and booking confirmation (#45).
-- Both default on so existing sends keep going. Additive and idempotent.
-- Use this on the local Supabase CLI stack for development and tests.
-- Stuart applies this named migration to staging. Do not apply it to the live project from a developer machine.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS enquiry_details_email_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS booking_confirmation_email_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tenants.enquiry_details_email_enabled IS
  'STYL-265 #41. False stops enquiry-details emails. Default on.';

COMMENT ON COLUMN public.tenants.booking_confirmation_email_enabled IS
  'STYL-265 #45. False stops booking confirmation emails to the customer. Default on.';
