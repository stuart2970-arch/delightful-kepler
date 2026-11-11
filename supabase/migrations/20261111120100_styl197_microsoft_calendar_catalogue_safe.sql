-- STYL-197 §4a, as a new forward migration.
-- 20261001150000_microsoft_calendar_addon.sql was applied out of band on
-- production on 1 Oct 2026 and is already recorded there. Do not edit that
-- file and do not replay it against production: its category check drops
-- remove_branding, its feature insert requires features.description, and its
-- ON CONFLICT DO UPDATE overwrites the live catalogue row.
--
-- This file is safe to run on a database that already has the bolt-on:
--   * the category check keeps remove_branding
--   * the feature insert does not require features.description
--   * existing catalogue, feature, and tier rows are left as they are
-- It does not replace sync_tenant_channel_flags (hardened by 20261024120100)
-- and does not touch 20261024120200, 20261024130000, or the WordPress trigger.

-- 1. Keep remove_branding in the bolt-on category check (match the live list).
ALTER TABLE public.addon_catalog
    DROP CONSTRAINT IF EXISTS addon_catalog_category_check;

DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
          AND rel.relname = 'addon_catalog'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) ILIKE '%category%'
    LOOP
        EXECUTE format('ALTER TABLE public.addon_catalog DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

ALTER TABLE public.addon_catalog
    ADD CONSTRAINT addon_catalog_category_check CHECK (category IN (
        'landline', 'mobile', 'whatsapp', 'voice_pack', 'sms_pack', 'data_pack',
        'google_calendar', 'microsoft_calendar', 'remove_branding'
    ));

-- 2. Catalogue row. Insert only when missing. Do not overwrite a curated row.
INSERT INTO public.addon_catalog (
    id, name, description, category, monthly_price_pence,
    included_voice_minutes, included_sms, included_messages, included_data_chunks,
    is_active, display_order
) VALUES (
    'microsoft_calendar_addon',
    'Microsoft Outlook Calendar Integration',
    'Real-time two-way synchronization with Microsoft Outlook Calendar. Prevents double-booking and maps appointments to staff Outlook Calendars.',
    'microsoft_calendar',
    499,
    0, 0, 0, 0,
    true,
    36
)
ON CONFLICT (id) DO NOTHING;

-- 3. Feature row without features.description (that column is missing on production
--    until 20261111120000). Do not overwrite the hand-curated production row.
INSERT INTO public.features (id, category_id, name)
VALUES ('microsoft_calendar', 'integrations', 'Microsoft Outlook Calendar')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'features'
          AND column_name = 'description'
    ) THEN
        UPDATE public.features
           SET description = 'Microsoft Outlook Calendar integration and sync'
         WHERE id = 'microsoft_calendar' AND description IS NULL;
    END IF;
END $$;

-- 4. Zero-limit entitlement for whichever of base_tier / foundation exists.
--    Do not overwrite a limit that is already on file.
INSERT INTO public.tier_entitlements (tier_id, feature_id, limit_value)
SELECT id, 'microsoft_calendar', 0
FROM public.subscription_tiers
WHERE id IN ('base_tier', 'foundation')
ON CONFLICT (tier_id, feature_id) DO NOTHING;
