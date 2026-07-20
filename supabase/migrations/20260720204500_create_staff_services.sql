-- Create staff_services junction table
CREATE TABLE public.staff_services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
    custom_price numeric(10, 2),
    custom_duration integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT staff_services_tenant_service_staff_key UNIQUE (tenant_id, service_id, staff_id)
);

-- Enable RLS
ALTER TABLE public.staff_services ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
CREATE POLICY select_staff_services ON public.staff_services FOR SELECT TO authenticated USING (tenant_id = public.get_auth_tenant_id());
CREATE POLICY insert_staff_services ON public.staff_services FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_auth_tenant_id());
CREATE POLICY update_staff_services ON public.staff_services FOR UPDATE TO authenticated USING (tenant_id = public.get_auth_tenant_id()) WITH CHECK (tenant_id = public.get_auth_tenant_id());
CREATE POLICY delete_staff_services ON public.staff_services FOR DELETE TO authenticated USING (tenant_id = public.get_auth_tenant_id());

-- Add index
CREATE INDEX IF NOT EXISTS staff_services_tenant_id_idx ON public.staff_services(tenant_id);
CREATE INDEX IF NOT EXISTS staff_services_service_id_idx ON public.staff_services(service_id);
CREATE INDEX IF NOT EXISTS staff_services_staff_id_idx ON public.staff_services(staff_id);
