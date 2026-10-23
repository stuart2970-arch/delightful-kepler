-- =========================================================================
-- STYL-193
-- Catalogue row for the monthly "Remove StyleFlo branding" bolt-on.
-- £4.99 (499 pence) to start. Superadmin can change that price later.
-- Nobody is given the bolt-on by this file.
--
-- This file is not applied to production by the pull request.
-- Stuart runs it separately, before the new widget is deployed.
-- =========================================================================

ALTER TABLE public.addon_catalog
    DROP CONSTRAINT IF EXISTS addon_catalog_category_check;

ALTER TABLE public.addon_catalog
    ADD CONSTRAINT addon_catalog_category_check CHECK (category IN (
        'landline', 'mobile', 'whatsapp', 'voice_pack', 'sms_pack', 'data_pack',
        'google_calendar', 'microsoft_calendar', 'remove_branding'
    ));

INSERT INTO public.features (id, category_id, name, description)
VALUES (
    'remove_branding',
    'integrations',
    'Remove StyleFlo branding',
    'Hides the Powered by StyleFlo footer in the chat window'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.addon_catalog (
    id, name, description, category, monthly_price_pence, max_price_pence,
    included_voice_minutes, included_sms, included_messages, included_data_chunks,
    is_active, is_sliding, display_order
) VALUES (
    'remove_styleflo_branding',
    'Remove StyleFlo branding',
    'Hides the Powered by StyleFlo line and its tracking link in the chat window. Terms, Privacy and the AI notice stay on screen.',
    'remove_branding',
    499,
    499,
    0, 0, 0, 0,
    true,
    false,
    40
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    is_active = EXCLUDED.is_active,
    is_sliding = EXCLUDED.is_sliding,
    display_order = EXCLUDED.display_order;

-- Not included on any plan. A salon pays for it, or a superadmin turns the include switch on.
INSERT INTO public.tier_entitlements (tier_id, feature_id, limit_value)
VALUES ('base_tier', 'remove_branding', 0)
ON CONFLICT (tier_id, feature_id) DO UPDATE SET limit_value = 0;

INSERT INTO public.tier_entitlements (tier_id, feature_id, limit_value)
VALUES ('foundation', 'remove_branding', 0)
ON CONFLICT (tier_id, feature_id) DO UPDATE SET limit_value = 0;
