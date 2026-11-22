-- STYL-262: shared system-email log for the reusable sending layer.
-- Additive and idempotent. Apply on the local Supabase CLI stack only.
-- Do not apply this file to a hosted project from a developer machine.
-- Writes are service-role only. Authenticated superadmins may read.

CREATE TABLE IF NOT EXISTS public.system_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  recipient text NOT NULL,
  template_key text NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  status text NOT NULL,
  provider_id text,
  idempotency_key text NOT NULL,
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  resend_of_id uuid,
  CONSTRAINT system_email_log_status_check CHECK (status IN ('queued', 'sent', 'failed')),
  CONSTRAINT system_email_log_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT system_email_log_idempotency_key_len CHECK (char_length(idempotency_key) BETWEEN 1 AND 200)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'system_email_log_resend_of_id_fkey'
      AND conrelid = 'public.system_email_log'::regclass
  ) THEN
    ALTER TABLE public.system_email_log
      ADD CONSTRAINT system_email_log_resend_of_id_fkey
      FOREIGN KEY (resend_of_id) REFERENCES public.system_email_log(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS system_email_log_created_at_idx
  ON public.system_email_log (created_at DESC);

ALTER TABLE public.system_email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_email_log_service_role_all ON public.system_email_log;
CREATE POLICY system_email_log_service_role_all
  ON public.system_email_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS select_superadmin_system_email_log ON public.system_email_log;
CREATE POLICY select_superadmin_system_email_log
  ON public.system_email_log
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_super_admin = true
  ));

REVOKE ALL ON TABLE public.system_email_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.system_email_log TO authenticated;
GRANT ALL ON TABLE public.system_email_log TO service_role;

COMMENT ON TABLE public.system_email_log IS
  'STYL-262: one row per system-email attempt. idempotency_key is unique so each event is sent once. Service role writes; superadmins can read.';
