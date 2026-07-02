-- Create appointments table
CREATE TABLE public.appointments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
    service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    customer_name text NOT NULL,
    customer_email text NOT NULL,
    customer_phone text,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    google_event_id text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
CREATE POLICY select_appointments ON public.appointments FOR SELECT TO authenticated USING (tenant_id = public.get_auth_tenant_id());
CREATE POLICY insert_appointments ON public.appointments FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_auth_tenant_id());
CREATE POLICY update_appointments ON public.appointments FOR UPDATE TO authenticated USING (tenant_id = public.get_auth_tenant_id()) WITH CHECK (tenant_id = public.get_auth_tenant_id());
CREATE POLICY delete_appointments ON public.appointments FOR DELETE TO authenticated USING (tenant_id = public.get_auth_tenant_id());
