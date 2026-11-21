-- STYL-399: Reserve publish slugs before WordPress so concurrent publishes cannot collide.

CREATE TABLE IF NOT EXISTS public.tenant_publish_slug_claims (
  slug text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_publish_slug_claims_tenant_id_idx
  ON public.tenant_publish_slug_claims (tenant_id);

ALTER TABLE public.tenant_publish_slug_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tenant_publish_slug_claims FROM PUBLIC;
REVOKE ALL ON TABLE public.tenant_publish_slug_claims FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_publish_slug_claims TO service_role;

COMMENT ON TABLE public.tenant_publish_slug_claims IS
  'Short-lived slug reservations during manual WordPress publish (STYL-399).';