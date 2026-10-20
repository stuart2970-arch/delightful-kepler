-- Migration: Add sliding scale and capacity columns to addon_catalog for STYL-174
ALTER TABLE public.addon_catalog
ADD COLUMN IF NOT EXISTS max_price_pence INTEGER,
ADD COLUMN IF NOT EXISTS max_voice_minutes INTEGER,
ADD COLUMN IF NOT EXISTS max_sms INTEGER,
ADD COLUMN IF NOT EXISTS is_sliding BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS price_step_pence INTEGER DEFAULT 100;

-- Populate sliding scale configuration based on /superadmin Pricing Matrix specifications
UPDATE public.addon_catalog
SET is_sliding = true, max_price_pence = 1999, max_voice_minutes = 30, price_step_pence = 100
WHERE id = 'landline_addon';

UPDATE public.addon_catalog
SET is_sliding = true, max_price_pence = 1499, max_sms = 250, price_step_pence = 100
WHERE id = 'mobile_addon';

UPDATE public.addon_catalog
SET is_sliding = true, max_price_pence = 5000, max_voice_minutes = 100, price_step_pence = 500
WHERE id = 'voice_pack_20';

UPDATE public.addon_catalog
SET is_sliding = true, max_price_pence = 1499, max_sms = 300, price_step_pence = 100
WHERE id = 'sms_pack_100';

UPDATE public.addon_catalog
SET is_sliding = false, max_price_pence = 499
WHERE id IN ('data_pack_500', 'google_calendar_addon', 'microsoft_calendar_addon');
