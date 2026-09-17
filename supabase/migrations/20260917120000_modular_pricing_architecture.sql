-- =========================================================================
-- 20260917120000_modular_pricing_architecture.sql
-- Modular Pricing & Billing Architecture Migration
--
-- Transitions from rigid multi-tier (Basic/Starter/Premium/Ultimate) to
-- single £9.99/mo Base Tier with modular bolt-on add-ons.
-- =========================================================================

-- =========================================================================
-- 1. CREATE ADDON CATALOG TABLE
-- Central catalog of all purchasable bolt-on products
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.addon_catalog (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL CHECK (category IN (
        'landline', 'mobile', 'whatsapp', 'voice_pack', 'sms_pack', 'data_pack'
    )),
    monthly_price_pence INT NOT NULL DEFAULT 0,
    included_voice_minutes INT DEFAULT 0,
    included_sms INT DEFAULT 0,
    included_messages INT DEFAULT 0,
    included_data_chunks INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    display_order INT DEFAULT 0,
    stripe_price_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed bolt-on add-ons
INSERT INTO public.addon_catalog (id, name, description, category, monthly_price_pence, included_voice_minutes, included_sms, included_messages, included_data_chunks, display_order) VALUES
-- Landline bolt-on (price range £8.99–£19.00, shared voice minutes 10–30)
('landline_addon', 'Local Landline Number', 'Dedicated local landline number with shared voice minutes. Price varies by area code and number type (£8.99–£19.00/mo).', 'landline', 899, 10, 0, 0, 0, 10),

-- Mobile bolt-on (price range £10.99–£14.99, 50–250 SMS + shared voice minutes)
('mobile_addon', 'Mobile Number', 'Dedicated mobile number with SMS messages and shared voice minutes. Price varies by number type (£10.99–£14.99/mo).', 'mobile', 1099, 10, 50, 0, 0, 20),

-- WhatsApp bolt-ons
('whatsapp_primary', 'WhatsApp (Primary)', 'Standalone WhatsApp channel with 500 messages/mo. For accounts without a base subscription.', 'whatsapp', 1999, 0, 0, 500, 0, 30),
('whatsapp_addon', 'WhatsApp (Add-on)', 'WhatsApp channel add-on with 500 messages/mo. Requires active base subscription.', 'whatsapp', 999, 0, 0, 500, 0, 31),

-- Sliding Voice Packs (3-month rollover)
('voice_pack_20', '20 Voice Minutes Pack', '20 additional shared voice minutes per month. Unused minutes roll over for up to 3 months.', 'voice_pack', 1500, 20, 0, 0, 0, 40),
('voice_pack_50', '50 Voice Minutes Pack', '50 additional shared voice minutes per month. Unused minutes roll over for up to 3 months.', 'voice_pack', 3000, 50, 0, 0, 0, 41),
('voice_pack_100', '100 Voice Minutes Pack', '100 additional shared voice minutes per month. Unused minutes roll over for up to 3 months.', 'voice_pack', 5000, 100, 0, 0, 0, 42),

-- Sliding SMS Packs (3-month rollover)
('sms_pack_100', '100 SMS Pack', '100 additional SMS messages per month. Unused credits roll over for up to 3 months.', 'sms_pack', 599, 0, 100, 0, 0, 50),
('sms_pack_500', '500 SMS Pack', '500 additional SMS messages per month. Unused credits roll over for up to 3 months.', 'sms_pack', 1499, 0, 500, 0, 0, 51),

-- Data Pack (Knowledge Base chunks)
('data_pack_500', '500 Knowledge Base Chunks', '500 additional knowledge base data chunks for your AI agent.', 'data_pack', 999, 0, 0, 0, 500, 60)

ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    monthly_price_pence = EXCLUDED.monthly_price_pence,
    included_voice_minutes = EXCLUDED.included_voice_minutes,
    included_sms = EXCLUDED.included_sms,
    included_messages = EXCLUDED.included_messages,
    included_data_chunks = EXCLUDED.included_data_chunks,
    display_order = EXCLUDED.display_order;

-- RLS for addon_catalog (read-only for authenticated, admin write)
ALTER TABLE public.addon_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_addon_catalog ON public.addon_catalog
    FOR SELECT TO authenticated USING (true);

-- =========================================================================
-- 2. EXTEND TENANT_ACTIVE_ADDONS FOR MODULAR BOLT-ONS
-- =========================================================================
ALTER TABLE public.tenant_active_addons
    ADD COLUMN IF NOT EXISTS addon_catalog_id TEXT REFERENCES public.addon_catalog(id),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- =========================================================================
-- 3. EXTEND USAGE_LEDGER FOR 3-MONTH ROLL-OVER
-- =========================================================================
ALTER TABLE public.usage_ledger
    ADD COLUMN IF NOT EXISTS billing_period_start TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS addon_catalog_id TEXT REFERENCES public.addon_catalog(id),
    ADD COLUMN IF NOT EXISTS usage_type TEXT DEFAULT 'consumption'
        CHECK (usage_type IN ('allocation', 'consumption'));

-- Index for efficient rollover queries
CREATE INDEX IF NOT EXISTS idx_usage_ledger_rollover
    ON public.usage_ledger (tenant_id, feature_id, usage_type, expires_at)
    WHERE expires_at IS NOT NULL;

-- Index for billing period queries
CREATE INDEX IF NOT EXISTS idx_usage_ledger_billing_period
    ON public.usage_ledger (tenant_id, feature_id, billing_period_start);

-- =========================================================================
-- 4. ADD CHANNEL FLAGS TO TENANTS
-- =========================================================================
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS has_landline BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS has_mobile BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS has_whatsapp BOOLEAN DEFAULT false;

-- =========================================================================
-- 5. CREATE ADDON AUDIT LOG
-- Tracks all pricing changes and addon modifications by superadmins
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.addon_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    addon_catalog_id TEXT REFERENCES public.addon_catalog(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN (
        'price_changed', 'addon_activated', 'addon_deactivated',
        'addon_created', 'addon_updated', 'tenant_migrated',
        'tier_deprecated', 'entitlement_overridden', 'base_tier_updated'
    )),
    old_value JSONB,
    new_value JSONB,
    summary TEXT,
    performed_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.addon_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_addon_audit_log ON public.addon_audit_log
    FOR SELECT TO authenticated USING (true);

-- =========================================================================
-- 6. DEPRECATE LEGACY TIERS & CREATE BASE TIER
-- =========================================================================

-- 6a. Grandfather existing tenants BEFORE changing their tier.
-- Preserve their current tier limits as explicit overrides so no one loses access.
INSERT INTO public.tenant_feature_overrides (tenant_id, feature_id, override_limit_value, reason)
SELECT
    t.id,
    te.feature_id,
    te.limit_value,
    'Grandfathered from legacy ' || t.plan_tier || ' tier on 2026-09-17'
FROM public.tenants t
JOIN public.tier_entitlements te ON te.tier_id = t.plan_tier
WHERE t.plan_tier IN ('basic', 'starter', 'premium', 'ultimate')
  AND te.limit_value IS NOT NULL
  AND te.limit_value > 0
ON CONFLICT (tenant_id, feature_id) DO NOTHING;

-- 6b. Log the migration for each affected tenant
INSERT INTO public.addon_audit_log (tenant_id, action, old_value, new_value, summary)
SELECT
    t.id,
    'tenant_migrated',
    jsonb_build_object('plan_tier', t.plan_tier),
    jsonb_build_object('plan_tier', 'base_tier'),
    'Migrated from legacy ' || t.plan_tier || ' tier to base_tier. Previous limits preserved via tenant_feature_overrides.'
FROM public.tenants t
WHERE t.plan_tier IN ('basic', 'starter', 'premium', 'ultimate');

-- 6c. Mark legacy tiers as inactive
UPDATE public.subscription_tiers
SET is_active = false
WHERE id IN ('basic', 'starter', 'premium', 'ultimate');

-- Log tier deprecation
INSERT INTO public.addon_audit_log (action, old_value, summary)
VALUES (
    'tier_deprecated',
    '{"tiers": ["basic", "starter", "premium", "ultimate"]}'::jsonb,
    'Deprecated legacy multi-tier structure in favour of single base_tier + modular bolt-ons.'
);

-- 6d. Insert the new Base Tier
INSERT INTO public.subscription_tiers (id, name, monthly_price, yearly_price, is_active)
VALUES ('base_tier', 'Base Subscription', 9.99, 99.90, true)
ON CONFLICT (id) DO UPDATE SET
    name = 'Base Subscription',
    monthly_price = 9.99,
    yearly_price = 99.90,
    is_active = true;

-- 6e. Seed base tier entitlements
-- Universal defaults enabled on all accounts
INSERT INTO public.tier_entitlements (tier_id, feature_id, limit_value) VALUES
    ('base_tier', 'web_widget', 1),
    ('base_tier', 'web_presence', 1),
    ('base_tier', 'lead_capture', 1),
    ('base_tier', 'chatbots_limit', 1),
    ('base_tier', 'knowledge_data_chunks', 500),
    ('base_tier', 'message_allowance', 1500)
ON CONFLICT (tier_id, feature_id) DO UPDATE SET
    limit_value = EXCLUDED.limit_value;

-- Voice minutes: 10 included in base tier (shared pool)
-- First, ensure we have a unified voice_minutes feature
INSERT INTO public.features (id, category_id, name, is_metered, is_available)
VALUES ('voice_minutes', 'premium_ai', 'Shared Voice Minutes', true, true)
ON CONFLICT (id) DO UPDATE SET name = 'Shared Voice Minutes', is_available = true;

INSERT INTO public.tier_entitlements (tier_id, feature_id, limit_value) VALUES
    ('base_tier', 'voice_minutes', 10)
ON CONFLICT (tier_id, feature_id) DO UPDATE SET limit_value = EXCLUDED.limit_value;

-- SMS feature
INSERT INTO public.features (id, category_id, name, is_metered, is_available)
VALUES ('sms_messages', 'telephony', 'SMS Messages', true, true)
ON CONFLICT (id) DO UPDATE SET name = 'SMS Messages', is_available = true;

INSERT INTO public.tier_entitlements (tier_id, feature_id, limit_value) VALUES
    ('base_tier', 'sms_messages', 0)
ON CONFLICT (tier_id, feature_id) DO UPDATE SET limit_value = EXCLUDED.limit_value;

-- WhatsApp messages feature
INSERT INTO public.features (id, category_id, name, is_metered, is_available)
VALUES ('whatsapp_messages', 'channels', 'WhatsApp Messages', true, true)
ON CONFLICT (id) DO UPDATE SET name = 'WhatsApp Messages', is_available = true;

INSERT INTO public.tier_entitlements (tier_id, feature_id, limit_value) VALUES
    ('base_tier', 'whatsapp_messages', 0)
ON CONFLICT (tier_id, feature_id) DO UPDATE SET limit_value = EXCLUDED.limit_value;

-- Data chunks bolt-on feature
INSERT INTO public.features (id, category_id, name, is_metered, is_available)
VALUES ('data_chunks_addon', 'core_ai', 'Knowledge Base Data Pack', true, true)
ON CONFLICT (id) DO UPDATE SET name = 'Knowledge Base Data Pack', is_available = true;

-- Calendar booking: explicitly NOT included in base tier (no row = no access)
-- Users keep their existing booking tools/links.

-- 6f. Migrate all tenants to base_tier
UPDATE public.tenants
SET plan_tier = 'base_tier'
WHERE plan_tier IN ('basic', 'starter', 'premium', 'ultimate');

-- 6g. Set default plan_tier for new signups
ALTER TABLE public.tenants ALTER COLUMN plan_tier SET DEFAULT 'base_tier';

-- =========================================================================
-- 7. HIDE EXCLUDED/UNDEVELOPED FEATURES
-- These must not appear in the UI at all
-- =========================================================================
UPDATE public.features
SET is_available = false
WHERE id IN ('custom_domain', 'inventory_control', 'crm_zapier_sync', 'email_marketing');

-- Also hide these from entitlements display if they exist
-- (Instagram is not yet a feature row, so no action needed)

-- =========================================================================
-- 8. SYNC CHANNEL FLAGS FOR EXISTING TENANTS WITH ACTIVE ADDONS
-- (In case any tenant_active_addons already exist)
-- =========================================================================
UPDATE public.tenants t
SET has_landline = EXISTS (
    SELECT 1 FROM public.tenant_active_addons taa
    JOIN public.addon_catalog ac ON ac.id = taa.addon_catalog_id
    WHERE taa.tenant_id = t.id AND taa.is_active = true AND ac.category = 'landline'
),
has_mobile = EXISTS (
    SELECT 1 FROM public.tenant_active_addons taa
    JOIN public.addon_catalog ac ON ac.id = taa.addon_catalog_id
    WHERE taa.tenant_id = t.id AND taa.is_active = true AND ac.category = 'mobile'
),
has_whatsapp = EXISTS (
    SELECT 1 FROM public.tenant_active_addons taa
    JOIN public.addon_catalog ac ON ac.id = taa.addon_catalog_id
    WHERE taa.tenant_id = t.id AND taa.is_active = true AND ac.category = 'whatsapp'
);

-- =========================================================================
-- 9. HELPER FUNCTION: Sync channel flags from active addons
-- Called by application code after addon changes
-- =========================================================================
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
        )
    WHERE id = p_tenant_id;
END;
$$;
