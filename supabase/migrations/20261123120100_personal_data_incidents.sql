-- STYL-264: incident record for breach notices #36 and #53.
-- ticket_target_at is the ticket's stated 72-hour target for a salon notice.
-- Solicitor confirmation of the UK GDPR timing is still pending.
-- The column is null for notices to individuals. Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.personal_data_incidents (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  kind text NOT NULL,
  awareness_at timestamptz NOT NULL,
  ticket_target_at timestamptz,
  nature text NOT NULL,
  people_affected text NOT NULL DEFAULT '',
  records_affected text NOT NULL DEFAULT '',
  consequences text NOT NULL,
  measures text NOT NULL,
  contact_name text NOT NULL,
  created_by uuid,
  notified_at timestamptz,
  CONSTRAINT personal_data_incidents_kind_check CHECK (kind IN ('salon', 'individuals'))
);

ALTER TABLE public.personal_data_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS personal_data_incidents_service_role_all ON public.personal_data_incidents;
CREATE POLICY personal_data_incidents_service_role_all
  ON public.personal_data_incidents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS select_superadmin_personal_data_incidents ON public.personal_data_incidents;
CREATE POLICY select_superadmin_personal_data_incidents
  ON public.personal_data_incidents
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_super_admin = true
  ));

REVOKE ALL ON TABLE public.personal_data_incidents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.personal_data_incidents TO authenticated;
GRANT ALL ON TABLE public.personal_data_incidents TO service_role;

COMMENT ON COLUMN public.personal_data_incidents.ticket_target_at IS
  'STYL-264 ticket target: 72 hours after awareness for a salon breach notice. Null for notices to individuals. Not a confirmed statutory deadline.';
