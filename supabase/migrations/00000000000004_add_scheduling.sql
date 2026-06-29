-- =========================================================================
-- 1. TENANT INTEGRATIONS TABLE
-- =========================================================================
CREATE TABLE public.tenant_integrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('google_calendar')),
    access_token text,
    refresh_token text,
    expiry_date timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenant_integrations_tenant_provider_key UNIQUE (tenant_id, provider)
);

-- =========================================================================
-- 2. SERVICES TABLE
-- =========================================================================
CREATE TABLE public.services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name text NOT NULL,
    duration_minutes integer NOT NULL DEFAULT 60,
    buffer_minutes integer NOT NULL DEFAULT 0,
    price numeric(10, 2),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- 3. STAFF TABLE
-- =========================================================================
CREATE TABLE public.staff (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name text NOT NULL,
    email text NOT NULL,
    google_calendar_id text, -- e.g., 'primary' or a specific calendar ID
    working_days jsonb NOT NULL DEFAULT '{}'::jsonb, -- e.g. {"monday": {"start": "09:00", "end": "17:00"}, ...}
    created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- INDEXES & RLS
-- =========================================================================
CREATE INDEX IF NOT EXISTS tenant_integrations_tenant_id_idx ON public.tenant_integrations(tenant_id);
CREATE INDEX IF NOT EXISTS services_tenant_id_idx ON public.services(tenant_id);
CREATE INDEX IF NOT EXISTS staff_tenant_id_idx ON public.staff(tenant_id);

ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

-- Integrations RLS
CREATE POLICY select_tenant_integrations ON public.tenant_integrations FOR SELECT TO authenticated USING (tenant_id = public.get_auth_tenant_id());
CREATE POLICY insert_tenant_integrations ON public.tenant_integrations FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_auth_tenant_id());
CREATE POLICY update_tenant_integrations ON public.tenant_integrations FOR UPDATE TO authenticated USING (tenant_id = public.get_auth_tenant_id()) WITH CHECK (tenant_id = public.get_auth_tenant_id());
CREATE POLICY delete_tenant_integrations ON public.tenant_integrations FOR DELETE TO authenticated USING (tenant_id = public.get_auth_tenant_id());

-- Services RLS
CREATE POLICY select_services ON public.services FOR SELECT TO authenticated USING (tenant_id = public.get_auth_tenant_id());
CREATE POLICY insert_services ON public.services FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_auth_tenant_id());
CREATE POLICY update_services ON public.services FOR UPDATE TO authenticated USING (tenant_id = public.get_auth_tenant_id()) WITH CHECK (tenant_id = public.get_auth_tenant_id());
CREATE POLICY delete_services ON public.services FOR DELETE TO authenticated USING (tenant_id = public.get_auth_tenant_id());

-- Staff RLS
CREATE POLICY select_staff ON public.staff FOR SELECT TO authenticated USING (tenant_id = public.get_auth_tenant_id());
CREATE POLICY insert_staff ON public.staff FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_auth_tenant_id());
CREATE POLICY update_staff ON public.staff FOR UPDATE TO authenticated USING (tenant_id = public.get_auth_tenant_id()) WITH CHECK (tenant_id = public.get_auth_tenant_id());
CREATE POLICY delete_staff ON public.staff FOR DELETE TO authenticated USING (tenant_id = public.get_auth_tenant_id());
