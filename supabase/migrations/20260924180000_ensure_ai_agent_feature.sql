-- Migration: 20260924180000_ensure_ai_agent_feature.sql
-- Ensure features schema supports value_type and display_order, and ensure ai_agent exists & is enabled across tiers

ALTER TABLE public.features ADD COLUMN IF NOT EXISTS value_type TEXT DEFAULT 'numeric';
ALTER TABLE public.features ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;

-- Ensure ai_agent exists in features table
INSERT INTO public.features (id, category_id, name, is_metered, is_available, value_type, display_order)
VALUES ('ai_agent', 'core_ai', 'AI Agent', false, true, 'boolean', 0)
ON CONFLICT (id) DO UPDATE SET
    name = 'AI Agent',
    is_available = true,
    value_type = 'boolean';

-- Ensure ai_agent is enabled on base_tier and all subscription tiers (1 = Yes / Enabled)
INSERT INTO public.tier_entitlements (tier_id, feature_id, limit_value)
VALUES
    ('base_tier', 'ai_agent', 1),
    ('basic', 'ai_agent', 1),
    ('starter', 'ai_agent', 1),
    ('premium', 'ai_agent', 1),
    ('ultimate', 'ai_agent', 1)
ON CONFLICT (tier_id, feature_id) DO UPDATE SET
    limit_value = 1;
