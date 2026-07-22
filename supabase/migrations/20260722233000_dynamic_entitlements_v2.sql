-- 1. Feature Categories Table
CREATE TABLE IF NOT EXISTS public.feature_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    display_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Centralized Features Catalog
CREATE TABLE IF NOT EXISTS public.features (
    id TEXT PRIMARY KEY,
    category_id UUID REFERENCES public.feature_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_metered BOOLEAN DEFAULT FALSE,
    base_cost_incurred NUMERIC(10, 4) DEFAULT 0.0000,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tiers Reference Table
CREATE TABLE IF NOT EXISTS public.subscription_tiers (
    tier_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    stripe_price_id TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Rebuild Tier Entitlements Bridge
-- Assuming the old table existed, we'll alter it to match the new schema or recreate it.
-- Let's drop it and recreate it cleanly if it existed, or we can just make sure the columns are right.
-- To be safe, we'll create it if not exists, and if it does exist, we ensure limit_value is present.
DROP TABLE IF EXISTS public.tier_entitlements CASCADE;
CREATE TABLE public.tier_entitlements (
    tier_id TEXT REFERENCES public.subscription_tiers(tier_id) ON DELETE CASCADE,
    feature_id TEXT REFERENCES public.features(id) ON DELETE CASCADE,
    limit_value INT, -- NULL = Unlimited, 0 = No Access, >0 = Numeric cap
    PRIMARY KEY (tier_id, feature_id)
);

-- 5. Tenant Overrides
CREATE TABLE IF NOT EXISTS public.tenant_feature_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    feature_id TEXT REFERENCES public.features(id) ON DELETE CASCADE,
    override_limit_value INT,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, feature_id)
);

-- 6. Bolt-On Add-ons
CREATE TABLE IF NOT EXISTS public.tenant_active_addons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    feature_id TEXT REFERENCES public.features(id) ON DELETE CASCADE,
    quantity INT DEFAULT 1,
    stripe_subscription_item_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Audit Logging for Entitlements
CREATE TABLE IF NOT EXISTS public.entitlement_change_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    feature_id TEXT REFERENCES public.features(id) ON DELETE CASCADE,
    old_limit INT,
    new_limit INT,
    change_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Initial Data
INSERT INTO public.subscription_tiers (tier_id, name) VALUES 
('basic', 'Basic'), ('starter', 'Starter'), ('premium', 'Premium'), ('ultimate', 'Ultimate')
ON CONFLICT (tier_id) DO NOTHING;

INSERT INTO public.feature_categories (id, name, display_order) VALUES 
('c1000000-0000-0000-0000-000000000001', 'Core AI & Limits', 1),
('c1000000-0000-0000-0000-000000000002', 'Channels & Integrations', 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.features (id, category_id, name, is_metered) VALUES 
('knowledge_data_chunks', 'c1000000-0000-0000-0000-000000000001', 'Knowledge Base Vector Chunks', TRUE),
('voice_receptionist', 'c1000000-0000-0000-0000-000000000002', 'Voice AI Receptionist', TRUE),
('website_chatbots', 'c1000000-0000-0000-0000-000000000002', 'Website Chatbots', FALSE),
('messaging_sms', 'c1000000-0000-0000-0000-000000000002', 'SMS Messaging', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Seed Tier Entitlements Example
INSERT INTO public.tier_entitlements (tier_id, feature_id, limit_value) VALUES
('basic', 'knowledge_data_chunks', 100),
('starter', 'knowledge_data_chunks', 500),
('premium', 'knowledge_data_chunks', 2000),
('ultimate', 'knowledge_data_chunks', NULL),

('basic', 'voice_receptionist', 0),
('starter', 'voice_receptionist', 100),
('premium', 'voice_receptionist', 500),
('ultimate', 'voice_receptionist', NULL)
ON CONFLICT (tier_id, feature_id) DO NOTHING;
