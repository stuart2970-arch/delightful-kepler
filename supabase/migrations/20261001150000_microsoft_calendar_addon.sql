-- =========================================================================
-- 20261001150000_microsoft_calendar_addon.sql
-- Add Microsoft Outlook Calendar as a Modular Bolt-on Add-on (£4.99/mo)
-- =========================================================================

-- 1. Update category check constraint on addon_catalog to include 'microsoft_calendar'
ALTER TABLE public.addon_catalog
    DROP CONSTRAINT IF EXISTS addon_catalog_category_check;

ALTER TABLE public.addon_catalog
    ADD CONSTRAINT addon_catalog_category_check CHECK (category IN (
        'landline', 'mobile', 'whatsapp', 'voice_pack', 'sms_pack', 'data_pack', 'google_calendar', 'microsoft_calendar'
    ));

-- 2. Insert microsoft_calendar_addon into addon_catalog
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
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    monthly_price_pence = EXCLUDED.monthly_price_pence,
    display_order = EXCLUDED.display_order,
    is_active = EXCLUDED.is_active;

-- 3. Add has_microsoft_calendar channel flag to tenants
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS has_microsoft_calendar BOOLEAN DEFAULT false;

-- 4. Update sync_tenant_channel_flags helper function to include has_microsoft_calendar
CREATE OR REPLACE FUNCTION public.sync_tenant_channel_flags(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.tenants
    SET
        has_landline = EXISTS (
            SELECT 1 FROM public.tenant_active_addons taa
            JOIN public.addon_catalog ac ON ac.id = taa.addon_catalog_id
            WHERE taa.tenant_id = p_tenant_id AND taa.is_active = true AND ac.category = 'landline'
        ),
        has_mobile = EXISTS (
            SELECT 1 FROM public.tenant_active_addons taa
            JOIN public.addon_catalog ac ON ac.id = taa.addon_catalog_id
            WHERE taa.tenant_id = p_tenant_id AND taa.is_active = true AND ac.category = 'mobile'
        ),
        has_whatsapp = EXISTS (
            SELECT 1 FROM public.tenant_active_addons taa
            JOIN public.addon_catalog ac ON ac.id = taa.addon_catalog_id
            WHERE taa.tenant_id = p_tenant_id AND taa.is_active = true AND ac.category = 'whatsapp'
        ),
        has_google_calendar = EXISTS (
            SELECT 1 FROM public.tenant_active_addons taa
            JOIN public.addon_catalog ac ON ac.id = taa.addon_catalog_id
            WHERE taa.tenant_id = p_tenant_id AND taa.is_active = true AND ac.category = 'google_calendar'
        ),
        has_microsoft_calendar = EXISTS (
            SELECT 1 FROM public.tenant_active_addons taa
            JOIN public.addon_catalog ac ON ac.id = taa.addon_catalog_id
            WHERE taa.tenant_id = p_tenant_id AND taa.is_active = true AND ac.category = 'microsoft_calendar'
        )
    WHERE id = p_tenant_id;
END;
$$;

-- 5. Ensure base_tier has microsoft_calendar entitlement set to 0 (bolt-on required)
INSERT INTO public.tier_entitlements (tier_id, feature_id, limit_value)
VALUES ('base_tier', 'microsoft_calendar', 0)
ON CONFLICT (tier_id, feature_id) DO UPDATE SET limit_value = 0;
