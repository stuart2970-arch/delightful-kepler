-- STYL-266: audit every CreateBooking attempt (accepted and rejected).
-- Additive and idempotent. Apply on the local Supabase CLI stack for tests.
-- Do not apply to a hosted project from a developer machine.

CREATE TABLE IF NOT EXISTS public.booking_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  chatbot_id uuid,
  source text NOT NULL CHECK (source IN ('vapi', 'widget', 'anonymous')),
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
  reason text,
  http_status integer NOT NULL,
  ip_address text,
  staff_id uuid,
  service_id uuid,
  slot_start timestamptz,
  slot_end timestamptz,
  customer_email text,
  ignored_body_tenant boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS booking_audit_log_tenant_created_idx
  ON public.booking_audit_log (tenant_id, created_at DESC);

ALTER TABLE public.booking_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on booking_audit_log" ON public.booking_audit_log;
CREATE POLICY "Service role full access on booking_audit_log"
  ON public.booking_audit_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.booking_audit_log FROM PUBLIC;
REVOKE ALL ON TABLE public.booking_audit_log FROM anon, authenticated;
GRANT ALL ON TABLE public.booking_audit_log TO service_role;

COMMENT ON TABLE public.booking_audit_log IS
  'STYL-266: one row per /api/v3/CreateBooking attempt. Service role writes it only from that route.';
