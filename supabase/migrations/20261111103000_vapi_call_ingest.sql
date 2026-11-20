-- Idempotency key for Vapi end-of-call reports. One row per call id.
-- Additive. Service role only. No customer data is rewritten.

CREATE TABLE IF NOT EXISTS public.vapi_call_ingest (
  vapi_call_id text PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  metered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vapi_call_ingest ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.vapi_call_ingest FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.vapi_call_ingest TO service_role;

COMMENT ON TABLE public.vapi_call_ingest IS
  'Claim row for a Vapi call id so end-of-call retries store the transcript and meter minutes once.';
COMMENT ON COLUMN public.vapi_call_ingest.metered_at IS
  'Set when voice_minutes were logged; null rows may be re-metered on end-of-call-report retry.';
