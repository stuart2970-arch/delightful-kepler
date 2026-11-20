-- Base-plan Stripe price ids for renewal grant line matching (STYL-315 / OpenClaw).
-- subscription_tiers was created before dynamic_entitlements_v2; stripe_price_id was
-- only on the IF NOT EXISTS branch and never applied to existing databases.

ALTER TABLE public.subscription_tiers
ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

-- foundation and base_tier may share one Stripe base-plan price (tier aliases).
CREATE INDEX IF NOT EXISTS subscription_tiers_stripe_price_id_idx
ON public.subscription_tiers (stripe_price_id)
WHERE stripe_price_id IS NOT NULL;