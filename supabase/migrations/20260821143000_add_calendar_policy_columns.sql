-- Migration: Add Advanced Calendar Policy Columns to Tenants Table
ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS flexible_breaks BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS is_24_7 BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS open_public_holidays BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS max_advance_weeks INTEGER DEFAULT 12,
ADD COLUMN IF NOT EXISTS operating_hours_overrides JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS holiday_settings JSONB DEFAULT '{}'::jsonb;

-- Reload Supabase PostgREST schema cache
NOTIFY pgrst, 'reload schema';
