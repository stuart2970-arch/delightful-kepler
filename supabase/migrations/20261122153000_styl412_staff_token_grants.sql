-- STYL-412 follow-up: staff Google tokens must not be readable by tenant members.
-- Additive and idempotent. Does not edit earlier migrations. No DROP. No data rewrite.
-- Depends on 20261122150000, which adds google_access_token, google_refresh_token,
-- and google_token_expiry. service_role keeps its existing table privileges.
-- Apply on production by name later. Do not use `supabase db push`.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS google_connected boolean
  GENERATED ALWAYS AS (
    google_access_token IS NOT NULL OR google_refresh_token IS NOT NULL
  ) STORED;

COMMENT ON COLUMN public.staff.google_connected IS
  'True when a Google access or refresh token is stored. Safe for the signed-in tenant to read. The token columns themselves are not.';

-- Column SELECT for authenticated. Table INSERT, UPDATE, and DELETE stay as they
-- are, so owner/admin inserts and colleague profile updates of non-token columns
-- still pass the existing policies. A user-client select=* or RETURNING * fails
-- because the token columns are omitted; callers must list the columns they read.
-- google_connected is generated, so inserts and updates must not write it.
DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'staff'
    AND column_name NOT IN (
      'google_access_token',
      'google_refresh_token',
      'google_token_expiry'
    );

  IF cols IS NULL
     OR position('google_calendar_id' IN cols) = 0
     OR position('google_connected' IN cols) = 0
     OR position('google_access_token' IN cols) > 0
     OR position('google_refresh_token' IN cols) > 0
     OR position('google_token_expiry' IN cols) > 0
  THEN
    RAISE EXCEPTION 'staff column grant list is missing a public column or includes a token column';
  END IF;

  EXECUTE 'REVOKE SELECT ON TABLE public.staff FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.staff TO authenticated', cols);
END $$;

-- House tenant: StyleFlo's own slug and its chatbots stay editable.
-- Keyed by tenant id or slug so a superadmin can add a row without a deploy.
-- Sign-up of a new tenant still cannot take a reserved slug. The exemption
-- applies when the existing row is already the house tenant (update), or when
-- a chatbot belongs to that tenant.
CREATE TABLE IF NOT EXISTS public.moderation_house_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  slug text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_house_allowlist_target CHECK (tenant_id IS NOT NULL OR slug IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS moderation_house_allowlist_slug_key
  ON public.moderation_house_allowlist (lower(slug))
  WHERE slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS moderation_house_allowlist_tenant_key
  ON public.moderation_house_allowlist (tenant_id)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.moderation_house_allowlist ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'moderation_house_allowlist'
      AND policyname = 'moderation_house_allowlist_superadmin'
  ) THEN
    CREATE POLICY moderation_house_allowlist_superadmin
      ON public.moderation_house_allowlist
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_super_admin IS TRUE
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_super_admin IS TRUE
      ));
  END IF;
END $$;

REVOKE ALL ON TABLE public.moderation_house_allowlist FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.moderation_house_allowlist TO authenticated;
GRANT ALL ON TABLE public.moderation_house_allowlist TO service_role;

INSERT INTO public.moderation_house_allowlist (slug, note)
SELECT 'styleflo', 'StyleFlo house tenant. Its slug and its chatbots skip reserved and brand-token name rules.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.moderation_house_allowlist WHERE lower(slug) = 'styleflo'
);

CREATE OR REPLACE FUNCTION public.moderation_is_house(p_tenant_id uuid, p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.moderation_house_allowlist a
    WHERE (p_tenant_id IS NOT NULL AND a.tenant_id = p_tenant_id)
       OR (
         p_slug IS NOT NULL
         AND a.slug IS NOT NULL
         AND lower(a.slug) = lower(btrim(p_slug))
       )
       OR (
         p_tenant_id IS NOT NULL
         AND a.slug IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM public.tenants t
           WHERE t.id = p_tenant_id
             AND t.slug IS NOT NULL
             AND lower(t.slug) = lower(a.slug)
         )
       )
  );
$fn$;

