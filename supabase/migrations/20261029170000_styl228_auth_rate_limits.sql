-- STYL-228: shared counters for magic-link and check-email.
-- Apply to local Supabase for development. Apply to staging, then production,
-- only as part of a deploy that Stuart has approved. Do not run against the
-- live project from a developer machine.

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  rate_key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on auth_rate_limits" ON public.auth_rate_limits;
CREATE POLICY "Service role full access on auth_rate_limits"
  ON public.auth_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.consume_auth_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_key IS NULL OR length(trim(p_key)) = 0 OR p_limit IS NULL OR p_limit < 1
     OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RETURN false;
  END IF;

  INSERT INTO public.auth_rate_limits (rate_key, count, window_start, updated_at)
  VALUES (p_key, 1, now(), now())
  ON CONFLICT (rate_key) DO UPDATE
  SET
    count = CASE
      WHEN auth_rate_limits.window_start < now() - make_interval(secs => p_window_seconds) THEN 1
      ELSE auth_rate_limits.count + 1
    END,
    window_start = CASE
      WHEN auth_rate_limits.window_start < now() - make_interval(secs => p_window_seconds) THEN now()
      ELSE auth_rate_limits.window_start
    END,
    updated_at = now()
  RETURNING count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_auth_rate_limit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_auth_rate_limit(text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_auth_rate_limit(text, integer, integer) TO service_role;
