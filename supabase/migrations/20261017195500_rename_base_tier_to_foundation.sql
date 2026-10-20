-- =========================================================================
-- 20261017195500_rename_base_tier_to_foundation.sql
-- Renames the starter/basic base tier to Foundation Subscription
-- =========================================================================

-- 1. Update the display name of base_tier to Foundation Subscription
UPDATE public.subscription_tiers
SET name = 'Foundation Subscription'
WHERE id = 'base_tier';

-- 2. Insert 'foundation' as an alias in subscription_tiers for backward & forward compatibility
INSERT INTO public.subscription_tiers (id, name, monthly_price, yearly_price, is_active)
VALUES ('foundation', 'Foundation Subscription', 9.99, 99.90, true)
ON CONFLICT (id) DO UPDATE SET
    name = 'Foundation Subscription',
    monthly_price = 9.99,
    yearly_price = 99.90,
    is_active = true;

-- 3. Copy/Mirror tier entitlements from base_tier to foundation
INSERT INTO public.tier_entitlements (tier_id, feature_id, limit_value)
SELECT 'foundation', feature_id, limit_value
FROM public.tier_entitlements
WHERE tier_id = 'base_tier'
ON CONFLICT (tier_id, feature_id) DO UPDATE SET
    limit_value = EXCLUDED.limit_value;

-- 4. Log the rename to addon_audit_log
INSERT INTO public.addon_audit_log (action, old_value, new_value, summary)
VALUES (
    'base_tier_updated',
    '{"previous_names": ["Base Subscription", "Basic", "Starter"]}'::jsonb,
    '{"name": "Foundation Subscription", "alias_id": "foundation"}'::jsonb,
    'Renamed the starter/basic package to Foundation Subscription'
);
