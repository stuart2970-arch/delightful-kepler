-- STYL-248 / STYL-230: Stripe catalog ids on addon_catalog; flat bolt-ons use stripe_price_id.

ALTER TABLE public.addon_catalog
  ADD COLUMN IF NOT EXISTS stripe_product_id TEXT;

COMMENT ON COLUMN public.addon_catalog.stripe_product_id IS
  'Stripe Product id for sliding-scale and one-off pack checkout (price_data.product). Not a per-step price id.';

-- Flat bolt-ons: fixed monthly Stripe Price ids (local/test placeholders — replace in superadmin for live Stripe).
UPDATE public.addon_catalog
SET
  is_sliding = false,
  max_price_pence = COALESCE(max_price_pence, monthly_price_pence),
  stripe_price_id = COALESCE(NULLIF(btrim(stripe_price_id), ''), 'price_local_' || id)
WHERE id IN (
  'data_pack_500',
  'google_calendar_addon',
  'microsoft_calendar_addon',
  'remove_styleflo_branding'
);

-- Sliding / one-off slider bolt-ons: single Stripe Product + checkout price_data.
UPDATE public.addon_catalog
SET
  stripe_product_id = COALESCE(NULLIF(btrim(stripe_product_id), ''), 'prod_local_' || id)
WHERE is_sliding IS TRUE
   OR category IN ('voice_pack', 'sms_pack');