REVOKE ALL ON FUNCTION public.moderation_is_house(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moderation_is_house(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.moderation_name_shape(p_value text)
RETURNS TABLE(spaced text, slug text, tokens text[])
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  v_normalized text;
  v_spaced text;
BEGIN
  v_normalized := public.moderation_normalize(COALESCE(p_value, ''));
  v_spaced := trim(both ' ' FROM regexp_replace(v_normalized, '[^a-z0-9]+', ' ', 'g'));
  spaced := v_spaced;
  slug := regexp_replace(v_normalized, '[^a-z0-9]+', '', 'g');
  IF v_spaced = '' THEN
    tokens := ARRAY[]::text[];
  ELSE
    tokens := regexp_split_to_array(v_spaced, ' ');
  END IF;
  RETURN NEXT;
END;
$fn$;

REVOKE ALL ON FUNCTION public.moderation_name_shape(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moderation_name_shape(text) TO service_role;

-- True when the name is a brand token, or an impersonation phrase that itself
-- contains a brand token (StyleFlo Support). A plain impersonation such as
-- "Support" stays blocked. Severe profanity is not a brand hit.
CREATE OR REPLACE FUNCTION public.moderation_is_house_brand(p_value text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_spaced text;
  v_tokens text[];
BEGIN
  SELECT s.spaced, s.tokens INTO v_spaced, v_tokens
  FROM public.moderation_name_shape(p_value) s;

  IF EXISTS (
    SELECT 1
    FROM public.moderation_terms t
    WHERE t.kind = 'brand_token'
      AND t.action = 'block'
      AND t.term = ANY(v_tokens)
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.moderation_terms t
    WHERE t.kind = 'impersonation'
      AND t.action = 'block'
      AND t.term = v_spaced
      AND EXISTS (
        SELECT 1
        FROM public.moderation_terms b
        WHERE b.kind = 'brand_token'
          AND b.action = 'block'
          AND position(b.term IN t.term) > 0
      )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.moderation_is_house_brand(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moderation_is_house_brand(text) TO service_role;

CREATE OR REPLACE FUNCTION public.moderation_profanity_decision(p_value text)
RETURNS TABLE(action text, message text, term text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_block constant text := 'Sorry, that name can''t be used. Please choose a different one.';
  v_review constant text := 'Thanks! We need to check this name quickly. You can carry on setting up, and we''ll be in touch within one working day.';
  v_spaced text;
  v_tokens text[];
  v_severe text;
  v_mild text;
BEGIN
  SELECT s.spaced, s.tokens INTO v_spaced, v_tokens
  FROM public.moderation_name_shape(p_value) s;

  SELECT t.term INTO v_severe
  FROM public.moderation_terms t
  WHERE t.kind = 'profanity'
    AND t.action <> 'allow'
    AND (t.action = 'block' OR t.severity >= 3)
    AND (
      t.term = ANY(v_tokens)
      OR (
        position(' ' IN t.term) > 0
        AND position(' ' || t.term || ' ' IN ' ' || v_spaced || ' ') > 0
      )
    )
  ORDER BY t.severity DESC
  LIMIT 1;

  IF v_severe IS NOT NULL THEN
    RETURN QUERY SELECT 'block'::text, v_block, v_severe;
    RETURN;
  END IF;

  SELECT t.term INTO v_mild
  FROM public.moderation_terms t
  WHERE t.kind = 'profanity'
    AND t.action = 'review'
    AND t.severity < 3
    AND (
      t.term = ANY(v_tokens)
      OR (
        position(' ' IN t.term) > 0
        AND position(' ' || t.term || ' ' IN ' ' || v_spaced || ' ') > 0
      )
    )
  ORDER BY t.severity DESC
  LIMIT 1;

  IF v_mild IS NOT NULL THEN
    RETURN QUERY SELECT 'review'::text, v_review, v_mild;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'allow'::text, NULL::text, NULL::text;
END;
$fn$;

REVOKE ALL ON FUNCTION public.moderation_profanity_decision(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moderation_profanity_decision(text) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_tenant_name_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  salon_action text;
  salon_message text;
  slug_action text;
  slug_message text;
  v_house boolean := false;
  profanity_action text;
  profanity_message text;
BEGIN
  IF coalesce(current_setting('app.seed_mode', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.company_name IS NOT DISTINCT FROM OLD.company_name
     AND NEW.slug IS NOT DISTINCT FROM OLD.slug THEN
    RETURN NEW;
  END IF;

  -- Existing house row only. A new sign-up cannot claim the reserved slug.
  IF TG_OP = 'UPDATE' THEN
    v_house := public.moderation_is_house(OLD.id, OLD.slug);
  END IF;

  SELECT c.action, c.message INTO salon_action, salon_message
  FROM public.classify_moderated_name(NEW.company_name, 'salon') c;

  SELECT c.action, c.message INTO slug_action, slug_message
  FROM public.classify_moderated_name(COALESCE(NEW.slug, ''), 'slug') c;

  IF v_house AND slug_action = 'reserved' THEN
    SELECT d.action, d.message INTO profanity_action, profanity_message
    FROM public.moderation_profanity_decision(COALESCE(NEW.slug, '')) d;
    slug_action := profanity_action;
    slug_message := profanity_message;
  END IF;

  IF salon_action IN ('block', 'reserved', 'emoji') THEN
    RAISE EXCEPTION '%', salon_message USING ERRCODE = '23514';
  END IF;
  IF slug_action IN ('block', 'reserved', 'emoji') THEN
    RAISE EXCEPTION '%', slug_message USING ERRCODE = '23514';
  END IF;

  IF salon_action = 'review' OR slug_action = 'review' THEN
    NEW.name_review_status := 'pending';
    NEW.page_published := false;
    INSERT INTO public.moderation_events (context, action, term, value_text, tenant_id)
    VALUES (
      CASE WHEN salon_action = 'review' THEN 'salon' ELSE 'slug' END,
      'review',
      NULL,
      left(NEW.company_name || ' / ' || COALESCE(NEW.slug, ''), 500),
      NEW.id
    );
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.name_review_status := 'clear';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.enforce_chatbot_name_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  agent_name text;
  name_action text;
  name_message text;
  agent_action text;
  agent_message text;
  final_action text;
  final_message text;
  v_house boolean := false;
  profanity_action text;
  profanity_message text;
BEGIN
  IF coalesce(current_setting('app.seed_mode', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  agent_name := NULLIF(btrim(COALESCE(NEW.configuration_json->>'agent_name', '')), '');

  IF TG_OP = 'UPDATE'
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND COALESCE(NEW.configuration_json->>'agent_name', '')
         IS NOT DISTINCT FROM COALESCE(OLD.configuration_json->>'agent_name', '') THEN
    RETURN NEW;
  END IF;

  v_house := public.moderation_is_house(NEW.tenant_id, NULL);

  SELECT c.action, c.message INTO name_action, name_message
  FROM public.classify_moderated_name(COALESCE(NEW.name, ''), 'persona') c;

  IF v_house AND name_action = 'block' AND public.moderation_is_house_brand(COALESCE(NEW.name, '')) THEN
    SELECT d.action, d.message INTO profanity_action, profanity_message
    FROM public.moderation_profanity_decision(COALESCE(NEW.name, '')) d;
    name_action := profanity_action;
    name_message := profanity_message;
  END IF;

  agent_action := 'allow';
  agent_message := NULL;
  IF agent_name IS NOT NULL THEN
    SELECT c.action, c.message INTO agent_action, agent_message
    FROM public.classify_moderated_name(agent_name, 'persona') c;
    IF v_house AND agent_action = 'block' AND public.moderation_is_house_brand(agent_name) THEN
      SELECT d.action, d.message INTO profanity_action, profanity_message
      FROM public.moderation_profanity_decision(agent_name) d;
      agent_action := profanity_action;
      agent_message := profanity_message;
    END IF;
  END IF;

  IF name_action IN ('block', 'reserved', 'emoji') THEN
    final_action := name_action;
    final_message := name_message;
  ELSIF agent_action IN ('block', 'reserved', 'emoji') THEN
    final_action := agent_action;
    final_message := agent_message;
  ELSIF name_action = 'review' OR agent_action = 'review' THEN
    final_action := 'review';
    final_message := COALESCE(name_message, agent_message);
  ELSE
    final_action := 'allow';
    final_message := NULL;
  END IF;

  IF final_action IN ('block', 'reserved', 'emoji') THEN
    RAISE EXCEPTION '%', final_message USING ERRCODE = '23514';
  END IF;

  IF final_action = 'review' THEN
    NEW.name_review_status := 'pending';
    INSERT INTO public.moderation_events (context, action, value_text, tenant_id)
    VALUES ('persona', 'review', left(COALESCE(agent_name, NEW.name), 500), NEW.tenant_id);
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.name_review_status := 'clear';
  END IF;

  RETURN NEW;
END;
$fn$;

-- A moderation bug must not stop a visitor message from being stored.
CREATE OR REPLACE FUNCTION public.flag_visitor_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  flag_action text;
  flag_term text;
BEGIN
  BEGIN
    IF coalesce(current_setting('app.seed_mode', true), '') = 'on' THEN
      RETURN NEW;
    END IF;
    IF NEW.sender_type IS DISTINCT FROM 'user' THEN
      RETURN NEW;
    END IF;

    SELECT c.action, c.term INTO flag_action, flag_term
    FROM public.classify_moderated_name(COALESCE(NEW.text_content, ''), 'chat') c;

    IF flag_action = 'flag' THEN
      INSERT INTO public.moderation_events (context, action, term, value_text, tenant_id)
      VALUES ('chat', 'flag', flag_term, left(NEW.text_content, 500), NEW.tenant_id);
    END IF;

    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'flag_visitor_message skipped: %', SQLERRM;
    RETURN NEW;
  END;
END;
$fn$;
