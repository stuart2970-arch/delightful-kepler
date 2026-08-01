-- Migration to add twilio_shadow_number to tenants table
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS twilio_shadow_number text UNIQUE;
