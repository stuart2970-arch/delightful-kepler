-- Migration: Add twilio_mobile_number column to public.tenants
-- Allows storing dedicated mobile numbers independently from local landline numbers (twilio_shadow_number)

ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS twilio_mobile_number TEXT;
