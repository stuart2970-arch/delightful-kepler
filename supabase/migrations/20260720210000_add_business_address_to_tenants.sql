-- Add business address and postcode to tenants table
ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS business_address text,
ADD COLUMN IF NOT EXISTS postcode varchar(50);
