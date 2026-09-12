-- Migration: Add missing staff_services join table

CREATE TABLE IF NOT EXISTS public.staff_services (
    service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
    custom_price numeric(10, 2),
    custom_duration integer,
    PRIMARY KEY (service_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_services_service_id ON public.staff_services(service_id);
CREATE INDEX IF NOT EXISTS idx_staff_services_staff_id ON public.staff_services(staff_id);

ALTER TABLE public.staff_services ENABLE ROW LEVEL SECURITY;

-- Staff Services RLS
CREATE POLICY select_staff_services ON public.staff_services
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.services
      WHERE id = staff_services.service_id
      AND tenant_id = public.get_auth_tenant_id()
    )
  );

CREATE POLICY insert_staff_services ON public.staff_services
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.services
      WHERE id = staff_services.service_id
      AND tenant_id = public.get_auth_tenant_id()
    )
  );

CREATE POLICY update_staff_services ON public.staff_services
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.services
      WHERE id = staff_services.service_id
      AND tenant_id = public.get_auth_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.services
      WHERE id = staff_services.service_id
      AND tenant_id = public.get_auth_tenant_id()
    )
  );

CREATE POLICY delete_staff_services ON public.staff_services
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.services
      WHERE id = staff_services.service_id
      AND tenant_id = public.get_auth_tenant_id()
    )
  );
