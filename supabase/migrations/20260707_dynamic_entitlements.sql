-- Dynamic Entitlements & Metering Architecture

-- 1. Create Feature Categories
CREATE TABLE public.feature_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT
);

-- 2. Create Features
CREATE TABLE public.features (
    id TEXT PRIMARY KEY,
    category_id TEXT REFERENCES public.feature_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('boolean', 'numeric', 'time_based')),
    description TEXT
);

-- 3. Create Tenant Entitlements (Ledger)
CREATE TABLE public.tenant_entitlements (
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    feature_id TEXT REFERENCES public.features(id) ON DELETE CASCADE,
    is_enabled BOOLEAN DEFAULT false,
    numeric_limit NUMERIC DEFAULT 0,
    used_amount NUMERIC DEFAULT 0,
    reset_period TEXT CHECK (reset_period IN ('monthly', 'annual', 'never')) DEFAULT 'monthly',
    last_reset_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, feature_id)
);

-- 4. Create Usage Logs (Audit Trail)
CREATE TABLE public.usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    feature_id TEXT REFERENCES public.features(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.feature_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

-- Read access for authenticated users to features
CREATE POLICY "Anyone can read feature categories" ON public.feature_categories FOR SELECT USING (true);
CREATE POLICY "Anyone can read features" ON public.features FOR SELECT USING (true);

-- Tenants can read their own entitlements
CREATE POLICY "Tenants can view own entitlements" ON public.tenant_entitlements
    FOR SELECT USING (tenant_id = auth.uid() OR tenant_id IN (SELECT id FROM public.tenants WHERE owner_id = auth.uid()));

-- Tenants can read their own logs
CREATE POLICY "Tenants can view own usage logs" ON public.usage_logs
    FOR SELECT USING (tenant_id = auth.uid() OR tenant_id IN (SELECT id FROM public.tenants WHERE owner_id = auth.uid()));

-- Insert Default Plan Structure
INSERT INTO public.feature_categories (id, name, description) VALUES 
('ai_services', 'AI & Machine Learning', 'AI features including chatbots and knowledge bases'),
('scheduling', 'Scheduling', 'Booking and calendar integrations'),
('core', 'Core Platform', 'Core SaaS features');

INSERT INTO public.features (id, category_id, name, type, description) VALUES 
('chatbot_instances', 'ai_services', 'Active Chatbots', 'numeric', 'Number of active chatbot agents'),
('knowledge_base_crawls', 'ai_services', 'Website Crawls', 'numeric', 'Number of website ingestions per month'),
('llm_tokens', 'ai_services', 'LLM Tokens', 'numeric', 'Monthly token quota for AI responses'),
('google_calendar_sync', 'scheduling', 'Google Calendar Sync', 'boolean', 'Two-way sync with Google Calendar'),
('custom_branding', 'core', 'Custom Branding', 'boolean', 'Remove StyleFlo branding');
