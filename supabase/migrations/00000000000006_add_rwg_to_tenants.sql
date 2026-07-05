-- Add Reserve with Google specific columns to the tenants table
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS is_rwg_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS rwg_business_name text,
  ADD COLUMN IF NOT EXISTS rwg_street_address text,
  ADD COLUMN IF NOT EXISTS rwg_city text,
  ADD COLUMN IF NOT EXISTS rwg_postcode text,
  ADD COLUMN IF NOT EXISTS rwg_phone text;
