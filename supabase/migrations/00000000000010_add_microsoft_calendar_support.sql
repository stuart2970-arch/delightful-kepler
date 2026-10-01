-- migration: 00000000000010_add_microsoft_calendar_support.sql
-- Description: Schema expansion for Microsoft Outlook Calendar integration

-- 1. Update Staff Table
-- Adds a toggle to determine which API the AI uses, and a column for the Outlook ID
ALTER TABLE public.staff 
ADD COLUMN IF NOT EXISTS calendar_provider text DEFAULT 'google' CHECK (calendar_provider IN ('google', 'microsoft')),
ADD COLUMN IF NOT EXISTS microsoft_calendar_id text;

-- 2. Update Appointments Table
-- Adds a tracking column for Outlook-specific event IDs alongside the existing google_event_id
ALTER TABLE public.appointments
ADD COLUMN IF NOT EXISTS microsoft_event_id text;

-- 3. Update Tenants Table (Optional but recommended for OAuth)
-- If storing refresh tokens at the tenant level rather than the user level
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS microsoft_refresh_token text;
