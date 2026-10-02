-- 00000000000010_voice_metering.sql

-- 1. Insert Voice Minutes feature
INSERT INTO public.features (id, category_id, name, is_metered, unit_cost_estimated) 
VALUES ('vapi_voice_minutes', 'core_ai', 'Voice Agent Minutes', TRUE, 0.10000)
ON CONFLICT (id) DO NOTHING;

-- 2. Allocate default minutes to existing tiers
INSERT INTO public.tier_entitlements (tier_id, feature_id, included_volume)
VALUES 
  ('basic', 'vapi_voice_minutes', 100),
  ('starter', 'vapi_voice_minutes', 500),
  ('premium', 'vapi_voice_minutes', 2000),
  ('ultimate', 'vapi_voice_minutes', 5000)
ON CONFLICT (tier_id, feature_id) DO UPDATE SET included_volume = EXCLUDED.included_volume;

-- 3. Remove per-tenant Vapi credentials from chatbots (migrating to centralized model)
ALTER TABLE public.chatbots 
DROP COLUMN IF EXISTS vapi_public_key,
DROP COLUMN IF EXISTS vapi_assistant_id;
