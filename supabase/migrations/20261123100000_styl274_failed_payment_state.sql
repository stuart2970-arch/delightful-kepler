-- STYL-274: failed-payment timeline. Additive, idempotent, service-role only.
-- The app ignores these tables until FAILED_PAYMENT_FLOW_ENABLED=true.
-- RLS stays enabled and is not granted to anon or authenticated.

CREATE TABLE IF NOT EXISTS public.failed_payment_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stripe_invoice_id text NOT NULL,
  stripe_subscription_id text,
  stripe_customer_id text,
  first_failed_at timestamptz NOT NULL,
  paused_at timestamptz,
  restarted_at timestamptz,
  cancelled_at timestamptz,
  written_off_invoice_id text,
  paid_at timestamptz,
  status text NOT NULL DEFAULT 'past_due'
    CHECK (status IN ('past_due', 'paused', 'restarted', 'recovered', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT failed_payment_cases_invoice_key UNIQUE (stripe_invoice_id)
);

ALTER TABLE public.failed_payment_cases
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE INDEX IF NOT EXISTS failed_payment_cases_tenant_idx
  ON public.failed_payment_cases (tenant_id);

CREATE INDEX IF NOT EXISTS failed_payment_cases_open_idx
  ON public.failed_payment_cases (first_failed_at)
  WHERE status IN ('past_due', 'paused');

CREATE TABLE IF NOT EXISTS public.failed_payment_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.failed_payment_cases(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  transition text NOT NULL CHECK (transition IN ('pause', 'restart', 'cancel', 'write_off')),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'failed')),
  occurred_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  processed_at timestamptz,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT failed_payment_transitions_key UNIQUE (idempotency_key)
);

ALTER TABLE public.failed_payment_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.failed_payment_transitions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.failed_payment_cases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.failed_payment_transitions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.failed_payment_cases TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.failed_payment_transitions TO postgres, service_role;

-- Same claim / complete shape as claim_stripe_webhook_event.
CREATE OR REPLACE FUNCTION public.claim_failed_payment_transition(
  p_case_id uuid,
  p_tenant_id uuid,
  p_transition text,
  p_idempotency_key text,
  p_occurred_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted text;
  v_row public.failed_payment_transitions%ROWTYPE;
  v_stale_cutoff timestamptz := clock_timestamp() - interval '15 minutes';
  v_key text := trim(coalesce(p_idempotency_key, ''));
BEGIN
  IF p_case_id IS NULL OR p_tenant_id IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'failed payment transition claim is incomplete';
  END IF;
  IF p_transition NOT IN ('pause', 'restart', 'cancel', 'write_off') THEN
    RAISE EXCEPTION 'unknown failed payment transition';
  END IF;

  INSERT INTO public.failed_payment_transitions (
    case_id, tenant_id, transition, idempotency_key, status, occurred_at, claimed_at
  ) VALUES (
    p_case_id, p_tenant_id, p_transition, v_key, 'processing',
    coalesce(p_occurred_at, clock_timestamp()), clock_timestamp()
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING idempotency_key INTO v_inserted;

  IF v_inserted IS NOT NULL THEN
    RETURN 'process';
  END IF;

  SELECT * INTO v_row
    FROM public.failed_payment_transitions
   WHERE idempotency_key = v_key
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'locked';
  END IF;
  IF v_row.status = 'processed' THEN
    RETURN 'skip';
  END IF;
  IF v_row.status = 'processing' AND v_row.claimed_at > v_stale_cutoff THEN
    RETURN 'locked';
  END IF;

  UPDATE public.failed_payment_transitions
     SET status = 'processing',
         claimed_at = clock_timestamp(),
         occurred_at = coalesce(p_occurred_at, occurred_at)
   WHERE idempotency_key = v_key;
  RETURN 'process';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_failed_payment_transition(
  p_idempotency_key text,
  p_success boolean,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.failed_payment_transitions%ROWTYPE;
  v_key text := trim(coalesce(p_idempotency_key, ''));
BEGIN
  IF v_key = '' THEN
    RETURN;
  END IF;

  SELECT * INTO v_row
    FROM public.failed_payment_transitions
   WHERE idempotency_key = v_key
     FOR UPDATE;
  IF NOT FOUND OR v_row.status = 'processed' THEN
    RETURN;
  END IF;

  UPDATE public.failed_payment_transitions
     SET status = CASE WHEN p_success THEN 'processed' ELSE 'failed' END,
         processed_at = CASE WHEN p_success THEN clock_timestamp() ELSE NULL END,
         detail = coalesce(p_detail, '{}'::jsonb)
   WHERE idempotency_key = v_key;
  IF NOT p_success THEN
    RETURN;
  END IF;

  IF v_row.transition = 'pause' THEN
    UPDATE public.failed_payment_cases
       SET paused_at = coalesce(paused_at, v_row.occurred_at),
           status = CASE
             WHEN status IN ('cancelled', 'restarted', 'recovered') THEN status
             ELSE 'paused'
           END,
           updated_at = clock_timestamp()
     WHERE id = v_row.case_id AND restarted_at IS NULL AND cancelled_at IS NULL;
  ELSIF v_row.transition = 'restart' THEN
    UPDATE public.failed_payment_cases
       SET restarted_at = coalesce(restarted_at, v_row.occurred_at),
           status = 'restarted',
           updated_at = clock_timestamp()
     WHERE id = v_row.case_id AND cancelled_at IS NULL;
  ELSIF v_row.transition = 'cancel' THEN
    UPDATE public.failed_payment_cases
       SET cancelled_at = coalesce(cancelled_at, v_row.occurred_at),
           status = 'cancelled',
           updated_at = clock_timestamp()
     WHERE id = v_row.case_id;
  ELSIF v_row.transition = 'write_off' THEN
    UPDATE public.failed_payment_cases
       SET written_off_invoice_id = coalesce(
             written_off_invoice_id,
             nullif(coalesce(p_detail, '{}'::jsonb)->>'writtenOffInvoiceId', '')
           ),
           updated_at = clock_timestamp()
     WHERE id = v_row.case_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_failed_payment_transition(uuid, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_failed_payment_transition(uuid, uuid, text, text, timestamptz)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.complete_failed_payment_transition(text, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_failed_payment_transition(text, boolean, jsonb)
  TO postgres, service_role;
