-- STYL-248 / STYL-230: Stripe catalog shape on addon_catalog (schema + flags only).
-- Stripe price/product ids are environment-specific — set in superadmin or local seed.sql.

ALTER TABLE public.addon_catalog
  ADD COLUMN IF NOT EXISTS stripe_product_id TEXT;

COMMENT ON COLUMN public.addon_catalog.stripe_product_id IS
  'Stripe Product id for sliding-scale and one-off pack checkout (price_data.product). Not a per-step price id.';

UPDATE public.addon_catalog
SET
  is_sliding = false,
  max_price_pence = COALESCE(max_price_pence, monthly_price_pence)
WHERE id IN (
  'data_pack_500',
  'google_calendar_addon',
  'microsoft_calendar_addon',
  'remove_styleflo_branding'
);