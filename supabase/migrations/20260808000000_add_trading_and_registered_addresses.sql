-- Migration: Add trading and registered office addresses to tenants table
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS trading_address_street text,
  ADD COLUMN IF NOT EXISTS trading_address_city text,
  ADD COLUMN IF NOT EXISTS trading_address_postcode text,
  ADD COLUMN IF NOT EXISTS trading_address_phone text,
  ADD COLUMN IF NOT EXISTS company_registration_number text,
  ADD COLUMN IF NOT EXISTS registered_address_street text,
  ADD COLUMN IF NOT EXISTS registered_address_city text,
  ADD COLUMN IF NOT EXISTS registered_address_postcode text,
  ADD COLUMN IF NOT EXISTS is_registered_company boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS registered_address_same_as_trading boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS rwg_address_same_as_trading boolean DEFAULT true;

-- Seed the new trading address columns using existing Reserve with Google details
-- Also map registered_address_same_as_trading from the legacy is_registered_business_address checkbox
UPDATE public.tenants
SET 
  trading_address_street = COALESCE(rwg_street_address, ''),
  trading_address_city = COALESCE(rwg_city, ''),
  trading_address_postcode = COALESCE(rwg_postcode, ''),
  trading_address_phone = COALESCE(rwg_phone, ''),
  registered_address_same_as_trading = COALESCE(is_registered_business_address, true);
