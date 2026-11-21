-- =========================================================================
-- STYL-279: Record Stripe webhook event ids so retries do not re-run billing.
-- Local / staging only — never apply to live tkoasyjvrgaglofpzduq.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.stripe_webhook_processed_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'failed'))
);

ALTER TABLE public.stripe_webhook_processed_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stripe_webhook_processed_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stripe_webhook_processed_events TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted_id text;
  v_row public.stripe_webhook_processed_events%ROWTYPE;
  v_stale_cutoff timestamptz := clock_timestamp() - interval '15 minutes';
BEGIN
  IF coalesce(trim(p_event_id), '') = '' THEN
    RETURN 'process';
  END IF;

  INSERT INTO public.stripe_webhook_processed_events (event_id, event_type, status)
  VALUES (p_event_id, coalesce(nullif(trim(p_event_type), ''), 'unknown'), 'processing')
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL THEN
    RETURN 'process';
  END IF;

  SELECT *
    INTO v_row
    FROM public.stripe_webhook_processed_events
   WHERE event_id = p_event_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'locked';
  END IF;

  IF v_row.status = 'processed' THEN
    RETURN 'skip';
  END IF;

  IF v_row.status = 'processing' AND v_row.received_at > v_stale_cutoff THEN
    RETURN 'locked';
  END IF;

  UPDATE public.stripe_webhook_processed_events
     SET status = 'processing',
         received_at = clock_timestamp(),
         event_type = coalesce(nullif(trim(p_event_type), ''), event_type)
   WHERE event_id = p_event_id;

  RETURN 'process';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_stripe_webhook_event(
  p_event_id text,
  p_success boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(trim(p_event_id), '') = '' THEN
    RETURN;
  END IF;

  UPDATE public.stripe_webhook_processed_events
     SET status = CASE WHEN p_success THEN 'processed' ELSE 'failed' END,
         processed_at = CASE WHEN p_success THEN clock_timestamp() ELSE NULL END
   WHERE event_id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text, text)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.complete_stripe_webhook_event(text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_stripe_webhook_event(text, boolean)
  TO postgres, service_role;