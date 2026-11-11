-- STYL-197: catch up the parts of 20260707120000_dynamic_entitlements that never
-- reached production. Additive and idempotent. Touches no existing tenant data.
--
-- Does not alter 20261024120100 / 20261024120200 objects, the WordPress
-- tenant-created trigger, or 20261024130000 (staging-only helpers).
--
-- Supabase runs each migration file inside one transaction. This file has no
-- inner BEGIN/COMMIT, so that transaction is not closed early.
--
-- Documented catalogue backfill (the only UPDATE): features.description for
-- microsoft_calendar is filled when it is still NULL. No tenant or customer
-- row is updated or deleted. There is nothing to backfill into usage_logs:
-- production never stored the failed chat inserts.

-- 1. features: optional metadata columns (nullable, no default => metadata-only change)
ALTER TABLE public.features ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE public.features ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. tenant_entitlements (unused by app code today; created for schema parity)
CREATE TABLE IF NOT EXISTS public.tenant_entitlements (
    tenant_id     UUID REFERENCES public.tenants(id)  ON DELETE CASCADE,
    feature_id    TEXT REFERENCES public.features(id) ON DELETE CASCADE,
    is_enabled    BOOLEAN DEFAULT false,
    numeric_limit NUMERIC DEFAULT 0,
    used_amount   NUMERIC DEFAULT 0,
    reset_period  TEXT CHECK (reset_period IN ('monthly','annual','never')) DEFAULT 'monthly',
    last_reset_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, feature_id)
);

-- 3. usage_logs (analytics trail written by logMeteredUsage)
CREATE TABLE IF NOT EXISTS public.usage_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID REFERENCES public.tenants(id)  ON DELETE CASCADE,
    feature_id  TEXT REFERENCES public.features(id) ON DELETE CASCADE,
    amount      NUMERIC NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_logs_tenant_created ON public.usage_logs (tenant_id, created_at DESC);

-- 4. RLS + tenant-scoped read policies (authenticated only; writes via service role).
-- Drop every policy on these two tables first so a leftover permissive policy
-- cannot outlive this file. Tables are new on production; on staging this only
-- tightens the policies created by 20260707120000.
ALTER TABLE public.tenant_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs          ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tenant_entitlements'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.tenant_entitlements', pol.policyname);
    END LOOP;
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'usage_logs'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.usage_logs', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "Tenants can view own entitlements" ON public.tenant_entitlements
    FOR SELECT TO authenticated USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "Tenants can view own usage logs" ON public.usage_logs
    FOR SELECT TO authenticated USING (tenant_id = public.get_auth_tenant_id());

-- 5. Least privilege: Supabase default privileges grant ALL to anon/authenticated.
REVOKE ALL ON public.tenant_entitlements FROM anon;
REVOKE ALL ON public.usage_logs          FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.tenant_entitlements FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.usage_logs          FROM authenticated;
GRANT SELECT ON public.tenant_entitlements TO authenticated;
GRANT SELECT ON public.usage_logs          TO authenticated;
GRANT ALL    ON public.tenant_entitlements TO service_role;
GRANT ALL    ON public.usage_logs          TO service_role;

-- 6. Catalogue-only backfill (not customer data): the description the edited
--    Microsoft Calendar migration intended. Only fills a NULL.
UPDATE public.features
   SET description = 'Microsoft Outlook Calendar integration and sync'
 WHERE id = 'microsoft_calendar' AND description IS NULL;
