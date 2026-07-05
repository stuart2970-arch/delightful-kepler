-- Add Booking Mode columns to the tenants table
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS booking_mode text DEFAULT 'single_calendar' CHECK (booking_mode IN ('walk_in_only', 'single_calendar', 'multi_calendar', 'external_platform')),
  ADD COLUMN IF NOT EXISTS booking_url text;
