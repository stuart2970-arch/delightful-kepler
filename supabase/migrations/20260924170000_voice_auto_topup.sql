-- Migration: Voice pack as one-off purchase and Auto Top-up configuration
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS voice_auto_topup BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS voice_auto_topup_threshold INTEGER DEFAULT 10,
ADD COLUMN IF NOT EXISTS voice_auto_topup_amount INTEGER DEFAULT 20,
ADD COLUMN IF NOT EXISTS voice_auto_topup_price_pence INTEGER DEFAULT 1500;

-- Update addon_catalog description for voice packs to clarify one-off validity
UPDATE public.addon_catalog
SET description = 'One-off voice minutes pack. Purchased minutes remain active for 3 months from purchase date.'
WHERE category = 'voice_pack';
