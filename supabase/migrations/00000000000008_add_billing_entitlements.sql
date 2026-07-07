-- =========================================================================
-- 00000000000008_add_billing_entitlements.sql
-- Establishes the Dynamic Entitlements & Metering Architecture.
-- =========================================================================

-- 1. SUBSCRIPTION TIERS
CREATE TABLE public.subscription_tiers (
    id text PRIMARY KEY,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed tiers
INSERT INTO public.subscription_tiers (id, name) VALUES
('basic', 'Basic'),
('starter', 'Starter'),
('premium', 'Premium'),
('ultimate', 'Ultimate');

-- =========================================================================
-- 2. ADD PLAN TIER TO TENANTS
-- =========================================================================
ALTER TABLE public.tenants
ADD COLUMN plan_tier text NOT NULL DEFAULT 'basic' REFERENCES public.subscription_tiers(id);

-- Grandfather existing tenants to ultimate so their service is not interrupted
UPDATE public.tenants SET plan_tier = 'ultimate';

-- =========================================================================
-- 3. FEATURE CATEGORIES
-- =========================================================================
CREATE TABLE public.feature_categories (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed feature categories
INSERT INTO public.feature_categories (id, name, description) VALUES
('core_ai', 'Core AI Features', 'Fundamental chatbot capabilities'),
('channels', 'Deployment Channels', 'Where the chatbot can be deployed'),
('integrations', '3rd-Party Integrations', 'External service connections'),
('premium_ai', 'Premium AI Capabilities', 'Advanced high-cost AI features');

-- =========================================================================
-- 4. FEATURES TABLE
-- =========================================================================
CREATE TABLE public.features (
    id text PRIMARY KEY,
    category_id text NOT NULL REFERENCES public.feature_categories(id),
    name text NOT NULL,
    is_metered boolean NOT NULL DEFAULT false,
    unit_cost_estimated numeric(10,5) NOT NULL DEFAULT 0.00000,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed Features
INSERT INTO public.features (id, category_id, name, is_metered, unit_cost_estimated) VALUES
('message_allowance', 'core_ai', 'Monthly Message Allowance', TRUE, 0.00100),
('knowledge_data_chunks', 'core_ai', 'Knowledge Base Data Chunks', FALSE, 0.00000),
('lead_capture', 'core_ai', 'Lead Capture Workflows', FALSE, 0.00000),
('web_widget', 'channels', 'Website Widget', FALSE, 0.00000),
('whatsapp_omni', 'channels', 'WhatsApp Omnichannel', TRUE, 0.01500),
('white_labeling', 'channels', 'Remove Branding / White-label', FALSE, 0.00000),
('crm_zapier_sync', 'integrations', 'CRM & Zapier Sync', FALSE, 0.00000),
('calendar_booking', 'integrations', 'Calendar Booking', FALSE, 0.00000),
('salon_iq_sync', 'integrations', 'Salon IQ Sync', FALSE, 0.00000),
('booksy_sync', 'integrations', 'Booksy Sync', FALSE, 0.00000),
('voice_receptionist', 'premium_ai', 'Voice AI Receptionist', TRUE, 0.05000);

-- =========================================================================
-- 5. TIER ENTITLEMENTS TABLE
-- =========================================================================
CREATE TABLE public.tier_entitlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tier_id text NOT NULL REFERENCES public.subscription_tiers(id),
    feature_id text NOT NULL REFERENCES public.features(id) ON DELETE CASCADE,
    included_volume integer, -- NULL means unlimited
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tier_id, feature_id)
);

-- Seed Entitlements based on NotebookLM specifications
INSERT INTO public.tier_entitlements (tier_id, feature_id, included_volume) VALUES
-- Basic Tier
('basic', 'message_allowance', 1000),
('basic', 'knowledge_data_chunks', 50),
('basic', 'lead_capture', 1),
('basic', 'web_widget', 1),

-- Starter Tier
('starter', 'message_allowance', 5000),
('starter', 'knowledge_data_chunks', 500),
('starter', 'lead_capture', 1),
('starter', 'web_widget', 1),
('starter', 'white_labeling', 1),

-- Premium Tier
('premium', 'message_allowance', 15000),
('premium', 'knowledge_data_chunks', 5000),
('premium', 'lead_capture', 1),
('premium', 'web_widget', 1),
('premium', 'white_labeling', 1),
('premium', 'calendar_booking', 1),
('premium', 'salon_iq_sync', 1),
('premium', 'booksy_sync', 1),

-- Ultimate Tier
('ultimate', 'message_allowance', NULL),
('ultimate', 'knowledge_data_chunks', NULL),
('ultimate', 'lead_capture', 1),
('ultimate', 'web_widget', 1),
('ultimate', 'white_labeling', 1),
('ultimate', 'calendar_booking', 1),
('ultimate', 'salon_iq_sync', 1),
('ultimate', 'booksy_sync', 1),
('ultimate', 'voice_receptionist', NULL),
('ultimate', 'whatsapp_omni', NULL);

-- =========================================================================
-- 6. USAGE LEDGER TABLE
-- Append-only ledger for tracking costs and metering
-- =========================================================================
CREATE TABLE public.usage_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    feature_id text NOT NULL REFERENCES public.features(id) ON DELETE CASCADE,
    quantity integer NOT NULL DEFAULT 1,
    actual_cost numeric(10,5) NOT NULL DEFAULT 0.00000,
    sector_tag text,
    recorded_at timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- RLS POLICIES
-- =========================================================================
ALTER TABLE public.subscription_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tier_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_ledger ENABLE ROW LEVEL SECURITY;

-- Everyone can read the static definitions
CREATE POLICY select_subscription_tiers ON public.subscription_tiers FOR SELECT TO authenticated USING (true);
CREATE POLICY select_feature_categories ON public.feature_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY select_features ON public.features FOR SELECT TO authenticated USING (true);
CREATE POLICY select_entitlements ON public.tier_entitlements FOR SELECT TO authenticated USING (true);

-- Usage ledger policies
CREATE POLICY select_usage_ledger ON public.usage_ledger
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY insert_usage_ledger ON public.usage_ledger
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_auth_tenant_id());
