-- STYL-225: banned words and reserved names.
-- Idempotent and additive. Direct inserts hit the triggers, so the API is not
-- the only gate. Seed mode (app.seed_mode = on) skips the triggers.
-- Terms are seeded once (ON CONFLICT DO NOTHING) so a later superadmin edit
-- is not overwritten when this migration is applied again.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS name_review_status text NOT NULL DEFAULT 'clear',
  ADD COLUMN IF NOT EXISTS page_published boolean NOT NULL DEFAULT false;

ALTER TABLE public.chatbots
  ADD COLUMN IF NOT EXISTS name_review_status text NOT NULL DEFAULT 'clear';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_name_review_status_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_name_review_status_check
      CHECK (name_review_status IN ('clear', 'pending'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chatbots_name_review_status_check'
  ) THEN
    ALTER TABLE public.chatbots
      ADD CONSTRAINT chatbots_name_review_status_check
      CHECK (name_review_status IN ('clear', 'pending'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.moderation_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('profanity', 'reserved', 'impersonation', 'brand_token')),
  severity integer NOT NULL DEFAULT 0,
  action text NOT NULL CHECK (action IN ('allow', 'review', 'block', 'reserved')),
  source text NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'superadmin')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term, kind)
);

CREATE INDEX IF NOT EXISTS idx_moderation_terms_term ON public.moderation_terms (term);
CREATE INDEX IF NOT EXISTS idx_moderation_terms_source ON public.moderation_terms (source);

CREATE TABLE IF NOT EXISTS public.moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context text NOT NULL,
  action text NOT NULL,
  term text,
  value_text text,
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_events_created ON public.moderation_events (created_at DESC);

ALTER TABLE public.moderation_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'moderation_terms' AND policyname = 'moderation_terms_superadmin'
  ) THEN
    CREATE POLICY moderation_terms_superadmin ON public.moderation_terms
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
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'moderation_events' AND policyname = 'moderation_events_superadmin_select'
  ) THEN
    CREATE POLICY moderation_events_superadmin_select ON public.moderation_events
      FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_super_admin IS TRUE
      ));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.moderation_contains_emoji(p_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  i integer;
  c integer;
BEGIN
  IF p_value IS NULL OR p_value = '' THEN
    RETURN false;
  END IF;
  FOR i IN 1..char_length(p_value) LOOP
    c := ascii(substr(p_value, i, 1));
    IF c >= 127744 OR (c BETWEEN 9728 AND 10175) THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.moderation_normalize(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  s text;
BEGIN
  IF p_value IS NULL THEN
    RETURN '';
  END IF;
  s := lower(p_value);
  s := translate(s,
    'àáâãäåāăąçćčèéêëìíîïñòóôõöùúûüýÿ',
    'aaaaaaaaaccceeeeiiiinooooouuuuyy');
  s := translate(s,
    'аеорсухіѕјАЕОРСУХІ',
    'aeopcyxicjAEOPCYXI');
  s := translate(s, '@431!|5$70(/62', 'aaeiiisstoclgz');
  s := regexp_replace(s, '(.)\1{2,}', '\1', 'g');
  RETURN s;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.classify_moderated_name(p_value text, p_context text)
RETURNS TABLE(action text, message text, term text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_block constant text := 'Sorry, that name can''t be used. Please choose a different one.';
  v_review constant text := 'Thanks! We need to check this name quickly. You can carry on setting up, and we''ll be in touch within one working day.';
  v_reserved constant text := 'That web address is reserved. Try adding your town, e.g. glamour-puss-leeds.';
  v_emoji constant text := 'Please use letters and numbers only.';
  v_normalized text;
  v_spaced text;
  v_slug text;
  v_tokens text[];
  v_severe text;
  v_mild text;
  v_emoji_hit boolean;
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN QUERY SELECT 'allow'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  v_emoji_hit := public.moderation_contains_emoji(p_value);
  IF v_emoji_hit AND p_context IN ('salon', 'slug', 'persona') THEN
    RETURN QUERY SELECT 'emoji'::text, v_emoji, NULL::text;
    RETURN;
  END IF;

  v_normalized := public.moderation_normalize(p_value);
  v_spaced := trim(both ' ' from regexp_replace(v_normalized, '[^a-z0-9]+', ' ', 'g'));
  v_slug := regexp_replace(v_normalized, '[^a-z0-9]+', '', 'g');
  IF v_spaced = '' THEN
    v_tokens := ARRAY[]::text[];
  ELSE
    v_tokens := regexp_split_to_array(v_spaced, ' ');
  END IF;

  SELECT t.term INTO v_severe
  FROM public.moderation_terms t
  WHERE t.kind = 'profanity'
    AND t.action <> 'allow'
    AND (t.action = 'block' OR t.severity >= 3)
    AND (
      t.term = ANY(v_tokens)
      OR (
        position(' ' in t.term) > 0
        AND position(' ' || t.term || ' ' in ' ' || v_spaced || ' ') > 0
      )
    )
  ORDER BY t.severity DESC
  LIMIT 1;

  SELECT t.term INTO v_mild
  FROM public.moderation_terms t
  WHERE t.kind = 'profanity'
    AND t.action = 'review'
    AND t.severity < 3
    AND (
      t.term = ANY(v_tokens)
      OR (
        position(' ' in t.term) > 0
        AND position(' ' || t.term || ' ' in ' ' || v_spaced || ' ') > 0
      )
    )
  ORDER BY t.severity DESC
  LIMIT 1;

  IF p_context = 'chat' THEN
    IF v_emoji_hit OR v_severe IS NOT NULL OR v_mild IS NOT NULL THEN
      RETURN QUERY SELECT 'flag'::text, NULL::text, COALESCE(v_severe, v_mild, 'emoji');
      RETURN;
    END IF;
    RETURN QUERY SELECT 'allow'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF p_context = 'slug' THEN
    IF EXISTS (
      SELECT 1 FROM public.moderation_terms t
      WHERE t.kind = 'reserved'
        AND t.action = 'reserved'
        AND t.term = v_slug
    ) THEN
      RETURN QUERY SELECT 'reserved'::text, v_reserved, v_slug;
      RETURN;
    END IF;
    IF v_severe IS NOT NULL THEN
      RETURN QUERY SELECT 'block'::text, v_block, v_severe;
      RETURN;
    END IF;
    IF v_mild IS NOT NULL THEN
      RETURN QUERY SELECT 'review'::text, v_review, v_mild;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'allow'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF p_context = 'owner' THEN
    IF v_severe IS NOT NULL THEN
      RETURN QUERY SELECT 'block'::text, v_block, v_severe;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'allow'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF p_context = 'persona' THEN
    IF EXISTS (
      SELECT 1 FROM public.moderation_terms t
      WHERE t.kind = 'brand_token'
        AND t.action = 'block'
        AND t.term = ANY(v_tokens)
    ) OR EXISTS (
      SELECT 1 FROM public.moderation_terms t
      WHERE t.kind = 'impersonation'
        AND t.action = 'block'
        AND t.term = v_spaced
    ) THEN
      RETURN QUERY SELECT 'block'::text, v_block, v_spaced;
      RETURN;
    END IF;
  END IF;

  IF v_severe IS NOT NULL AND p_context IN ('salon', 'persona') THEN
    RETURN QUERY SELECT 'block'::text, v_block, v_severe;
    RETURN;
  END IF;

  IF v_mild IS NOT NULL AND p_context IN ('salon', 'persona') THEN
    RETURN QUERY SELECT 'review'::text, v_review, v_mild;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'allow'::text, NULL::text, NULL::text;
END;
$fn$;

REVOKE ALL ON FUNCTION public.classify_moderated_name(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classify_moderated_name(text, text) TO service_role;

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
BEGIN
  IF coalesce(current_setting('app.seed_mode', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.company_name IS NOT DISTINCT FROM OLD.company_name
     AND NEW.slug IS NOT DISTINCT FROM OLD.slug THEN
    RETURN NEW;
  END IF;

  SELECT c.action, c.message INTO salon_action, salon_message
  FROM public.classify_moderated_name(NEW.company_name, 'salon') c;

  SELECT c.action, c.message INTO slug_action, slug_message
  FROM public.classify_moderated_name(COALESCE(NEW.slug, ''), 'slug') c;

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

  SELECT c.action, c.message INTO name_action, name_message
  FROM public.classify_moderated_name(COALESCE(NEW.name, ''), 'persona') c;

  agent_action := 'allow';
  agent_message := NULL;
  IF agent_name IS NOT NULL THEN
    SELECT c.action, c.message INTO agent_action, agent_message
    FROM public.classify_moderated_name(agent_name, 'persona') c;
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
END;
$fn$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_tenant_name_policy') THEN
    CREATE TRIGGER enforce_tenant_name_policy
      BEFORE INSERT OR UPDATE ON public.tenants
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_tenant_name_policy();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_chatbot_name_policy') THEN
    CREATE TRIGGER enforce_chatbot_name_policy
      BEFORE INSERT OR UPDATE ON public.chatbots
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_chatbot_name_policy();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'flag_visitor_message') THEN
    CREATE TRIGGER flag_visitor_message
      AFTER INSERT ON public.messages
      FOR EACH ROW
      EXECUTE FUNCTION public.flag_visitor_message();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  matching_staff_record RECORD;
  new_tenant_id uuid;
  company_name_input text;
  base_slug text;
  final_slug text;
  counter integer := 1;
  owner_action text;
  owner_message text;
BEGIN
  IF coalesce(current_setting('app.seed_mode', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT c.action, c.message INTO owner_action, owner_message
  FROM public.classify_moderated_name(NEW.raw_user_meta_data->>'full_name', 'owner') c;
  IF owner_action = 'block' THEN
    RAISE EXCEPTION '%', owner_message USING ERRCODE = '23514';
  END IF;

  SELECT * INTO matching_staff_record
  FROM public.staff
  WHERE LOWER(TRIM(email)) = LOWER(TRIM(NEW.email))
  LIMIT 1;

  IF matching_staff_record.id IS NOT NULL THEN
    INSERT INTO public.profiles (id, tenant_id, role, is_super_admin)
    VALUES (NEW.id, matching_staff_record.tenant_id, 'member', false);

    UPDATE public.staff
    SET user_id = NEW.id
    WHERE id = matching_staff_record.id;
  ELSE
    company_name_input := COALESCE(NEW.raw_user_meta_data->>'company_name', 'My Workspace');
    base_slug := COALESCE(
      NEW.raw_user_meta_data->>'slug',
      trim(both '-' from regexp_replace(lower(company_name_input), '[^a-z0-9]+', '-', 'g'))
    );

    IF base_slug IS NULL OR base_slug = '' THEN
      base_slug := 'my-workspace';
    END IF;

    final_slug := base_slug;
    WHILE EXISTS (SELECT 1 FROM public.tenants WHERE slug = final_slug) LOOP
      final_slug := base_slug || '-' || counter;
      counter := counter + 1;
    END LOOP;

    INSERT INTO public.tenants (company_name, slug)
    VALUES (company_name_input, final_slug)
    RETURNING id INTO new_tenant_id;

    INSERT INTO public.profiles (id, tenant_id, role, is_super_admin)
    VALUES (NEW.id, new_tenant_id, 'owner', false);
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

-- Generated by scripts/generate-moderation-terms.mjs. Do not edit by hand.
INSERT INTO public.moderation_terms (term, kind, severity, action, source)
VALUES
  ('1m1j', 'profanity', 4, 'block', 'seed'),
  ('1man1jar', 'profanity', 4, 'block', 'seed'),
  ('1 man 1 jar', 'profanity', 4, 'block', 'seed'),
  ('one man one jar', 'profanity', 4, 'block', 'seed'),
  ('one jar one man', 'profanity', 4, 'block', 'seed'),
  ('2g1c', 'profanity', 4, 'block', 'seed'),
  ('2girls1cup', 'profanity', 4, 'block', 'seed'),
  ('2 girls 1 cup', 'profanity', 4, 'block', 'seed'),
  ('two girls one cup', 'profanity', 4, 'block', 'seed'),
  ('one cup two girls', 'profanity', 4, 'block', 'seed'),
  ('acrotomophilia', 'profanity', 3, 'block', 'seed'),
  ('acrotomophile', 'profanity', 3, 'block', 'seed'),
  ('black cock', 'profanity', 3, 'block', 'seed'),
  ('big cock', 'profanity', 3, 'block', 'seed'),
  ('huge cock', 'profanity', 3, 'block', 'seed'),
  ('giant cock', 'profanity', 3, 'block', 'seed'),
  ('massive cock', 'profanity', 3, 'block', 'seed'),
  ('throbbing cock', 'profanity', 3, 'block', 'seed'),
  ('alabama hot pocket', 'profanity', 3, 'block', 'seed'),
  ('alabama tuna melt', 'profanity', 3, 'block', 'seed'),
  ('alaskan pipeline', 'profanity', 3, 'block', 'seed'),
  ('algophilia', 'profanity', 3, 'block', 'seed'),
  ('algophile', 'profanity', 3, 'block', 'seed'),
  ('anal', 'profanity', 2, 'review', 'seed'),
  ('anal assassin', 'profanity', 3, 'block', 'seed'),
  ('anal astronaut', 'profanity', 3, 'block', 'seed'),
  ('anilingus', 'profanity', 3, 'block', 'seed'),
  ('anus', 'profanity', 1, 'review', 'seed'),
  ('apeshit', 'profanity', 2, 'review', 'seed'),
  ('ape-shit', 'profanity', 2, 'review', 'seed'),
  ('ape shit', 'profanity', 2, 'review', 'seed'),
  ('apotemnophilia', 'profanity', 3, 'block', 'seed'),
  ('apotemnophile', 'profanity', 3, 'block', 'seed'),
  ('arse', 'profanity', 2, 'review', 'seed'),
  ('arsehole', 'profanity', 3, 'block', 'seed'),
  ('asshole', 'profanity', 3, 'block', 'seed'),
  ('ass', 'profanity', 1, 'review', 'seed'),
  ('ass bandit', 'profanity', 3, 'block', 'seed'),
  ('arse bandit', 'profanity', 3, 'block', 'seed'),
  ('autoerotic', 'profanity', 3, 'block', 'seed'),
  ('auto erotic', 'profanity', 3, 'block', 'seed'),
  ('babeland', 'profanity', 3, 'block', 'seed'),
  ('baby batter', 'profanity', 3, 'block', 'seed'),
  ('baby gravy', 'profanity', 3, 'block', 'seed'),
  ('baby juice', 'profanity', 3, 'block', 'seed'),
  ('ball batter', 'profanity', 3, 'block', 'seed'),
  ('ball gravy', 'profanity', 3, 'block', 'seed'),
  ('ball gag', 'profanity', 3, 'block', 'seed'),
  ('ball-gag', 'profanity', 3, 'block', 'seed'),
  ('ballgag', 'profanity', 3, 'block', 'seed'),
  ('ball kicking', 'profanity', 3, 'block', 'seed'),
  ('ball-kicking', 'profanity', 3, 'block', 'seed'),
  ('ball licking', 'profanity', 3, 'block', 'seed'),
  ('ball-licking', 'profanity', 3, 'block', 'seed'),
  ('ball sack', 'profanity', 3, 'block', 'seed'),
  ('ball sucking', 'profanity', 3, 'block', 'seed'),
  ('ball-sucking', 'profanity', 3, 'block', 'seed'),
  ('ballcuzi', 'profanity', 3, 'block', 'seed'),
  ('bangbros', 'profanity', 3, 'block', 'seed'),
  ('bang bros', 'profanity', 3, 'block', 'seed'),
  ('bangbus', 'profanity', 3, 'block', 'seed'),
  ('bang bus', 'profanity', 3, 'block', 'seed'),
  ('bareback', 'profanity', 3, 'block', 'seed'),
  ('barely legal', 'profanity', 4, 'block', 'seed'),
  ('bastard', 'profanity', 3, 'block', 'seed'),
  ('bastinado', 'profanity', 3, 'block', 'seed'),
  ('batty boy', 'profanity', 3, 'block', 'seed'),
  ('battyboy', 'profanity', 3, 'block', 'seed'),
  ('batty boi', 'profanity', 3, 'block', 'seed'),
  ('battyboi', 'profanity', 3, 'block', 'seed'),
  ('bdsm', 'profanity', 3, 'block', 'seed'),
  ('bean flicker', 'profanity', 3, 'block', 'seed'),
  ('bean-flicker', 'profanity', 3, 'block', 'seed'),
  ('beanflicker', 'profanity', 3, 'block', 'seed'),
  ('bean queen', 'profanity', 3, 'block', 'seed'),
  ('beaner', 'profanity', 3, 'block', 'seed'),
  ('beaners', 'profanity', 3, 'block', 'seed'),
  ('beastiality', 'profanity', 3, 'block', 'seed'),
  ('beestiality', 'profanity', 3, 'block', 'seed'),
  ('bestiality', 'profanity', 3, 'block', 'seed'),
  ('beaver cleaver', 'profanity', 3, 'block', 'seed'),
  ('beaver lips', 'profanity', 3, 'block', 'seed'),
  ('bellend', 'profanity', 3, 'block', 'seed'),
  ('bellesa', 'profanity', 3, 'block', 'seed'),
  ('bicon', 'profanity', 3, 'block', 'seed'),
  ('big boobs', 'profanity', 3, 'block', 'seed'),
  ('big breasts', 'profanity', 3, 'block', 'seed'),
  ('big knockers', 'profanity', 3, 'block', 'seed'),
  ('big tits', 'profanity', 3, 'block', 'seed'),
  ('birdlock', 'profanity', 3, 'block', 'seed'),
  ('bitch', 'profanity', 3, 'block', 'seed'),
  ('bitches', 'profanity', 3, 'block', 'seed'),
  ('bloody', 'profanity', 1, 'review', 'seed'),
  ('blow your load', 'profanity', 3, 'block', 'seed'),
  ('blowjob', 'profanity', 3, 'block', 'seed'),
  ('blow-job', 'profanity', 3, 'block', 'seed'),
  ('blow job', 'profanity', 3, 'block', 'seed'),
  ('blue waffle', 'profanity', 4, 'block', 'seed'),
  ('bluewaffle', 'profanity', 4, 'block', 'seed'),
  ('blumpkin', 'profanity', 3, 'block', 'seed'),
  ('bollocks', 'profanity', 1, 'review', 'seed'),
  ('bone smuggler', 'profanity', 3, 'block', 'seed'),
  ('bone-smuggler', 'profanity', 3, 'block', 'seed'),
  ('bonesmuggler', 'profanity', 3, 'block', 'seed'),
  ('boner', 'profanity', 3, 'block', 'seed'),
  ('raging boner', 'profanity', 3, 'block', 'seed'),
  ('throbbing boner', 'profanity', 3, 'block', 'seed'),
  ('boob', 'profanity', 1, 'review', 'seed'),
  ('booty buffer', 'profanity', 3, 'block', 'seed'),
  ('booty-buffer', 'profanity', 3, 'block', 'seed'),
  ('booty call', 'profanity', 3, 'block', 'seed'),
  ('boston george', 'profanity', 3, 'block', 'seed'),
  ('breasts', 'profanity', 1, 'review', 'seed'),
  ('brown piper', 'profanity', 3, 'block', 'seed'),
  ('brown-piper', 'profanity', 3, 'block', 'seed'),
  ('brownpiper', 'profanity', 3, 'block', 'seed'),
  ('brown shower', 'profanity', 3, 'block', 'seed'),
  ('brown showers', 'profanity', 3, 'block', 'seed'),
  ('brownie king', 'profanity', 3, 'block', 'seed'),
  ('brownie queen', 'profanity', 3, 'block', 'seed'),
  ('buddhahead', 'profanity', 3, 'block', 'seed'),
  ('buddha head', 'profanity', 3, 'block', 'seed'),
  ('buddha-head', 'profanity', 3, 'block', 'seed'),
  ('bufter', 'profanity', 3, 'block', 'seed'),
  ('bufty', 'profanity', 3, 'block', 'seed'),
  ('bugger', 'profanity', 1, 'review', 'seed'),
  ('bukkake', 'profanity', 3, 'block', 'seed'),
  ('bulldyke', 'profanity', 3, 'block', 'seed'),
  ('bullet vibe', 'profanity', 3, 'block', 'seed'),
  ('bullet vibrator', 'profanity', 3, 'block', 'seed'),
  ('bullshit', 'profanity', 2, 'review', 'seed'),
  ('bull-shit', 'profanity', 2, 'review', 'seed'),
  ('bull shit', 'profanity', 2, 'review', 'seed'),
  ('bum chum', 'profanity', 3, 'block', 'seed'),
  ('bum-chum', 'profanity', 3, 'block', 'seed'),
  ('bumchum', 'profanity', 3, 'block', 'seed'),
  ('bum driller', 'profanity', 3, 'block', 'seed'),
  ('bum-driller', 'profanity', 3, 'block', 'seed'),
  ('bumdriller', 'profanity', 3, 'block', 'seed'),
  ('butt boy', 'profanity', 3, 'block', 'seed'),
  ('butt-boy', 'profanity', 3, 'block', 'seed'),
  ('buttboy', 'profanity', 3, 'block', 'seed'),
  ('bum boy', 'profanity', 3, 'block', 'seed'),
  ('bum-boy', 'profanity', 3, 'block', 'seed'),
  ('bumboy', 'profanity', 3, 'block', 'seed'),
  ('butt pilot', 'profanity', 3, 'block', 'seed'),
  ('bum pilot', 'profanity', 3, 'block', 'seed'),
  ('butt pirate', 'profanity', 3, 'block', 'seed'),
  ('butt-pirate', 'profanity', 3, 'block', 'seed'),
  ('bum pirate', 'profanity', 3, 'block', 'seed'),
  ('bum-pirate', 'profanity', 3, 'block', 'seed'),
  ('butt rider', 'profanity', 3, 'block', 'seed'),
  ('buttrider', 'profanity', 3, 'block', 'seed'),
  ('bum rider', 'profanity', 3, 'block', 'seed'),
  ('bumrider', 'profanity', 3, 'block', 'seed'),
  ('butt robber', 'profanity', 3, 'block', 'seed'),
  ('butt-robber', 'profanity', 3, 'block', 'seed'),
  ('buttrobber', 'profanity', 3, 'block', 'seed'),
  ('bum robber', 'profanity', 3, 'block', 'seed'),
  ('bum-robber', 'profanity', 3, 'block', 'seed'),
  ('bumrobber', 'profanity', 3, 'block', 'seed'),
  ('butt rustler', 'profanity', 3, 'block', 'seed'),
  ('bum rustler', 'profanity', 3, 'block', 'seed'),
  ('butthole engineer', 'profanity', 3, 'block', 'seed'),
  ('bumhole engineer', 'profanity', 3, 'block', 'seed'),
  ('camel jockey', 'profanity', 3, 'block', 'seed'),
  ('cameljockey', 'profanity', 3, 'block', 'seed'),
  ('camel jockies', 'profanity', 3, 'block', 'seed'),
  ('cameljockies', 'profanity', 3, 'block', 'seed'),
  ('camel toe', 'profanity', 3, 'block', 'seed'),
  ('canadian porch swing', 'profanity', 3, 'block', 'seed'),
  ('carpet muncher', 'profanity', 3, 'block', 'seed'),
  ('carpetmuncher', 'profanity', 3, 'block', 'seed'),
  ('cheese-eating surrender monkey', 'profanity', 3, 'block', 'seed'),
  ('cheese eating surrender monkey', 'profanity', 3, 'block', 'seed'),
  ('chi chi man', 'profanity', 3, 'block', 'seed'),
  ('chi-chi man', 'profanity', 3, 'block', 'seed'),
  ('chicken queen', 'profanity', 3, 'block', 'seed'),
  ('chinaman', 'profanity', 2, 'review', 'seed'),
  ('china man', 'profanity', 2, 'review', 'seed'),
  ('chinamen', 'profanity', 2, 'review', 'seed'),
  ('china men', 'profanity', 2, 'review', 'seed'),
  ('ching-chong', 'profanity', 2, 'review', 'seed'),
  ('ching chong', 'profanity', 2, 'review', 'seed'),
  ('chink', 'profanity', 3, 'block', 'seed'),
  ('chinks', 'profanity', 3, 'block', 'seed'),
  ('chinky', 'profanity', 3, 'block', 'seed'),
  ('chocolate rosebud', 'profanity', 3, 'block', 'seed'),
  ('chocolate rosebuds', 'profanity', 3, 'block', 'seed'),
  ('cholerophilia', 'profanity', 3, 'block', 'seed'),
  ('cholerophile', 'profanity', 3, 'block', 'seed'),
  ('christ', 'profanity', 1, 'review', 'seed'),
  ('cialis', 'profanity', 3, 'block', 'seed'),
  ('circlejerk', 'profanity', 3, 'block', 'seed'),
  ('circle-jerk', 'profanity', 3, 'block', 'seed'),
  ('cishet', 'profanity', 3, 'block', 'seed'),
  ('cissy', 'profanity', 3, 'block', 'seed'),
  ('cissie', 'profanity', 3, 'block', 'seed'),
  ('claustrophilia', 'profanity', 3, 'block', 'seed'),
  ('claustrophile', 'profanity', 3, 'block', 'seed'),
  ('cleveland accordion', 'profanity', 3, 'block', 'seed'),
  ('cleveland hot waffle', 'profanity', 3, 'block', 'seed'),
  ('cleveland steamer', 'profanity', 3, 'block', 'seed'),
  ('clit', 'profanity', 3, 'block', 'seed'),
  ('clitoris', 'profanity', 3, 'block', 'seed'),
  ('clover clamps', 'profanity', 3, 'block', 'seed'),
  ('clover clamp', 'profanity', 3, 'block', 'seed'),
  ('clunge', 'profanity', 3, 'block', 'seed'),
  ('clusterfuck', 'profanity', 4, 'block', 'seed'),
  ('cluster-fuck', 'profanity', 4, 'block', 'seed'),
  ('cluster fuck', 'profanity', 4, 'block', 'seed'),
  ('cock', 'profanity', 2, 'review', 'seed'),
  ('cockpipe cosmonaut', 'profanity', 3, 'block', 'seed'),
  ('cockstruction worker', 'profanity', 3, 'block', 'seed'),
  ('coimetrophilia', 'profanity', 3, 'block', 'seed'),
  ('coimetrophile', 'profanity', 3, 'block', 'seed'),
  ('collaring', 'profanity', 3, 'block', 'seed'),
  ('collared', 'profanity', 3, 'block', 'seed'),
  ('coon', 'profanity', 3, 'block', 'seed'),
  ('coons', 'profanity', 3, 'block', 'seed'),
  ('coprophilia', 'profanity', 3, 'block', 'seed'),
  ('coprophile', 'profanity', 3, 'block', 'seed'),
  ('coprolagnia', 'profanity', 3, 'block', 'seed'),
  ('cornhole', 'profanity', 3, 'block', 'seed'),
  ('crafty butcher', 'profanity', 3, 'block', 'seed'),
  ('crap', 'profanity', 1, 'review', 'seed'),
  ('creampie', 'profanity', 3, 'block', 'seed'),
  ('cream-pie', 'profanity', 3, 'block', 'seed'),
  ('cum', 'profanity', 3, 'block', 'seed'),
  ('cumming', 'profanity', 3, 'block', 'seed'),
  ('cumshot', 'profanity', 3, 'block', 'seed'),
  ('cumshots', 'profanity', 3, 'block', 'seed'),
  ('cum shot', 'profanity', 3, 'block', 'seed'),
  ('cum shots', 'profanity', 3, 'block', 'seed'),
  ('cunnilingus', 'profanity', 3, 'block', 'seed'),
  ('cunt', 'profanity', 4, 'block', 'seed'),
  ('kunt', 'profanity', 4, 'block', 'seed'),
  ('cunts', 'profanity', 4, 'block', 'seed'),
  ('kunts', 'profanity', 4, 'block', 'seed'),
  ('cuntboy', 'profanity', 3, 'block', 'seed'),
  ('cunt-boy', 'profanity', 3, 'block', 'seed'),
  ('cunt boy', 'profanity', 3, 'block', 'seed'),
  ('curry muncher', 'profanity', 3, 'block', 'seed'),
  ('curry-muncher', 'profanity', 3, 'block', 'seed'),
  ('currymuncher', 'profanity', 3, 'block', 'seed'),
  ('damn', 'profanity', 1, 'review', 'seed'),
  ('darkie', 'profanity', 3, 'block', 'seed'),
  ('darkies', 'profanity', 3, 'block', 'seed'),
  ('darky', 'profanity', 3, 'block', 'seed'),
  ('darkey', 'profanity', 3, 'block', 'seed'),
  ('date rape', 'profanity', 4, 'block', 'seed'),
  ('daterape', 'profanity', 4, 'block', 'seed'),
  ('ddlg', 'profanity', 3, 'block', 'seed'),
  ('deep throat', 'profanity', 3, 'block', 'seed'),
  ('deep-throat', 'profanity', 3, 'block', 'seed'),
  ('deepthroat', 'profanity', 3, 'block', 'seed'),
  ('dendrophilia', 'profanity', 3, 'block', 'seed'),
  ('dendrophile', 'profanity', 3, 'block', 'seed'),
  ('dick', 'profanity', 2, 'review', 'seed'),
  ('dickgirl', 'profanity', 3, 'block', 'seed'),
  ('dick-girl', 'profanity', 3, 'block', 'seed'),
  ('dick girl', 'profanity', 3, 'block', 'seed'),
  ('dildo', 'profanity', 3, 'block', 'seed'),
  ('dildos', 'profanity', 3, 'block', 'seed'),
  ('dingleberry', 'profanity', 1, 'review', 'seed'),
  ('dingleberries', 'profanity', 1, 'review', 'seed'),
  ('dipsea', 'profanity', 3, 'block', 'seed'),
  ('dirty pillows', 'profanity', 3, 'block', 'seed'),
  ('dirty sanchez', 'profanity', 3, 'block', 'seed'),
  ('dishabiliophilia', 'profanity', 3, 'block', 'seed'),
  ('dishabiliophile', 'profanity', 3, 'block', 'seed'),
  ('doggie style', 'profanity', 3, 'block', 'seed'),
  ('doggie-style', 'profanity', 3, 'block', 'seed'),
  ('doggiestyle', 'profanity', 3, 'block', 'seed'),
  ('doggy style', 'profanity', 3, 'block', 'seed'),
  ('doggy-style', 'profanity', 3, 'block', 'seed'),
  ('doggystyle', 'profanity', 3, 'block', 'seed'),
  ('dog style', 'profanity', 3, 'block', 'seed'),
  ('dogshit', 'profanity', 2, 'review', 'seed'),
  ('dog-shit', 'profanity', 2, 'review', 'seed'),
  ('dog shit', 'profanity', 2, 'review', 'seed'),
  ('dolcett', 'profanity', 3, 'block', 'seed'),
  ('domination', 'profanity', 3, 'block', 'seed'),
  ('dominatrix', 'profanity', 3, 'block', 'seed'),
  ('domme', 'profanity', 3, 'block', 'seed'),
  ('dommes', 'profanity', 3, 'block', 'seed'),
  ('donkey punch', 'profanity', 3, 'block', 'seed'),
  ('donut muncher', 'profanity', 3, 'block', 'seed'),
  ('donut puncher', 'profanity', 3, 'block', 'seed'),
  ('double penetration', 'profanity', 3, 'block', 'seed'),
  ('dp action', 'profanity', 3, 'block', 'seed'),
  ('dry hump', 'profanity', 3, 'block', 'seed'),
  ('dune coon', 'profanity', 3, 'block', 'seed'),
  ('dune-coon', 'profanity', 3, 'block', 'seed'),
  ('doon coon', 'profanity', 3, 'block', 'seed'),
  ('dooncoon', 'profanity', 3, 'block', 'seed'),
  ('dutch rudder', 'profanity', 3, 'block', 'seed'),
  ('dyke', 'profanity', 3, 'block', 'seed'),
  ('dystychiphilia', 'profanity', 3, 'block', 'seed'),
  ('dystychiphile', 'profanity', 3, 'block', 'seed'),
  ('edgeplay', 'profanity', 3, 'block', 'seed'),
  ('edge play', 'profanity', 3, 'block', 'seed'),
  ('ejaculate', 'profanity', 3, 'block', 'seed'),
  ('ejaculation', 'profanity', 3, 'block', 'seed'),
  ('ejaculating', 'profanity', 3, 'block', 'seed'),
  ('ejaculated', 'profanity', 3, 'block', 'seed'),
  ('electro-play', 'profanity', 3, 'block', 'seed'),
  ('electroplay', 'profanity', 3, 'block', 'seed'),
  ('emetophilia', 'profanity', 3, 'block', 'seed'),
  ('emetophile', 'profanity', 3, 'block', 'seed'),
  ('enby', 'profanity', 3, 'block', 'seed'),
  ('eskimo trebuchet', 'profanity', 3, 'block', 'seed'),
  ('eyetie', 'profanity', 2, 'review', 'seed'),
  ('eye-tie', 'profanity', 2, 'review', 'seed'),
  ('fag', 'profanity', 3, 'block', 'seed'),
  ('fag bomb', 'profanity', 3, 'block', 'seed'),
  ('fag-bomb', 'profanity', 3, 'block', 'seed'),
  ('fagbomb', 'profanity', 3, 'block', 'seed'),
  ('faggot', 'profanity', 3, 'block', 'seed'),
  ('fagot', 'profanity', 3, 'block', 'seed'),
  ('felch', 'profanity', 3, 'block', 'seed'),
  ('felching', 'profanity', 3, 'block', 'seed'),
  ('fellatio', 'profanity', 3, 'block', 'seed'),
  ('fellating', 'profanity', 3, 'block', 'seed'),
  ('female squirting', 'profanity', 3, 'block', 'seed'),
  ('figging', 'profanity', 3, 'block', 'seed'),
  ('fingerbang', 'profanity', 3, 'block', 'seed'),
  ('finger bang', 'profanity', 3, 'block', 'seed'),
  ('fingerbanging', 'profanity', 3, 'block', 'seed'),
  ('fingering', 'profanity', 3, 'block', 'seed'),
  ('fingered', 'profanity', 3, 'block', 'seed'),
  ('finocchio', 'profanity', 3, 'block', 'seed'),
  ('finochio', 'profanity', 3, 'block', 'seed'),
  ('finoccio', 'profanity', 3, 'block', 'seed'),
  ('fisting', 'profanity', 3, 'block', 'seed'),
  ('fisted', 'profanity', 3, 'block', 'seed'),
  ('footjob', 'profanity', 3, 'block', 'seed'),
  ('foot-job', 'profanity', 3, 'block', 'seed'),
  ('foot job', 'profanity', 3, 'block', 'seed'),
  ('french rudder', 'profanity', 3, 'block', 'seed'),
  ('frogeater', 'profanity', 2, 'review', 'seed'),
  ('frog-eater', 'profanity', 2, 'review', 'seed'),
  ('frog eater', 'profanity', 2, 'review', 'seed'),
  ('frolicme', 'profanity', 3, 'block', 'seed'),
  ('frolic me', 'profanity', 3, 'block', 'seed'),
  ('frotting', 'profanity', 3, 'block', 'seed'),
  ('frottage', 'profanity', 3, 'block', 'seed'),
  ('fuck', 'profanity', 4, 'block', 'seed'),
  ('fucks', 'profanity', 4, 'block', 'seed'),
  ('fucken', 'profanity', 4, 'block', 'seed'),
  ('fucker', 'profanity', 4, 'block', 'seed'),
  ('fuckers', 'profanity', 4, 'block', 'seed'),
  ('fuckin', 'profanity', 4, 'block', 'seed'),
  ('fucking', 'profanity', 4, 'block', 'seed'),
  ('fuckhead', 'profanity', 4, 'block', 'seed'),
  ('fuckheads', 'profanity', 4, 'block', 'seed'),
  ('fucktard', 'profanity', 4, 'block', 'seed'),
  ('fucktards', 'profanity', 4, 'block', 'seed'),
  ('fuckwad', 'profanity', 4, 'block', 'seed'),
  ('fuckwads', 'profanity', 4, 'block', 'seed'),
  ('fuckwit', 'profanity', 4, 'block', 'seed'),
  ('fuckwits', 'profanity', 4, 'block', 'seed'),
  ('fuckwhit', 'profanity', 4, 'block', 'seed'),
  ('fuck-wit', 'profanity', 4, 'block', 'seed'),
  ('fudge packer', 'profanity', 3, 'block', 'seed'),
  ('fudge-packer', 'profanity', 3, 'block', 'seed'),
  ('fudgepacker', 'profanity', 3, 'block', 'seed'),
  ('futanari', 'profanity', 3, 'block', 'seed'),
  ('g-spot', 'profanity', 3, 'block', 'seed'),
  ('gangbang', 'profanity', 3, 'block', 'seed'),
  ('gang bang', 'profanity', 3, 'block', 'seed'),
  ('gay sex', 'profanity', 3, 'block', 'seed'),
  ('gaysian', 'profanity', 3, 'block', 'seed'),
  ('genitals', 'profanity', 1, 'review', 'seed'),
  ('genitorture', 'profanity', 3, 'block', 'seed'),
  ('gerontophilia', 'profanity', 3, 'block', 'seed'),
  ('gerontophile', 'profanity', 3, 'block', 'seed'),
  ('gin jockey', 'profanity', 2, 'review', 'seed'),
  ('gin jocky', 'profanity', 2, 'review', 'seed'),
  ('girl on top', 'profanity', 3, 'block', 'seed'),
  ('goatse', 'profanity', 4, 'block', 'seed'),
  ('goatcx', 'profanity', 4, 'block', 'seed'),
  ('god damn', 'profanity', 2, 'review', 'seed'),
  ('god-damn', 'profanity', 2, 'review', 'seed'),
  ('goddamn', 'profanity', 2, 'review', 'seed'),
  ('god damned', 'profanity', 2, 'review', 'seed'),
  ('god-damned', 'profanity', 2, 'review', 'seed'),
  ('goddamned', 'profanity', 2, 'review', 'seed'),
  ('gokkun', 'profanity', 3, 'block', 'seed'),
  ('go-kun', 'profanity', 3, 'block', 'seed'),
  ('golden shower', 'profanity', 3, 'block', 'seed'),
  ('golden showers', 'profanity', 3, 'block', 'seed'),
  ('yellow shower', 'profanity', 3, 'block', 'seed'),
  ('yellow showers', 'profanity', 3, 'block', 'seed'),
  ('golliwog', 'profanity', 2, 'review', 'seed'),
  ('gollywog', 'profanity', 2, 'review', 'seed'),
  ('gook', 'profanity', 3, 'block', 'seed'),
  ('gooks', 'profanity', 3, 'block', 'seed'),
  ('gook-eye', 'profanity', 3, 'block', 'seed'),
  ('gooky', 'profanity', 3, 'block', 'seed'),
  ('gookie', 'profanity', 3, 'block', 'seed'),
  ('goregasm', 'profanity', 4, 'block', 'seed'),
  ('greaseball', 'profanity', 2, 'review', 'seed'),
  ('grey queen', 'profanity', 3, 'block', 'seed'),
  ('gray queen', 'profanity', 3, 'block', 'seed'),
  ('grope', 'profanity', 3, 'block', 'seed'),
  ('group sex', 'profanity', 3, 'block', 'seed'),
  ('gym bunny', 'profanity', 3, 'block', 'seed'),
  ('gymbunny', 'profanity', 3, 'block', 'seed'),
  ('haji', 'profanity', 2, 'review', 'seed'),
  ('hajji', 'profanity', 2, 'review', 'seed'),
  ('hadji', 'profanity', 2, 'review', 'seed'),
  ('hand job', 'profanity', 3, 'block', 'seed'),
  ('hand-job', 'profanity', 3, 'block', 'seed'),
  ('handjob', 'profanity', 3, 'block', 'seed'),
  ('hell', 'profanity', 1, 'review', 'seed'),
  ('hermie', 'profanity', 3, 'block', 'seed'),
  ('hickory switch', 'profanity', 3, 'block', 'seed'),
  ('hippophilia', 'profanity', 3, 'block', 'seed'),
  ('hippophile', 'profanity', 3, 'block', 'seed'),
  ('homoerotic', 'profanity', 3, 'block', 'seed'),
  ('honkey', 'profanity', 2, 'review', 'seed'),
  ('honky', 'profanity', 2, 'review', 'seed'),
  ('honkeys', 'profanity', 2, 'review', 'seed'),
  ('honkies', 'profanity', 2, 'review', 'seed'),
  ('horny', 'profanity', 3, 'block', 'seed'),
  ('horseshit', 'profanity', 2, 'review', 'seed'),
  ('horse-shit', 'profanity', 2, 'review', 'seed'),
  ('horse shit', 'profanity', 2, 'review', 'seed'),
  ('hot carl', 'profanity', 3, 'block', 'seed'),
  ('hot richard', 'profanity', 3, 'block', 'seed'),
  ('humping', 'profanity', 3, 'block', 'seed'),
  ('hymie', 'profanity', 2, 'review', 'seed'),
  ('heimie', 'profanity', 2, 'review', 'seed'),
  ('impact play', 'profanity', 3, 'block', 'seed'),
  ('impact-play', 'profanity', 3, 'block', 'seed'),
  ('incest', 'profanity', 4, 'block', 'seed'),
  ('intercourse', 'profanity', 3, 'block', 'seed'),
  ('jack off', 'profanity', 2, 'review', 'seed'),
  ('jack-off', 'profanity', 2, 'review', 'seed'),
  ('jail bait', 'profanity', 4, 'block', 'seed'),
  ('jailbait', 'profanity', 4, 'block', 'seed'),
  ('jap', 'profanity', 1, 'review', 'seed'),
  ('jelly donut', 'profanity', 3, 'block', 'seed'),
  ('jerk off', 'profanity', 2, 'review', 'seed'),
  ('jerk-off', 'profanity', 2, 'review', 'seed'),
  ('jerkmate', 'profanity', 3, 'block', 'seed'),
  ('jerk mate', 'profanity', 3, 'block', 'seed'),
  ('jesus', 'profanity', 1, 'review', 'seed'),
  ('jesus christ', 'profanity', 2, 'review', 'seed'),
  ('jigaboo', 'profanity', 3, 'block', 'seed'),
  ('jiggerboo', 'profanity', 3, 'block', 'seed'),
  ('jizz', 'profanity', 3, 'block', 'seed'),
  ('juggs', 'profanity', 3, 'block', 'seed'),
  ('jungle bunny', 'profanity', 2, 'review', 'seed'),
  ('junglebunny', 'profanity', 2, 'review', 'seed'),
  ('kennebunkport surprise', 'profanity', 3, 'block', 'seed'),
  ('kentucky klondike', 'profanity', 3, 'block', 'seed'),
  ('kentucky tractor puller', 'profanity', 3, 'block', 'seed'),
  ('kike', 'profanity', 3, 'block', 'seed'),
  ('kinbaku', 'profanity', 3, 'block', 'seed'),
  ('kitty puncher', 'profanity', 3, 'block', 'seed'),
  ('kitty-puncher', 'profanity', 3, 'block', 'seed'),
  ('kittypuncher', 'profanity', 3, 'block', 'seed'),
  ('knobbing', 'profanity', 3, 'block', 'seed'),
  ('kraut', 'profanity', 1, 'review', 'seed'),
  ('krauts', 'profanity', 1, 'review', 'seed'),
  ('kynophilia', 'profanity', 3, 'block', 'seed'),
  ('kynophile', 'profanity', 3, 'block', 'seed'),
  ('lady boy', 'profanity', 3, 'block', 'seed'),
  ('lady-boy', 'profanity', 3, 'block', 'seed'),
  ('ladyboy', 'profanity', 3, 'block', 'seed'),
  ('leather restraint', 'profanity', 3, 'block', 'seed'),
  ('leather straight jacket', 'profanity', 3, 'block', 'seed'),
  ('lemon party', 'profanity', 4, 'block', 'seed'),
  ('lemonparty', 'profanity', 4, 'block', 'seed'),
  ('leningrad steamer', 'profanity', 3, 'block', 'seed'),
  ('lesbo', 'profanity', 3, 'block', 'seed'),
  ('leso', 'profanity', 3, 'block', 'seed'),
  ('lezzie', 'profanity', 3, 'block', 'seed'),
  ('lezzies', 'profanity', 3, 'block', 'seed'),
  ('light in the fedora', 'profanity', 3, 'block', 'seed'),
  ('light in the loafers', 'profanity', 3, 'block', 'seed'),
  ('light in the pants', 'profanity', 3, 'block', 'seed'),
  ('limp wristed', 'profanity', 3, 'block', 'seed'),
  ('limp-wristed', 'profanity', 3, 'block', 'seed'),
  ('literotica', 'profanity', 3, 'block', 'seed'),
  ('lovemaking', 'profanity', 3, 'block', 'seed'),
  ('male squirting', 'profanity', 3, 'block', 'seed'),
  ('male-squirting', 'profanity', 3, 'block', 'seed'),
  ('masturbate', 'profanity', 2, 'review', 'seed'),
  ('masturb8', 'profanity', 2, 'review', 'seed'),
  ('masturbation', 'profanity', 2, 'review', 'seed'),
  ('masturbating', 'profanity', 2, 'review', 'seed'),
  ('masterbate', 'profanity', 2, 'review', 'seed'),
  ('masterb8', 'profanity', 2, 'review', 'seed'),
  ('mayonnaise monkey', 'profanity', 1, 'review', 'seed'),
  ('mayonnaise monkies', 'profanity', 1, 'review', 'seed'),
  ('mdlb', 'profanity', 3, 'block', 'seed'),
  ('meat masseuse', 'profanity', 3, 'block', 'seed'),
  ('meatspin', 'profanity', 4, 'block', 'seed'),
  ('meat spin', 'profanity', 4, 'block', 'seed'),
  ('menage a trois', 'profanity', 3, 'block', 'seed'),
  ('menage-a-trois', 'profanity', 3, 'block', 'seed'),
  ('menages a trois', 'profanity', 3, 'block', 'seed'),
  ('menages-a-trois', 'profanity', 3, 'block', 'seed'),
  ('menophilia', 'profanity', 3, 'block', 'seed'),
  ('menophile', 'profanity', 3, 'block', 'seed'),
  ('mexican pancake', 'profanity', 3, 'block', 'seed'),
  ('milwaukee blizzard', 'profanity', 3, 'block', 'seed'),
  ('missionary position', 'profanity', 3, 'block', 'seed'),
  ('mississippi birdbath', 'profanity', 3, 'block', 'seed'),
  ('mr hands', 'profanity', 4, 'block', 'seed'),
  ('mrhands', 'profanity', 4, 'block', 'seed'),
  ('muff diver', 'profanity', 3, 'block', 'seed'),
  ('muff-diver', 'profanity', 3, 'block', 'seed'),
  ('muffdiver', 'profanity', 3, 'block', 'seed'),
  ('muffdiving', 'profanity', 3, 'block', 'seed'),
  ('muff diving', 'profanity', 3, 'block', 'seed'),
  ('muscle mary', 'profanity', 3, 'block', 'seed'),
  ('mvtube', 'profanity', 3, 'block', 'seed'),
  ('nambla', 'profanity', 4, 'block', 'seed'),
  ('necrophilia', 'profanity', 3, 'block', 'seed'),
  ('necrophile', 'profanity', 3, 'block', 'seed'),
  ('negro', 'profanity', 2, 'review', 'seed'),
  ('neonazi', 'profanity', 2, 'review', 'seed'),
  ('neo-nazi', 'profanity', 2, 'review', 'seed'),
  ('neo nazi', 'profanity', 2, 'review', 'seed'),
  ('nigerian hurricane', 'profanity', 3, 'block', 'seed'),
  ('nigga', 'profanity', 3, 'block', 'seed'),
  ('niggs', 'profanity', 3, 'block', 'seed'),
  ('nignog', 'profanity', 3, 'block', 'seed'),
  ('nig nog', 'profanity', 3, 'block', 'seed'),
  ('nigger', 'profanity', 4, 'block', 'seed'),
  ('nipple clamps', 'profanity', 3, 'block', 'seed'),
  ('nipple clamp', 'profanity', 3, 'block', 'seed'),
  ('nipples', 'profanity', 1, 'review', 'seed'),
  ('nipple', 'profanity', 1, 'review', 'seed'),
  ('nude', 'profanity', 3, 'block', 'seed'),
  ('nudity', 'profanity', 3, 'block', 'seed'),
  ('nutten', 'profanity', 3, 'block', 'seed'),
  ('nymphomania', 'profanity', 3, 'block', 'seed'),
  ('nymphomaniac', 'profanity', 3, 'block', 'seed'),
  ('nympho', 'profanity', 3, 'block', 'seed'),
  ('nimphomania', 'profanity', 3, 'block', 'seed'),
  ('nimphomaniac', 'profanity', 3, 'block', 'seed'),
  ('nimpho', 'profanity', 3, 'block', 'seed'),
  ('octopussy', 'profanity', 3, 'block', 'seed'),
  ('oklahomo', 'profanity', 3, 'block', 'seed'),
  ('omorashi', 'profanity', 3, 'block', 'seed'),
  ('onlyfans', 'profanity', 3, 'block', 'seed'),
  ('only fans', 'profanity', 3, 'block', 'seed'),
  ('orgasm', 'profanity', 3, 'block', 'seed'),
  ('orgasms', 'profanity', 3, 'block', 'seed'),
  ('orgasmic', 'profanity', 3, 'block', 'seed'),
  ('paedophilia', 'profanity', 3, 'block', 'seed'),
  ('pedophilia', 'profanity', 3, 'block', 'seed'),
  ('paedophile', 'profanity', 3, 'block', 'seed'),
  ('pedophile', 'profanity', 3, 'block', 'seed'),
  ('painslut', 'profanity', 3, 'block', 'seed'),
  ('pain slut', 'profanity', 3, 'block', 'seed'),
  ('paki', 'profanity', 3, 'block', 'seed'),
  ('panamanian petting zoo', 'profanity', 3, 'block', 'seed'),
  ('pansy', 'profanity', 3, 'block', 'seed'),
  ('panties', 'profanity', 3, 'block', 'seed'),
  ('parthenophilia', 'profanity', 3, 'block', 'seed'),
  ('parthenophile', 'profanity', 3, 'block', 'seed'),
  ('pedobear', 'profanity', 4, 'block', 'seed'),
  ('paedobear', 'profanity', 4, 'block', 'seed'),
  ('pedo bear', 'profanity', 4, 'block', 'seed'),
  ('paedo bear', 'profanity', 4, 'block', 'seed'),
  ('pegging', 'profanity', 3, 'block', 'seed'),
  ('penis', 'profanity', 1, 'review', 'seed'),
  ('peterpuffer', 'profanity', 3, 'block', 'seed'),
  ('peter-puffer', 'profanity', 3, 'block', 'seed'),
  ('peter puffer', 'profanity', 3, 'block', 'seed'),
  ('petrol sniffer', 'profanity', 3, 'block', 'seed'),
  ('petrol-sniffer', 'profanity', 3, 'block', 'seed'),
  ('petrolsniffer', 'profanity', 3, 'block', 'seed'),
  ('phagophilia', 'profanity', 3, 'block', 'seed'),
  ('phagophile', 'profanity', 3, 'block', 'seed'),
  ('piece of shit', 'profanity', 2, 'review', 'seed'),
  ('pieces of shit', 'profanity', 2, 'review', 'seed'),
  ('pikey', 'profanity', 3, 'block', 'seed'),
  ('pikeys', 'profanity', 3, 'block', 'seed'),
  ('piss off', 'profanity', 2, 'review', 'seed'),
  ('piss pig', 'profanity', 4, 'block', 'seed'),
  ('pisspig', 'profanity', 4, 'block', 'seed'),
  ('pissed off', 'profanity', 2, 'review', 'seed'),
  ('pissing', 'profanity', 3, 'block', 'seed'),
  ('playboy', 'profanity', 3, 'block', 'seed'),
  ('pleasure chest', 'profanity', 3, 'block', 'seed'),
  ('pnigerophilia', 'profanity', 3, 'block', 'seed'),
  ('pnigophilia', 'profanity', 3, 'block', 'seed'),
  ('pnigerophile', 'profanity', 3, 'block', 'seed'),
  ('pnigophile', 'profanity', 3, 'block', 'seed'),
  ('poinephilia', 'profanity', 3, 'block', 'seed'),
  ('poinephile', 'profanity', 3, 'block', 'seed'),
  ('ponyboy', 'profanity', 3, 'block', 'seed'),
  ('pony-boy', 'profanity', 3, 'block', 'seed'),
  ('pony boy', 'profanity', 3, 'block', 'seed'),
  ('ponygirl', 'profanity', 3, 'block', 'seed'),
  ('pony-girl', 'profanity', 3, 'block', 'seed'),
  ('pony girl', 'profanity', 3, 'block', 'seed'),
  ('ponyplay', 'profanity', 3, 'block', 'seed'),
  ('pony-play', 'profanity', 3, 'block', 'seed'),
  ('poof', 'profanity', 3, 'block', 'seed'),
  ('poon', 'profanity', 3, 'block', 'seed'),
  ('poontang', 'profanity', 3, 'block', 'seed'),
  ('poop chute', 'profanity', 3, 'block', 'seed'),
  ('poopchute', 'profanity', 3, 'block', 'seed'),
  ('pornhub', 'profanity', 3, 'block', 'seed'),
  ('porn hub', 'profanity', 3, 'block', 'seed'),
  ('pornography', 'profanity', 2, 'review', 'seed'),
  ('pornographic', 'profanity', 2, 'review', 'seed'),
  ('porno', 'profanity', 2, 'review', 'seed'),
  ('pornos', 'profanity', 2, 'review', 'seed'),
  ('porn', 'profanity', 2, 'review', 'seed'),
  ('potato queen', 'profanity', 3, 'block', 'seed'),
  ('prince albert piercing', 'profanity', 3, 'block', 'seed'),
  ('proctophilia', 'profanity', 3, 'block', 'seed'),
  ('proctophile', 'profanity', 3, 'block', 'seed'),
  ('pubes', 'profanity', 1, 'review', 'seed'),
  ('punani', 'profanity', 3, 'block', 'seed'),
  ('punany', 'profanity', 3, 'block', 'seed'),
  ('pussy', 'profanity', 3, 'block', 'seed'),
  ('pussy puncher', 'profanity', 3, 'block', 'seed'),
  ('pussy-puncher', 'profanity', 3, 'block', 'seed'),
  ('pussypuncher', 'profanity', 3, 'block', 'seed'),
  ('queef', 'profanity', 3, 'block', 'seed'),
  ('queaf', 'profanity', 3, 'block', 'seed'),
  ('quim', 'profanity', 3, 'block', 'seed'),
  ('raghead', 'profanity', 3, 'block', 'seed'),
  ('rag head', 'profanity', 3, 'block', 'seed'),
  ('ragheads', 'profanity', 3, 'block', 'seed'),
  ('rag heads', 'profanity', 3, 'block', 'seed'),
  ('ramen yarmulke', 'profanity', 3, 'block', 'seed'),
  ('rape', 'profanity', 4, 'block', 'seed'),
  ('raping', 'profanity', 4, 'block', 'seed'),
  ('rapist', 'profanity', 4, 'block', 'seed'),
  ('rectum', 'profanity', 1, 'review', 'seed'),
  ('retard', 'profanity', 2, 'review', 'seed'),
  ('retarded', 'profanity', 2, 'review', 'seed'),
  ('reverse cowgirl', 'profanity', 3, 'block', 'seed'),
  ('rhabdophilia', 'profanity', 3, 'block', 'seed'),
  ('rhabdophile', 'profanity', 3, 'block', 'seed'),
  ('rhypophilia', 'profanity', 3, 'block', 'seed'),
  ('rhypophile', 'profanity', 3, 'block', 'seed'),
  ('rice queen', 'profanity', 3, 'block', 'seed'),
  ('rimjob', 'profanity', 3, 'block', 'seed'),
  ('rimming', 'profanity', 3, 'block', 'seed'),
  ('ring raider', 'profanity', 3, 'block', 'seed'),
  ('ringraider', 'profanity', 3, 'block', 'seed'),
  ('rusty trombone', 'profanity', 3, 'block', 'seed'),
  ('sand nigger', 'profanity', 4, 'block', 'seed'),
  ('sand-nigger', 'profanity', 4, 'block', 'seed'),
  ('sandnigger', 'profanity', 4, 'block', 'seed'),
  ('santorum', 'profanity', 3, 'block', 'seed'),
  ('scatophilia', 'profanity', 3, 'block', 'seed'),
  ('scatophile', 'profanity', 3, 'block', 'seed'),
  ('schlong', 'profanity', 3, 'block', 'seed'),
  ('shlong', 'profanity', 3, 'block', 'seed'),
  ('scissoring', 'profanity', 3, 'block', 'seed'),
  ('semen', 'profanity', 1, 'review', 'seed'),
  ('seplophilia', 'profanity', 3, 'block', 'seed'),
  ('seplophile', 'profanity', 3, 'block', 'seed'),
  ('sex', 'profanity', 3, 'block', 'seed'),
  ('shaved pussy', 'profanity', 3, 'block', 'seed'),
  ('shaved beaver', 'profanity', 3, 'block', 'seed'),
  ('sheepshagger', 'profanity', 2, 'review', 'seed'),
  ('sheep shagger', 'profanity', 2, 'review', 'seed'),
  ('shemale', 'profanity', 3, 'block', 'seed'),
  ('she-male', 'profanity', 3, 'block', 'seed'),
  ('she male', 'profanity', 3, 'block', 'seed'),
  ('shibari', 'profanity', 3, 'block', 'seed'),
  ('shit', 'profanity', 2, 'review', 'seed'),
  ('shithead', 'profanity', 3, 'block', 'seed'),
  ('shit head', 'profanity', 3, 'block', 'seed'),
  ('shitty', 'profanity', 2, 'review', 'seed'),
  ('shota', 'profanity', 4, 'block', 'seed'),
  ('shrimping', 'profanity', 3, 'block', 'seed'),
  ('sissy', 'profanity', 3, 'block', 'seed'),
  ('skeet', 'profanity', 3, 'block', 'seed'),
  ('skittles harvest', 'profanity', 3, 'block', 'seed'),
  ('skittle harvest', 'profanity', 3, 'block', 'seed'),
  ('slanteye', 'profanity', 3, 'block', 'seed'),
  ('slant-eye', 'profanity', 3, 'block', 'seed'),
  ('slant eye', 'profanity', 3, 'block', 'seed'),
  ('snatch', 'profanity', 1, 'review', 'seed'),
  ('snowballing', 'profanity', 3, 'block', 'seed'),
  ('sod off', 'profanity', 1, 'review', 'seed'),
  ('sodding', 'profanity', 1, 'review', 'seed'),
  ('sodomize', 'profanity', 3, 'block', 'seed'),
  ('sodomise', 'profanity', 3, 'block', 'seed'),
  ('sodomist', 'profanity', 3, 'block', 'seed'),
  ('sodomy', 'profanity', 3, 'block', 'seed'),
  ('spastic', 'profanity', 2, 'review', 'seed'),
  ('spearchucker', 'profanity', 3, 'block', 'seed'),
  ('spic', 'profanity', 3, 'block', 'seed'),
  ('spics', 'profanity', 3, 'block', 'seed'),
  ('spick', 'profanity', 3, 'block', 'seed'),
  ('spicks', 'profanity', 3, 'block', 'seed'),
  ('spicy gringo', 'profanity', 3, 'block', 'seed'),
  ('splooge', 'profanity', 3, 'block', 'seed'),
  ('splooge moose', 'profanity', 3, 'block', 'seed'),
  ('spooge', 'profanity', 3, 'block', 'seed'),
  ('spunk', 'profanity', 3, 'block', 'seed'),
  ('strap on', 'profanity', 3, 'block', 'seed'),
  ('strap-on', 'profanity', 3, 'block', 'seed'),
  ('strapon', 'profanity', 3, 'block', 'seed'),
  ('strappado', 'profanity', 4, 'block', 'seed'),
  ('swamp guinea', 'profanity', 3, 'block', 'seed'),
  ('swamp-guinea', 'profanity', 3, 'block', 'seed'),
  ('swastika', 'profanity', 2, 'review', 'seed'),
  ('svastika', 'profanity', 2, 'review', 'seed'),
  ('suastika', 'profanity', 2, 'review', 'seed'),
  ('switch hitter', 'profanity', 3, 'block', 'seed'),
  ('t-girl', 'profanity', 3, 'block', 'seed'),
  ('tgirl', 'profanity', 3, 'block', 'seed'),
  ('taphephilia', 'profanity', 3, 'block', 'seed'),
  ('taphephile', 'profanity', 3, 'block', 'seed'),
  ('tea bagging', 'profanity', 3, 'block', 'seed'),
  ('tea-bagging', 'profanity', 3, 'block', 'seed'),
  ('tea bagged', 'profanity', 3, 'block', 'seed'),
  ('tea-bagged', 'profanity', 3, 'block', 'seed'),
  ('thanatophilia', 'profanity', 3, 'block', 'seed'),
  ('thanatophile', 'profanity', 3, 'block', 'seed'),
  ('threesome', 'profanity', 3, 'block', 'seed'),
  ('throating', 'profanity', 3, 'block', 'seed'),
  ('thumbzilla', 'profanity', 3, 'block', 'seed'),
  ('timber nigger', 'profanity', 4, 'block', 'seed'),
  ('timber-nigger', 'profanity', 4, 'block', 'seed'),
  ('timbernigger', 'profanity', 4, 'block', 'seed'),
  ('tits', 'profanity', 2, 'review', 'seed'),
  ('titty', 'profanity', 2, 'review', 'seed'),
  ('titties', 'profanity', 2, 'review', 'seed'),
  ('topless', 'profanity', 3, 'block', 'seed'),
  ('tosser', 'profanity', 2, 'review', 'seed'),
  ('towelhead', 'profanity', 3, 'block', 'seed'),
  ('towel-head', 'profanity', 3, 'block', 'seed'),
  ('towel head', 'profanity', 3, 'block', 'seed'),
  ('tranny', 'profanity', 3, 'block', 'seed'),
  ('trannie', 'profanity', 3, 'block', 'seed'),
  ('transbian', 'profanity', 3, 'block', 'seed'),
  ('traumatophilia', 'profanity', 3, 'block', 'seed'),
  ('traumatophile', 'profanity', 3, 'block', 'seed'),
  ('tribbing', 'profanity', 3, 'block', 'seed'),
  ('tribadism', 'profanity', 3, 'block', 'seed'),
  ('tubgirl', 'profanity', 4, 'block', 'seed'),
  ('tub girl', 'profanity', 4, 'block', 'seed'),
  ('twat', 'profanity', 3, 'block', 'seed'),
  ('twink', 'profanity', 3, 'block', 'seed'),
  ('urethra play', 'profanity', 3, 'block', 'seed'),
  ('urophilia', 'profanity', 3, 'block', 'seed'),
  ('urophile', 'profanity', 3, 'block', 'seed'),
  ('vagina', 'profanity', 1, 'review', 'seed'),
  ('venus mound', 'profanity', 1, 'review', 'seed'),
  ('mound of venus', 'profanity', 1, 'review', 'seed'),
  ('viagra', 'profanity', 3, 'block', 'seed'),
  ('vibrator', 'profanity', 3, 'block', 'seed'),
  ('violet wand', 'profanity', 3, 'block', 'seed'),
  ('vorarephilia', 'profanity', 3, 'block', 'seed'),
  ('vorarephile', 'profanity', 3, 'block', 'seed'),
  ('voyeurweb', 'profanity', 3, 'block', 'seed'),
  ('wagon burner', 'profanity', 2, 'review', 'seed'),
  ('wagon-burner', 'profanity', 2, 'review', 'seed'),
  ('wank', 'profanity', 2, 'review', 'seed'),
  ('wanker', 'profanity', 2, 'review', 'seed'),
  ('wax play', 'profanity', 3, 'block', 'seed'),
  ('wax-play', 'profanity', 3, 'block', 'seed'),
  ('wet dream', 'profanity', 3, 'block', 'seed'),
  ('wetback', 'profanity', 3, 'block', 'seed'),
  ('wet-back', 'profanity', 3, 'block', 'seed'),
  ('wet back', 'profanity', 3, 'block', 'seed'),
  ('whitepower', 'profanity', 3, 'block', 'seed'),
  ('white-power', 'profanity', 3, 'block', 'seed'),
  ('white power', 'profanity', 3, 'block', 'seed'),
  ('whore', 'profanity', 3, 'block', 'seed'),
  ('wigger', 'profanity', 2, 'review', 'seed'),
  ('whigger', 'profanity', 2, 'review', 'seed'),
  ('wigga', 'profanity', 2, 'review', 'seed'),
  ('wiitwd', 'profanity', 3, 'block', 'seed'),
  ('wog', 'profanity', 1, 'review', 'seed'),
  ('wogs', 'profanity', 1, 'review', 'seed'),
  ('wolfbagging', 'profanity', 3, 'block', 'seed'),
  ('worldsex', 'profanity', 3, 'block', 'seed'),
  ('wrapping men', 'profanity', 3, 'block', 'seed'),
  ('wrinkled starfish', 'profanity', 3, 'block', 'seed'),
  ('xhamster', 'profanity', 3, 'block', 'seed'),
  ('xnxx', 'profanity', 3, 'block', 'seed'),
  ('xtube', 'profanity', 3, 'block', 'seed'),
  ('xvideos', 'profanity', 3, 'block', 'seed'),
  ('xxx', 'profanity', 2, 'review', 'seed'),
  ('xyrophilia', 'profanity', 3, 'block', 'seed'),
  ('xyrophile', 'profanity', 3, 'block', 'seed'),
  ('zipperhead', 'profanity', 3, 'block', 'seed'),
  ('zipper-head', 'profanity', 3, 'block', 'seed'),
  ('zipper head', 'profanity', 3, 'block', 'seed'),
  ('zippocat', 'profanity', 4, 'block', 'seed'),
  ('zippo-cat', 'profanity', 4, 'block', 'seed'),
  ('zippo cat', 'profanity', 4, 'block', 'seed'),
  ('zoophilia', 'profanity', 3, 'block', 'seed'),
  ('zoophile', 'profanity', 3, 'block', 'seed'),
  ('400', 'reserved', 0, 'reserved', 'seed'),
  ('401', 'reserved', 0, 'reserved', 'seed'),
  ('403', 'reserved', 0, 'reserved', 'seed'),
  ('404', 'reserved', 0, 'reserved', 'seed'),
  ('405', 'reserved', 0, 'reserved', 'seed'),
  ('406', 'reserved', 0, 'reserved', 'seed'),
  ('407', 'reserved', 0, 'reserved', 'seed'),
  ('408', 'reserved', 0, 'reserved', 'seed'),
  ('409', 'reserved', 0, 'reserved', 'seed'),
  ('410', 'reserved', 0, 'reserved', 'seed'),
  ('411', 'reserved', 0, 'reserved', 'seed'),
  ('412', 'reserved', 0, 'reserved', 'seed'),
  ('413', 'reserved', 0, 'reserved', 'seed'),
  ('414', 'reserved', 0, 'reserved', 'seed'),
  ('415', 'reserved', 0, 'reserved', 'seed'),
  ('416', 'reserved', 0, 'reserved', 'seed'),
  ('417', 'reserved', 0, 'reserved', 'seed'),
  ('421', 'reserved', 0, 'reserved', 'seed'),
  ('422', 'reserved', 0, 'reserved', 'seed'),
  ('423', 'reserved', 0, 'reserved', 'seed'),
  ('424', 'reserved', 0, 'reserved', 'seed'),
  ('426', 'reserved', 0, 'reserved', 'seed'),
  ('428', 'reserved', 0, 'reserved', 'seed'),
  ('429', 'reserved', 0, 'reserved', 'seed'),
  ('431', 'reserved', 0, 'reserved', 'seed'),
  ('500', 'reserved', 0, 'reserved', 'seed'),
  ('501', 'reserved', 0, 'reserved', 'seed'),
  ('502', 'reserved', 0, 'reserved', 'seed'),
  ('503', 'reserved', 0, 'reserved', 'seed'),
  ('504', 'reserved', 0, 'reserved', 'seed'),
  ('505', 'reserved', 0, 'reserved', 'seed'),
  ('506', 'reserved', 0, 'reserved', 'seed'),
  ('507', 'reserved', 0, 'reserved', 'seed'),
  ('508', 'reserved', 0, 'reserved', 'seed'),
  ('509', 'reserved', 0, 'reserved', 'seed'),
  ('510', 'reserved', 0, 'reserved', 'seed'),
  ('511', 'reserved', 0, 'reserved', 'seed'),
  ('about', 'reserved', 0, 'reserved', 'seed'),
  ('aboutus', 'reserved', 0, 'reserved', 'seed'),
  ('abuse', 'reserved', 0, 'reserved', 'seed'),
  ('access', 'reserved', 0, 'reserved', 'seed'),
  ('account', 'reserved', 0, 'reserved', 'seed'),
  ('accounts', 'reserved', 0, 'reserved', 'seed'),
  ('activate', 'reserved', 0, 'reserved', 'seed'),
  ('activities', 'reserved', 0, 'reserved', 'seed'),
  ('activity', 'reserved', 0, 'reserved', 'seed'),
  ('ad', 'reserved', 0, 'reserved', 'seed'),
  ('add', 'reserved', 0, 'reserved', 'seed'),
  ('address', 'reserved', 0, 'reserved', 'seed'),
  ('adm', 'reserved', 0, 'reserved', 'seed'),
  ('admin', 'reserved', 0, 'reserved', 'seed'),
  ('administration', 'reserved', 0, 'reserved', 'seed'),
  ('administrator', 'reserved', 0, 'reserved', 'seed'),
  ('ads', 'reserved', 0, 'reserved', 'seed'),
  ('adstxt', 'reserved', 0, 'reserved', 'seed'),
  ('adult', 'reserved', 0, 'reserved', 'seed'),
  ('advertise', 'reserved', 0, 'reserved', 'seed'),
  ('advertising', 'reserved', 0, 'reserved', 'seed'),
  ('aes128ctr', 'reserved', 0, 'reserved', 'seed'),
  ('aes128gcm', 'reserved', 0, 'reserved', 'seed'),
  ('aes192ctr', 'reserved', 0, 'reserved', 'seed'),
  ('aes256ctr', 'reserved', 0, 'reserved', 'seed'),
  ('aes256gcm', 'reserved', 0, 'reserved', 'seed'),
  ('affiliate', 'reserved', 0, 'reserved', 'seed'),
  ('affiliates', 'reserved', 0, 'reserved', 'seed'),
  ('ajax', 'reserved', 0, 'reserved', 'seed'),
  ('alert', 'reserved', 0, 'reserved', 'seed'),
  ('alerts', 'reserved', 0, 'reserved', 'seed'),
  ('all', 'reserved', 0, 'reserved', 'seed'),
  ('alpha', 'reserved', 0, 'reserved', 'seed'),
  ('amp', 'reserved', 0, 'reserved', 'seed'),
  ('analysis', 'reserved', 0, 'reserved', 'seed'),
  ('analytics', 'reserved', 0, 'reserved', 'seed'),
  ('android', 'reserved', 0, 'reserved', 'seed'),
  ('anon', 'reserved', 0, 'reserved', 'seed'),
  ('anonymous', 'reserved', 0, 'reserved', 'seed'),
  ('api', 'reserved', 0, 'reserved', 'seed'),
  ('app', 'reserved', 0, 'reserved', 'seed'),
  ('appadstxt', 'reserved', 0, 'reserved', 'seed'),
  ('apps', 'reserved', 0, 'reserved', 'seed'),
  ('archive', 'reserved', 0, 'reserved', 'seed'),
  ('archives', 'reserved', 0, 'reserved', 'seed'),
  ('article', 'reserved', 0, 'reserved', 'seed'),
  ('asc', 'reserved', 0, 'reserved', 'seed'),
  ('asct', 'reserved', 0, 'reserved', 'seed'),
  ('asset', 'reserved', 0, 'reserved', 'seed'),
  ('assets', 'reserved', 0, 'reserved', 'seed'),
  ('atom', 'reserved', 0, 'reserved', 'seed'),
  ('auth', 'reserved', 0, 'reserved', 'seed'),
  ('authentication', 'reserved', 0, 'reserved', 'seed'),
  ('authorize', 'reserved', 0, 'reserved', 'seed'),
  ('autoconfig', 'reserved', 0, 'reserved', 'seed'),
  ('autodiscover', 'reserved', 0, 'reserved', 'seed'),
  ('avatar', 'reserved', 0, 'reserved', 'seed'),
  ('backup', 'reserved', 0, 'reserved', 'seed'),
  ('balancermanager', 'reserved', 0, 'reserved', 'seed'),
  ('banner', 'reserved', 0, 'reserved', 'seed'),
  ('banners', 'reserved', 0, 'reserved', 'seed'),
  ('bbs', 'reserved', 0, 'reserved', 'seed'),
  ('beta', 'reserved', 0, 'reserved', 'seed'),
  ('billing', 'reserved', 0, 'reserved', 'seed'),
  ('billings', 'reserved', 0, 'reserved', 'seed'),
  ('bin', 'reserved', 0, 'reserved', 'seed'),
  ('blog', 'reserved', 0, 'reserved', 'seed'),
  ('blogs', 'reserved', 0, 'reserved', 'seed'),
  ('board', 'reserved', 0, 'reserved', 'seed'),
  ('book', 'reserved', 0, 'reserved', 'seed'),
  ('booking', 'reserved', 0, 'reserved', 'seed'),
  ('bookmark', 'reserved', 0, 'reserved', 'seed'),
  ('bookmarks', 'reserved', 0, 'reserved', 'seed'),
  ('bot', 'reserved', 0, 'reserved', 'seed'),
  ('bots', 'reserved', 0, 'reserved', 'seed'),
  ('broadcasthost', 'reserved', 0, 'reserved', 'seed'),
  ('bug', 'reserved', 0, 'reserved', 'seed'),
  ('business', 'reserved', 0, 'reserved', 'seed'),
  ('buy', 'reserved', 0, 'reserved', 'seed'),
  ('cache', 'reserved', 0, 'reserved', 'seed'),
  ('cadastro', 'reserved', 0, 'reserved', 'seed'),
  ('calendar', 'reserved', 0, 'reserved', 'seed'),
  ('call', 'reserved', 0, 'reserved', 'seed'),
  ('campaign', 'reserved', 0, 'reserved', 'seed'),
  ('cancel', 'reserved', 0, 'reserved', 'seed'),
  ('captcha', 'reserved', 0, 'reserved', 'seed'),
  ('career', 'reserved', 0, 'reserved', 'seed'),
  ('careers', 'reserved', 0, 'reserved', 'seed'),
  ('cart', 'reserved', 0, 'reserved', 'seed'),
  ('cas', 'reserved', 0, 'reserved', 'seed'),
  ('categories', 'reserved', 0, 'reserved', 'seed'),
  ('category', 'reserved', 0, 'reserved', 'seed'),
  ('cdn', 'reserved', 0, 'reserved', 'seed'),
  ('cgi', 'reserved', 0, 'reserved', 'seed'),
  ('cgibin', 'reserved', 0, 'reserved', 'seed'),
  ('chacha20poly1305', 'reserved', 0, 'reserved', 'seed'),
  ('change', 'reserved', 0, 'reserved', 'seed'),
  ('changelog', 'reserved', 0, 'reserved', 'seed'),
  ('channel', 'reserved', 0, 'reserved', 'seed'),
  ('channels', 'reserved', 0, 'reserved', 'seed'),
  ('chart', 'reserved', 0, 'reserved', 'seed'),
  ('chat', 'reserved', 0, 'reserved', 'seed'),
  ('check', 'reserved', 0, 'reserved', 'seed'),
  ('checking', 'reserved', 0, 'reserved', 'seed'),
  ('checkout', 'reserved', 0, 'reserved', 'seed'),
  ('clear', 'reserved', 0, 'reserved', 'seed'),
  ('client', 'reserved', 0, 'reserved', 'seed'),
  ('cliente', 'reserved', 0, 'reserved', 'seed'),
  ('clients', 'reserved', 0, 'reserved', 'seed'),
  ('close', 'reserved', 0, 'reserved', 'seed'),
  ('cloud', 'reserved', 0, 'reserved', 'seed'),
  ('cms', 'reserved', 0, 'reserved', 'seed'),
  ('code', 'reserved', 0, 'reserved', 'seed'),
  ('codereview', 'reserved', 0, 'reserved', 'seed'),
  ('com', 'reserved', 0, 'reserved', 'seed'),
  ('comercial', 'reserved', 0, 'reserved', 'seed'),
  ('comment', 'reserved', 0, 'reserved', 'seed'),
  ('comments', 'reserved', 0, 'reserved', 'seed'),
  ('communities', 'reserved', 0, 'reserved', 'seed'),
  ('community', 'reserved', 0, 'reserved', 'seed'),
  ('company', 'reserved', 0, 'reserved', 'seed'),
  ('compare', 'reserved', 0, 'reserved', 'seed'),
  ('compose', 'reserved', 0, 'reserved', 'seed'),
  ('compras', 'reserved', 0, 'reserved', 'seed'),
  ('config', 'reserved', 0, 'reserved', 'seed'),
  ('configuration', 'reserved', 0, 'reserved', 'seed'),
  ('connect', 'reserved', 0, 'reserved', 'seed'),
  ('contact', 'reserved', 0, 'reserved', 'seed'),
  ('contactus', 'reserved', 0, 'reserved', 'seed'),
  ('contest', 'reserved', 0, 'reserved', 'seed'),
  ('contribute', 'reserved', 0, 'reserved', 'seed'),
  ('cookies', 'reserved', 0, 'reserved', 'seed'),
  ('copy', 'reserved', 0, 'reserved', 'seed'),
  ('copyright', 'reserved', 0, 'reserved', 'seed'),
  ('corp', 'reserved', 0, 'reserved', 'seed'),
  ('count', 'reserved', 0, 'reserved', 'seed'),
  ('cp', 'reserved', 0, 'reserved', 'seed'),
  ('cpanel', 'reserved', 0, 'reserved', 'seed'),
  ('create', 'reserved', 0, 'reserved', 'seed'),
  ('crossdomainxml', 'reserved', 0, 'reserved', 'seed'),
  ('css', 'reserved', 0, 'reserved', 'seed'),
  ('curve25519sha256', 'reserved', 0, 'reserved', 'seed'),
  ('customer', 'reserved', 0, 'reserved', 'seed'),
  ('customers', 'reserved', 0, 'reserved', 'seed'),
  ('customize', 'reserved', 0, 'reserved', 'seed'),
  ('dashboard', 'reserved', 0, 'reserved', 'seed'),
  ('data', 'reserved', 0, 'reserved', 'seed'),
  ('db', 'reserved', 0, 'reserved', 'seed'),
  ('deals', 'reserved', 0, 'reserved', 'seed'),
  ('debug', 'reserved', 0, 'reserved', 'seed'),
  ('default', 'reserved', 0, 'reserved', 'seed'),
  ('delete', 'reserved', 0, 'reserved', 'seed'),
  ('demo', 'reserved', 0, 'reserved', 'seed'),
  ('desc', 'reserved', 0, 'reserved', 'seed'),
  ('design', 'reserved', 0, 'reserved', 'seed'),
  ('designer', 'reserved', 0, 'reserved', 'seed'),
  ('destroy', 'reserved', 0, 'reserved', 'seed'),
  ('dev', 'reserved', 0, 'reserved', 'seed'),
  ('devel', 'reserved', 0, 'reserved', 'seed'),
  ('developer', 'reserved', 0, 'reserved', 'seed'),
  ('developers', 'reserved', 0, 'reserved', 'seed'),
  ('diagram', 'reserved', 0, 'reserved', 'seed'),
  ('diary', 'reserved', 0, 'reserved', 'seed'),
  ('dict', 'reserved', 0, 'reserved', 'seed'),
  ('dictionary', 'reserved', 0, 'reserved', 'seed'),
  ('die', 'reserved', 0, 'reserved', 'seed'),
  ('diffiehellmangroup14sha1', 'reserved', 0, 'reserved', 'seed'),
  ('diffiehellmangroupexchangesha256', 'reserved', 0, 'reserved', 'seed'),
  ('dir', 'reserved', 0, 'reserved', 'seed'),
  ('directmessages', 'reserved', 0, 'reserved', 'seed'),
  ('directory', 'reserved', 0, 'reserved', 'seed'),
  ('disconnect', 'reserved', 0, 'reserved', 'seed'),
  ('discuss', 'reserved', 0, 'reserved', 'seed'),
  ('dist', 'reserved', 0, 'reserved', 'seed'),
  ('dns', 'reserved', 0, 'reserved', 'seed'),
  ('dns0', 'reserved', 0, 'reserved', 'seed'),
  ('dns1', 'reserved', 0, 'reserved', 'seed'),
  ('dns2', 'reserved', 0, 'reserved', 'seed'),
  ('dns3', 'reserved', 0, 'reserved', 'seed'),
  ('dns4', 'reserved', 0, 'reserved', 'seed'),
  ('doc', 'reserved', 0, 'reserved', 'seed'),
  ('docs', 'reserved', 0, 'reserved', 'seed'),
  ('documentation', 'reserved', 0, 'reserved', 'seed'),
  ('domain', 'reserved', 0, 'reserved', 'seed'),
  ('domainkey', 'reserved', 0, 'reserved', 'seed'),
  ('download', 'reserved', 0, 'reserved', 'seed'),
  ('downloads', 'reserved', 0, 'reserved', 'seed'),
  ('downvote', 'reserved', 0, 'reserved', 'seed'),
  ('draft', 'reserved', 0, 'reserved', 'seed'),
  ('drop', 'reserved', 0, 'reserved', 'seed'),
  ('ecdhsha2nistp256', 'reserved', 0, 'reserved', 'seed'),
  ('ecdhsha2nistp384', 'reserved', 0, 'reserved', 'seed'),
  ('ecdhsha2nistp521', 'reserved', 0, 'reserved', 'seed'),
  ('ecommerce', 'reserved', 0, 'reserved', 'seed'),
  ('edit', 'reserved', 0, 'reserved', 'seed'),
  ('editor', 'reserved', 0, 'reserved', 'seed'),
  ('edu', 'reserved', 0, 'reserved', 'seed'),
  ('education', 'reserved', 0, 'reserved', 'seed'),
  ('email', 'reserved', 0, 'reserved', 'seed'),
  ('embed', 'reserved', 0, 'reserved', 'seed'),
  ('employment', 'reserved', 0, 'reserved', 'seed'),
  ('empty', 'reserved', 0, 'reserved', 'seed'),
  ('end', 'reserved', 0, 'reserved', 'seed'),
  ('enterprise', 'reserved', 0, 'reserved', 'seed'),
  ('entries', 'reserved', 0, 'reserved', 'seed'),
  ('entry', 'reserved', 0, 'reserved', 'seed'),
  ('error', 'reserved', 0, 'reserved', 'seed'),
  ('errors', 'reserved', 0, 'reserved', 'seed'),
  ('eval', 'reserved', 0, 'reserved', 'seed'),
  ('event', 'reserved', 0, 'reserved', 'seed'),
  ('events', 'reserved', 0, 'reserved', 'seed'),
  ('everyone', 'reserved', 0, 'reserved', 'seed'),
  ('example', 'reserved', 0, 'reserved', 'seed'),
  ('exception', 'reserved', 0, 'reserved', 'seed'),
  ('exit', 'reserved', 0, 'reserved', 'seed'),
  ('explore', 'reserved', 0, 'reserved', 'seed'),
  ('export', 'reserved', 0, 'reserved', 'seed'),
  ('extensions', 'reserved', 0, 'reserved', 'seed'),
  ('facebook', 'reserved', 0, 'reserved', 'seed'),
  ('false', 'reserved', 0, 'reserved', 'seed'),
  ('family', 'reserved', 0, 'reserved', 'seed'),
  ('faq', 'reserved', 0, 'reserved', 'seed'),
  ('faqs', 'reserved', 0, 'reserved', 'seed'),
  ('faviconico', 'reserved', 0, 'reserved', 'seed'),
  ('favorite', 'reserved', 0, 'reserved', 'seed'),
  ('favorites', 'reserved', 0, 'reserved', 'seed'),
  ('feature', 'reserved', 0, 'reserved', 'seed'),
  ('features', 'reserved', 0, 'reserved', 'seed'),
  ('feed', 'reserved', 0, 'reserved', 'seed'),
  ('feedback', 'reserved', 0, 'reserved', 'seed'),
  ('feeds', 'reserved', 0, 'reserved', 'seed'),
  ('file', 'reserved', 0, 'reserved', 'seed'),
  ('files', 'reserved', 0, 'reserved', 'seed'),
  ('filter', 'reserved', 0, 'reserved', 'seed'),
  ('first', 'reserved', 0, 'reserved', 'seed'),
  ('flash', 'reserved', 0, 'reserved', 'seed'),
  ('fleet', 'reserved', 0, 'reserved', 'seed'),
  ('fleets', 'reserved', 0, 'reserved', 'seed'),
  ('flog', 'reserved', 0, 'reserved', 'seed'),
  ('follow', 'reserved', 0, 'reserved', 'seed'),
  ('follower', 'reserved', 0, 'reserved', 'seed'),
  ('followers', 'reserved', 0, 'reserved', 'seed'),
  ('following', 'reserved', 0, 'reserved', 'seed'),
  ('fonts', 'reserved', 0, 'reserved', 'seed'),
  ('forgot', 'reserved', 0, 'reserved', 'seed'),
  ('forgotpassword', 'reserved', 0, 'reserved', 'seed'),
  ('form', 'reserved', 0, 'reserved', 'seed'),
  ('forms', 'reserved', 0, 'reserved', 'seed'),
  ('forum', 'reserved', 0, 'reserved', 'seed'),
  ('forums', 'reserved', 0, 'reserved', 'seed'),
  ('founder', 'reserved', 0, 'reserved', 'seed'),
  ('free', 'reserved', 0, 'reserved', 'seed'),
  ('friend', 'reserved', 0, 'reserved', 'seed'),
  ('friends', 'reserved', 0, 'reserved', 'seed'),
  ('ftp', 'reserved', 0, 'reserved', 'seed'),
  ('gadget', 'reserved', 0, 'reserved', 'seed'),
  ('gadgets', 'reserved', 0, 'reserved', 'seed'),
  ('game', 'reserved', 0, 'reserved', 'seed'),
  ('games', 'reserved', 0, 'reserved', 'seed'),
  ('get', 'reserved', 0, 'reserved', 'seed'),
  ('ghost', 'reserved', 0, 'reserved', 'seed'),
  ('gift', 'reserved', 0, 'reserved', 'seed'),
  ('gifts', 'reserved', 0, 'reserved', 'seed'),
  ('gist', 'reserved', 0, 'reserved', 'seed'),
  ('git', 'reserved', 0, 'reserved', 'seed'),
  ('github', 'reserved', 0, 'reserved', 'seed'),
  ('go', 'reserved', 0, 'reserved', 'seed'),
  ('graph', 'reserved', 0, 'reserved', 'seed'),
  ('graphql', 'reserved', 0, 'reserved', 'seed'),
  ('group', 'reserved', 0, 'reserved', 'seed'),
  ('groups', 'reserved', 0, 'reserved', 'seed'),
  ('guest', 'reserved', 0, 'reserved', 'seed'),
  ('guests', 'reserved', 0, 'reserved', 'seed'),
  ('guidelines', 'reserved', 0, 'reserved', 'seed'),
  ('guides', 'reserved', 0, 'reserved', 'seed'),
  ('head', 'reserved', 0, 'reserved', 'seed'),
  ('header', 'reserved', 0, 'reserved', 'seed'),
  ('help', 'reserved', 0, 'reserved', 'seed'),
  ('hide', 'reserved', 0, 'reserved', 'seed'),
  ('hmacsha', 'reserved', 0, 'reserved', 'seed'),
  ('hmacsha1', 'reserved', 0, 'reserved', 'seed'),
  ('hmacsha1etm', 'reserved', 0, 'reserved', 'seed'),
  ('hmacsha2256', 'reserved', 0, 'reserved', 'seed'),
  ('hmacsha2256etm', 'reserved', 0, 'reserved', 'seed'),
  ('hmacsha2512', 'reserved', 0, 'reserved', 'seed'),
  ('hmacsha2512etm', 'reserved', 0, 'reserved', 'seed'),
  ('home', 'reserved', 0, 'reserved', 'seed'),
  ('homepage', 'reserved', 0, 'reserved', 'seed'),
  ('host', 'reserved', 0, 'reserved', 'seed'),
  ('hosting', 'reserved', 0, 'reserved', 'seed'),
  ('hostmaster', 'reserved', 0, 'reserved', 'seed'),
  ('hostname', 'reserved', 0, 'reserved', 'seed'),
  ('howto', 'reserved', 0, 'reserved', 'seed'),
  ('hpg', 'reserved', 0, 'reserved', 'seed'),
  ('htaccess', 'reserved', 0, 'reserved', 'seed'),
  ('html', 'reserved', 0, 'reserved', 'seed'),
  ('htpasswd', 'reserved', 0, 'reserved', 'seed'),
  ('http', 'reserved', 0, 'reserved', 'seed'),
  ('httpd', 'reserved', 0, 'reserved', 'seed'),
  ('https', 'reserved', 0, 'reserved', 'seed'),
  ('humanstxt', 'reserved', 0, 'reserved', 'seed'),
  ('iamges', 'reserved', 0, 'reserved', 'seed'),
  ('icon', 'reserved', 0, 'reserved', 'seed'),
  ('icons', 'reserved', 0, 'reserved', 'seed'),
  ('id', 'reserved', 0, 'reserved', 'seed'),
  ('idea', 'reserved', 0, 'reserved', 'seed'),
  ('ideas', 'reserved', 0, 'reserved', 'seed'),
  ('image', 'reserved', 0, 'reserved', 'seed'),
  ('images', 'reserved', 0, 'reserved', 'seed'),
  ('imap', 'reserved', 0, 'reserved', 'seed'),
  ('img', 'reserved', 0, 'reserved', 'seed'),
  ('import', 'reserved', 0, 'reserved', 'seed'),
  ('index', 'reserved', 0, 'reserved', 'seed'),
  ('indice', 'reserved', 0, 'reserved', 'seed'),
  ('info', 'reserved', 0, 'reserved', 'seed'),
  ('information', 'reserved', 0, 'reserved', 'seed'),
  ('inquiry', 'reserved', 0, 'reserved', 'seed'),
  ('insert', 'reserved', 0, 'reserved', 'seed'),
  ('instagram', 'reserved', 0, 'reserved', 'seed'),
  ('intranet', 'reserved', 0, 'reserved', 'seed'),
  ('investors', 'reserved', 0, 'reserved', 'seed'),
  ('invitations', 'reserved', 0, 'reserved', 'seed'),
  ('invite', 'reserved', 0, 'reserved', 'seed'),
  ('invites', 'reserved', 0, 'reserved', 'seed'),
  ('invoice', 'reserved', 0, 'reserved', 'seed'),
  ('ipad', 'reserved', 0, 'reserved', 'seed'),
  ('iphone', 'reserved', 0, 'reserved', 'seed'),
  ('irc', 'reserved', 0, 'reserved', 'seed'),
  ('is', 'reserved', 0, 'reserved', 'seed'),
  ('isatap', 'reserved', 0, 'reserved', 'seed'),
  ('issue', 'reserved', 0, 'reserved', 'seed'),
  ('issues', 'reserved', 0, 'reserved', 'seed'),
  ('it', 'reserved', 0, 'reserved', 'seed'),
  ('item', 'reserved', 0, 'reserved', 'seed'),
  ('items', 'reserved', 0, 'reserved', 'seed'),
  ('java', 'reserved', 0, 'reserved', 'seed'),
  ('javascript', 'reserved', 0, 'reserved', 'seed'),
  ('job', 'reserved', 0, 'reserved', 'seed'),
  ('jobs', 'reserved', 0, 'reserved', 'seed'),
  ('join', 'reserved', 0, 'reserved', 'seed'),
  ('js', 'reserved', 0, 'reserved', 'seed'),
  ('json', 'reserved', 0, 'reserved', 'seed'),
  ('jump', 'reserved', 0, 'reserved', 'seed'),
  ('keybasetxt', 'reserved', 0, 'reserved', 'seed'),
  ('knowledgebase', 'reserved', 0, 'reserved', 'seed'),
  ('language', 'reserved', 0, 'reserved', 'seed'),
  ('languages', 'reserved', 0, 'reserved', 'seed'),
  ('last', 'reserved', 0, 'reserved', 'seed'),
  ('ldapstatus', 'reserved', 0, 'reserved', 'seed'),
  ('learn', 'reserved', 0, 'reserved', 'seed'),
  ('legal', 'reserved', 0, 'reserved', 'seed'),
  ('license', 'reserved', 0, 'reserved', 'seed'),
  ('licensing', 'reserved', 0, 'reserved', 'seed'),
  ('like', 'reserved', 0, 'reserved', 'seed'),
  ('limit', 'reserved', 0, 'reserved', 'seed'),
  ('link', 'reserved', 0, 'reserved', 'seed'),
  ('links', 'reserved', 0, 'reserved', 'seed'),
  ('linux', 'reserved', 0, 'reserved', 'seed'),
  ('list', 'reserved', 0, 'reserved', 'seed'),
  ('lists', 'reserved', 0, 'reserved', 'seed'),
  ('live', 'reserved', 0, 'reserved', 'seed'),
  ('load', 'reserved', 0, 'reserved', 'seed'),
  ('local', 'reserved', 0, 'reserved', 'seed'),
  ('localdomain', 'reserved', 0, 'reserved', 'seed'),
  ('localhost', 'reserved', 0, 'reserved', 'seed'),
  ('lock', 'reserved', 0, 'reserved', 'seed'),
  ('log', 'reserved', 0, 'reserved', 'seed'),
  ('login', 'reserved', 0, 'reserved', 'seed'),
  ('logout', 'reserved', 0, 'reserved', 'seed'),
  ('logs', 'reserved', 0, 'reserved', 'seed'),
  ('lostpassword', 'reserved', 0, 'reserved', 'seed'),
  ('mac', 'reserved', 0, 'reserved', 'seed'),
  ('mail', 'reserved', 0, 'reserved', 'seed'),
  ('mail0', 'reserved', 0, 'reserved', 'seed'),
  ('mail1', 'reserved', 0, 'reserved', 'seed'),
  ('mail2', 'reserved', 0, 'reserved', 'seed'),
  ('mail3', 'reserved', 0, 'reserved', 'seed'),
  ('mail4', 'reserved', 0, 'reserved', 'seed'),
  ('mail5', 'reserved', 0, 'reserved', 'seed'),
  ('mail6', 'reserved', 0, 'reserved', 'seed'),
  ('mail7', 'reserved', 0, 'reserved', 'seed'),
  ('mail8', 'reserved', 0, 'reserved', 'seed'),
  ('mail9', 'reserved', 0, 'reserved', 'seed'),
  ('mailer', 'reserved', 0, 'reserved', 'seed'),
  ('mailerdaemon', 'reserved', 0, 'reserved', 'seed'),
  ('mailing', 'reserved', 0, 'reserved', 'seed'),
  ('maintenance', 'reserved', 0, 'reserved', 'seed'),
  ('manager', 'reserved', 0, 'reserved', 'seed'),
  ('manual', 'reserved', 0, 'reserved', 'seed'),
  ('map', 'reserved', 0, 'reserved', 'seed'),
  ('maps', 'reserved', 0, 'reserved', 'seed'),
  ('marketing', 'reserved', 0, 'reserved', 'seed'),
  ('marketplace', 'reserved', 0, 'reserved', 'seed'),
  ('master', 'reserved', 0, 'reserved', 'seed'),
  ('me', 'reserved', 0, 'reserved', 'seed'),
  ('media', 'reserved', 0, 'reserved', 'seed'),
  ('member', 'reserved', 0, 'reserved', 'seed'),
  ('members', 'reserved', 0, 'reserved', 'seed'),
  ('message', 'reserved', 0, 'reserved', 'seed'),
  ('messages', 'reserved', 0, 'reserved', 'seed'),
  ('messenger', 'reserved', 0, 'reserved', 'seed'),
  ('metrics', 'reserved', 0, 'reserved', 'seed'),
  ('microblog', 'reserved', 0, 'reserved', 'seed'),
  ('microblogs', 'reserved', 0, 'reserved', 'seed'),
  ('mine', 'reserved', 0, 'reserved', 'seed'),
  ('mis', 'reserved', 0, 'reserved', 'seed'),
  ('mob', 'reserved', 0, 'reserved', 'seed'),
  ('mobile', 'reserved', 0, 'reserved', 'seed'),
  ('moderator', 'reserved', 0, 'reserved', 'seed'),
  ('modify', 'reserved', 0, 'reserved', 'seed'),
  ('more', 'reserved', 0, 'reserved', 'seed'),
  ('movie', 'reserved', 0, 'reserved', 'seed'),
  ('movies', 'reserved', 0, 'reserved', 'seed'),
  ('mp3', 'reserved', 0, 'reserved', 'seed'),
  ('msg', 'reserved', 0, 'reserved', 'seed'),
  ('msn', 'reserved', 0, 'reserved', 'seed'),
  ('music', 'reserved', 0, 'reserved', 'seed'),
  ('musicas', 'reserved', 0, 'reserved', 'seed'),
  ('mx', 'reserved', 0, 'reserved', 'seed'),
  ('mx1', 'reserved', 0, 'reserved', 'seed'),
  ('my', 'reserved', 0, 'reserved', 'seed'),
  ('mysql', 'reserved', 0, 'reserved', 'seed'),
  ('name', 'reserved', 0, 'reserved', 'seed'),
  ('named', 'reserved', 0, 'reserved', 'seed'),
  ('nan', 'reserved', 0, 'reserved', 'seed'),
  ('navi', 'reserved', 0, 'reserved', 'seed'),
  ('navigation', 'reserved', 0, 'reserved', 'seed'),
  ('net', 'reserved', 0, 'reserved', 'seed'),
  ('network', 'reserved', 0, 'reserved', 'seed'),
  ('new', 'reserved', 0, 'reserved', 'seed'),
  ('news', 'reserved', 0, 'reserved', 'seed'),
  ('newsletter', 'reserved', 0, 'reserved', 'seed'),
  ('newsletters', 'reserved', 0, 'reserved', 'seed'),
  ('next', 'reserved', 0, 'reserved', 'seed'),
  ('nick', 'reserved', 0, 'reserved', 'seed'),
  ('nickname', 'reserved', 0, 'reserved', 'seed'),
  ('nil', 'reserved', 0, 'reserved', 'seed'),
  ('nobody', 'reserved', 0, 'reserved', 'seed'),
  ('noc', 'reserved', 0, 'reserved', 'seed'),
  ('none', 'reserved', 0, 'reserved', 'seed'),
  ('noreply', 'reserved', 0, 'reserved', 'seed'),
  ('notes', 'reserved', 0, 'reserved', 'seed'),
  ('noticias', 'reserved', 0, 'reserved', 'seed'),
  ('notification', 'reserved', 0, 'reserved', 'seed'),
  ('notifications', 'reserved', 0, 'reserved', 'seed'),
  ('notify', 'reserved', 0, 'reserved', 'seed'),
  ('ns', 'reserved', 0, 'reserved', 'seed'),
  ('ns0', 'reserved', 0, 'reserved', 'seed'),
  ('ns1', 'reserved', 0, 'reserved', 'seed'),
  ('ns10', 'reserved', 0, 'reserved', 'seed'),
  ('ns2', 'reserved', 0, 'reserved', 'seed'),
  ('ns3', 'reserved', 0, 'reserved', 'seed'),
  ('ns4', 'reserved', 0, 'reserved', 'seed'),
  ('ns5', 'reserved', 0, 'reserved', 'seed'),
  ('ns6', 'reserved', 0, 'reserved', 'seed'),
  ('ns7', 'reserved', 0, 'reserved', 'seed'),
  ('ns8', 'reserved', 0, 'reserved', 'seed'),
  ('ns9', 'reserved', 0, 'reserved', 'seed'),
  ('null', 'reserved', 0, 'reserved', 'seed'),
  ('oauth', 'reserved', 0, 'reserved', 'seed'),
  ('oauth2', 'reserved', 0, 'reserved', 'seed'),
  ('oauthclients', 'reserved', 0, 'reserved', 'seed'),
  ('offer', 'reserved', 0, 'reserved', 'seed'),
  ('offers', 'reserved', 0, 'reserved', 'seed'),
  ('official', 'reserved', 0, 'reserved', 'seed'),
  ('old', 'reserved', 0, 'reserved', 'seed'),
  ('onboard', 'reserved', 0, 'reserved', 'seed'),
  ('online', 'reserved', 0, 'reserved', 'seed'),
  ('openid', 'reserved', 0, 'reserved', 'seed'),
  ('operator', 'reserved', 0, 'reserved', 'seed'),
  ('order', 'reserved', 0, 'reserved', 'seed'),
  ('orders', 'reserved', 0, 'reserved', 'seed'),
  ('organization', 'reserved', 0, 'reserved', 'seed'),
  ('organizations', 'reserved', 0, 'reserved', 'seed'),
  ('overview', 'reserved', 0, 'reserved', 'seed'),
  ('owa', 'reserved', 0, 'reserved', 'seed'),
  ('owner', 'reserved', 0, 'reserved', 'seed'),
  ('owners', 'reserved', 0, 'reserved', 'seed'),
  ('page', 'reserved', 0, 'reserved', 'seed'),
  ('pager', 'reserved', 0, 'reserved', 'seed'),
  ('pages', 'reserved', 0, 'reserved', 'seed'),
  ('panel', 'reserved', 0, 'reserved', 'seed'),
  ('partners', 'reserved', 0, 'reserved', 'seed'),
  ('passwd', 'reserved', 0, 'reserved', 'seed'),
  ('password', 'reserved', 0, 'reserved', 'seed'),
  ('pay', 'reserved', 0, 'reserved', 'seed'),
  ('payment', 'reserved', 0, 'reserved', 'seed'),
  ('paymentconfirmed', 'reserved', 0, 'reserved', 'seed'),
  ('payments', 'reserved', 0, 'reserved', 'seed'),
  ('paypal', 'reserved', 0, 'reserved', 'seed'),
  ('perl', 'reserved', 0, 'reserved', 'seed'),
  ('phone', 'reserved', 0, 'reserved', 'seed'),
  ('photo', 'reserved', 0, 'reserved', 'seed'),
  ('photoalbum', 'reserved', 0, 'reserved', 'seed'),
  ('photos', 'reserved', 0, 'reserved', 'seed'),
  ('php', 'reserved', 0, 'reserved', 'seed'),
  ('phpmyadmin', 'reserved', 0, 'reserved', 'seed'),
  ('phppgadmin', 'reserved', 0, 'reserved', 'seed'),
  ('phpredisadmin', 'reserved', 0, 'reserved', 'seed'),
  ('pic', 'reserved', 0, 'reserved', 'seed'),
  ('pics', 'reserved', 0, 'reserved', 'seed'),
  ('ping', 'reserved', 0, 'reserved', 'seed'),
  ('pixel', 'reserved', 0, 'reserved', 'seed'),
  ('plan', 'reserved', 0, 'reserved', 'seed'),
  ('plans', 'reserved', 0, 'reserved', 'seed'),
  ('plugin', 'reserved', 0, 'reserved', 'seed'),
  ('plugins', 'reserved', 0, 'reserved', 'seed'),
  ('policies', 'reserved', 0, 'reserved', 'seed'),
  ('policy', 'reserved', 0, 'reserved', 'seed'),
  ('pop', 'reserved', 0, 'reserved', 'seed'),
  ('pop3', 'reserved', 0, 'reserved', 'seed'),
  ('popular', 'reserved', 0, 'reserved', 'seed'),
  ('portal', 'reserved', 0, 'reserved', 'seed'),
  ('portfolio', 'reserved', 0, 'reserved', 'seed'),
  ('post', 'reserved', 0, 'reserved', 'seed'),
  ('postfix', 'reserved', 0, 'reserved', 'seed'),
  ('postmaster', 'reserved', 0, 'reserved', 'seed'),
  ('posts', 'reserved', 0, 'reserved', 'seed'),
  ('poweruser', 'reserved', 0, 'reserved', 'seed'),
  ('pr', 'reserved', 0, 'reserved', 'seed'),
  ('preferences', 'reserved', 0, 'reserved', 'seed'),
  ('premium', 'reserved', 0, 'reserved', 'seed'),
  ('press', 'reserved', 0, 'reserved', 'seed'),
  ('previous', 'reserved', 0, 'reserved', 'seed'),
  ('price', 'reserved', 0, 'reserved', 'seed'),
  ('pricing', 'reserved', 0, 'reserved', 'seed'),
  ('print', 'reserved', 0, 'reserved', 'seed'),
  ('privacy', 'reserved', 0, 'reserved', 'seed'),
  ('privacypolicy', 'reserved', 0, 'reserved', 'seed'),
  ('private', 'reserved', 0, 'reserved', 'seed'),
  ('prod', 'reserved', 0, 'reserved', 'seed'),
  ('product', 'reserved', 0, 'reserved', 'seed'),
  ('production', 'reserved', 0, 'reserved', 'seed'),
  ('products', 'reserved', 0, 'reserved', 'seed'),
  ('profile', 'reserved', 0, 'reserved', 'seed'),
  ('profiles', 'reserved', 0, 'reserved', 'seed'),
  ('project', 'reserved', 0, 'reserved', 'seed'),
  ('projects', 'reserved', 0, 'reserved', 'seed'),
  ('promo', 'reserved', 0, 'reserved', 'seed'),
  ('pub', 'reserved', 0, 'reserved', 'seed'),
  ('public', 'reserved', 0, 'reserved', 'seed'),
  ('purchase', 'reserved', 0, 'reserved', 'seed'),
  ('purpose', 'reserved', 0, 'reserved', 'seed'),
  ('put', 'reserved', 0, 'reserved', 'seed'),
  ('python', 'reserved', 0, 'reserved', 'seed'),
  ('query', 'reserved', 0, 'reserved', 'seed'),
  ('quota', 'reserved', 0, 'reserved', 'seed'),
  ('random', 'reserved', 0, 'reserved', 'seed'),
  ('ranking', 'reserved', 0, 'reserved', 'seed'),
  ('read', 'reserved', 0, 'reserved', 'seed'),
  ('readme', 'reserved', 0, 'reserved', 'seed'),
  ('recent', 'reserved', 0, 'reserved', 'seed'),
  ('recruit', 'reserved', 0, 'reserved', 'seed'),
  ('recruitment', 'reserved', 0, 'reserved', 'seed'),
  ('redirect', 'reserved', 0, 'reserved', 'seed'),
  ('reduce', 'reserved', 0, 'reserved', 'seed'),
  ('refund', 'reserved', 0, 'reserved', 'seed'),
  ('refunds', 'reserved', 0, 'reserved', 'seed'),
  ('register', 'reserved', 0, 'reserved', 'seed'),
  ('registration', 'reserved', 0, 'reserved', 'seed'),
  ('release', 'reserved', 0, 'reserved', 'seed'),
  ('remove', 'reserved', 0, 'reserved', 'seed'),
  ('replies', 'reserved', 0, 'reserved', 'seed'),
  ('reply', 'reserved', 0, 'reserved', 'seed'),
  ('report', 'reserved', 0, 'reserved', 'seed'),
  ('reports', 'reserved', 0, 'reserved', 'seed'),
  ('repositories', 'reserved', 0, 'reserved', 'seed'),
  ('repository', 'reserved', 0, 'reserved', 'seed'),
  ('req', 'reserved', 0, 'reserved', 'seed'),
  ('request', 'reserved', 0, 'reserved', 'seed'),
  ('requestpassword', 'reserved', 0, 'reserved', 'seed'),
  ('requests', 'reserved', 0, 'reserved', 'seed'),
  ('reset', 'reserved', 0, 'reserved', 'seed'),
  ('resetpassword', 'reserved', 0, 'reserved', 'seed'),
  ('response', 'reserved', 0, 'reserved', 'seed'),
  ('return', 'reserved', 0, 'reserved', 'seed'),
  ('returns', 'reserved', 0, 'reserved', 'seed'),
  ('review', 'reserved', 0, 'reserved', 'seed'),
  ('reviews', 'reserved', 0, 'reserved', 'seed'),
  ('robotstxt', 'reserved', 0, 'reserved', 'seed'),
  ('roc', 'reserved', 0, 'reserved', 'seed'),
  ('root', 'reserved', 0, 'reserved', 'seed'),
  ('rootuser', 'reserved', 0, 'reserved', 'seed'),
  ('rsasha22', 'reserved', 0, 'reserved', 'seed'),
  ('rsasha2512', 'reserved', 0, 'reserved', 'seed'),
  ('rss', 'reserved', 0, 'reserved', 'seed'),
  ('ruby', 'reserved', 0, 'reserved', 'seed'),
  ('rule', 'reserved', 0, 'reserved', 'seed'),
  ('rules', 'reserved', 0, 'reserved', 'seed'),
  ('sag', 'reserved', 0, 'reserved', 'seed'),
  ('sale', 'reserved', 0, 'reserved', 'seed'),
  ('sales', 'reserved', 0, 'reserved', 'seed'),
  ('sample', 'reserved', 0, 'reserved', 'seed'),
  ('samples', 'reserved', 0, 'reserved', 'seed'),
  ('save', 'reserved', 0, 'reserved', 'seed'),
  ('school', 'reserved', 0, 'reserved', 'seed'),
  ('script', 'reserved', 0, 'reserved', 'seed'),
  ('scripts', 'reserved', 0, 'reserved', 'seed'),
  ('sdk', 'reserved', 0, 'reserved', 'seed'),
  ('search', 'reserved', 0, 'reserved', 'seed'),
  ('secure', 'reserved', 0, 'reserved', 'seed'),
  ('security', 'reserved', 0, 'reserved', 'seed'),
  ('select', 'reserved', 0, 'reserved', 'seed'),
  ('self', 'reserved', 0, 'reserved', 'seed'),
  ('send', 'reserved', 0, 'reserved', 'seed'),
  ('server', 'reserved', 0, 'reserved', 'seed'),
  ('serverinfo', 'reserved', 0, 'reserved', 'seed'),
  ('serverstatus', 'reserved', 0, 'reserved', 'seed'),
  ('service', 'reserved', 0, 'reserved', 'seed'),
  ('services', 'reserved', 0, 'reserved', 'seed'),
  ('session', 'reserved', 0, 'reserved', 'seed'),
  ('sessions', 'reserved', 0, 'reserved', 'seed'),
  ('setting', 'reserved', 0, 'reserved', 'seed'),
  ('settings', 'reserved', 0, 'reserved', 'seed'),
  ('setup', 'reserved', 0, 'reserved', 'seed'),
  ('share', 'reserved', 0, 'reserved', 'seed'),
  ('shift', 'reserved', 0, 'reserved', 'seed'),
  ('shop', 'reserved', 0, 'reserved', 'seed'),
  ('show', 'reserved', 0, 'reserved', 'seed'),
  ('signin', 'reserved', 0, 'reserved', 'seed'),
  ('signout', 'reserved', 0, 'reserved', 'seed'),
  ('signup', 'reserved', 0, 'reserved', 'seed'),
  ('site', 'reserved', 0, 'reserved', 'seed'),
  ('sitemap', 'reserved', 0, 'reserved', 'seed'),
  ('sites', 'reserved', 0, 'reserved', 'seed'),
  ('smartphone', 'reserved', 0, 'reserved', 'seed'),
  ('smtp', 'reserved', 0, 'reserved', 'seed'),
  ('soporte', 'reserved', 0, 'reserved', 'seed'),
  ('sort', 'reserved', 0, 'reserved', 'seed'),
  ('source', 'reserved', 0, 'reserved', 'seed'),
  ('spec', 'reserved', 0, 'reserved', 'seed'),
  ('special', 'reserved', 0, 'reserved', 'seed'),
  ('sql', 'reserved', 0, 'reserved', 'seed'),
  ('src', 'reserved', 0, 'reserved', 'seed'),
  ('ssh', 'reserved', 0, 'reserved', 'seed'),
  ('sshrsa', 'reserved', 0, 'reserved', 'seed'),
  ('ssl', 'reserved', 0, 'reserved', 'seed'),
  ('ssladmin', 'reserved', 0, 'reserved', 'seed'),
  ('ssladministrator', 'reserved', 0, 'reserved', 'seed'),
  ('sslwebmaster', 'reserved', 0, 'reserved', 'seed'),
  ('staff', 'reserved', 0, 'reserved', 'seed'),
  ('stage', 'reserved', 0, 'reserved', 'seed'),
  ('staging', 'reserved', 0, 'reserved', 'seed'),
  ('start', 'reserved', 0, 'reserved', 'seed'),
  ('stat', 'reserved', 0, 'reserved', 'seed'),
  ('state', 'reserved', 0, 'reserved', 'seed'),
  ('static', 'reserved', 0, 'reserved', 'seed'),
  ('statistics', 'reserved', 0, 'reserved', 'seed'),
  ('stats', 'reserved', 0, 'reserved', 'seed'),
  ('status', 'reserved', 0, 'reserved', 'seed'),
  ('store', 'reserved', 0, 'reserved', 'seed'),
  ('stores', 'reserved', 0, 'reserved', 'seed'),
  ('stories', 'reserved', 0, 'reserved', 'seed'),
  ('style', 'reserved', 0, 'reserved', 'seed'),
  ('styleflo', 'reserved', 0, 'reserved', 'seed'),
  ('stylefloai', 'reserved', 0, 'reserved', 'seed'),
  ('styleguide', 'reserved', 0, 'reserved', 'seed'),
  ('styles', 'reserved', 0, 'reserved', 'seed'),
  ('stylesheet', 'reserved', 0, 'reserved', 'seed'),
  ('stylesheets', 'reserved', 0, 'reserved', 'seed'),
  ('subdomain', 'reserved', 0, 'reserved', 'seed'),
  ('subscribe', 'reserved', 0, 'reserved', 'seed'),
  ('subscriptions', 'reserved', 0, 'reserved', 'seed'),
  ('sudo', 'reserved', 0, 'reserved', 'seed'),
  ('super', 'reserved', 0, 'reserved', 'seed'),
  ('superadmin', 'reserved', 0, 'reserved', 'seed'),
  ('superuser', 'reserved', 0, 'reserved', 'seed'),
  ('suporte', 'reserved', 0, 'reserved', 'seed'),
  ('support', 'reserved', 0, 'reserved', 'seed'),
  ('survey', 'reserved', 0, 'reserved', 'seed'),
  ('svn', 'reserved', 0, 'reserved', 'seed'),
  ('swf', 'reserved', 0, 'reserved', 'seed'),
  ('sync', 'reserved', 0, 'reserved', 'seed'),
  ('sys', 'reserved', 0, 'reserved', 'seed'),
  ('sysadmin', 'reserved', 0, 'reserved', 'seed'),
  ('sysadministrator', 'reserved', 0, 'reserved', 'seed'),
  ('system', 'reserved', 0, 'reserved', 'seed'),
  ('tablet', 'reserved', 0, 'reserved', 'seed'),
  ('tablets', 'reserved', 0, 'reserved', 'seed'),
  ('tag', 'reserved', 0, 'reserved', 'seed'),
  ('tags', 'reserved', 0, 'reserved', 'seed'),
  ('talk', 'reserved', 0, 'reserved', 'seed'),
  ('task', 'reserved', 0, 'reserved', 'seed'),
  ('tasks', 'reserved', 0, 'reserved', 'seed'),
  ('team', 'reserved', 0, 'reserved', 'seed'),
  ('teams', 'reserved', 0, 'reserved', 'seed'),
  ('tech', 'reserved', 0, 'reserved', 'seed'),
  ('telnet', 'reserved', 0, 'reserved', 'seed'),
  ('term', 'reserved', 0, 'reserved', 'seed'),
  ('terms', 'reserved', 0, 'reserved', 'seed'),
  ('termsofservice', 'reserved', 0, 'reserved', 'seed'),
  ('termsofuse', 'reserved', 0, 'reserved', 'seed'),
  ('test', 'reserved', 0, 'reserved', 'seed'),
  ('test1', 'reserved', 0, 'reserved', 'seed'),
  ('test2', 'reserved', 0, 'reserved', 'seed'),
  ('test3', 'reserved', 0, 'reserved', 'seed'),
  ('teste', 'reserved', 0, 'reserved', 'seed'),
  ('testimonials', 'reserved', 0, 'reserved', 'seed'),
  ('testing', 'reserved', 0, 'reserved', 'seed'),
  ('tests', 'reserved', 0, 'reserved', 'seed'),
  ('theme', 'reserved', 0, 'reserved', 'seed'),
  ('themes', 'reserved', 0, 'reserved', 'seed'),
  ('thread', 'reserved', 0, 'reserved', 'seed'),
  ('threads', 'reserved', 0, 'reserved', 'seed'),
  ('tmp', 'reserved', 0, 'reserved', 'seed'),
  ('today', 'reserved', 0, 'reserved', 'seed'),
  ('todo', 'reserved', 0, 'reserved', 'seed'),
  ('tool', 'reserved', 0, 'reserved', 'seed'),
  ('tools', 'reserved', 0, 'reserved', 'seed'),
  ('top', 'reserved', 0, 'reserved', 'seed'),
  ('topic', 'reserved', 0, 'reserved', 'seed'),
  ('topics', 'reserved', 0, 'reserved', 'seed'),
  ('tos', 'reserved', 0, 'reserved', 'seed'),
  ('tour', 'reserved', 0, 'reserved', 'seed'),
  ('training', 'reserved', 0, 'reserved', 'seed'),
  ('translate', 'reserved', 0, 'reserved', 'seed'),
  ('translations', 'reserved', 0, 'reserved', 'seed'),
  ('trending', 'reserved', 0, 'reserved', 'seed'),
  ('trends', 'reserved', 0, 'reserved', 'seed'),
  ('trial', 'reserved', 0, 'reserved', 'seed'),
  ('true', 'reserved', 0, 'reserved', 'seed'),
  ('tutorial', 'reserved', 0, 'reserved', 'seed'),
  ('tux', 'reserved', 0, 'reserved', 'seed'),
  ('tv', 'reserved', 0, 'reserved', 'seed'),
  ('twitter', 'reserved', 0, 'reserved', 'seed'),
  ('umac128', 'reserved', 0, 'reserved', 'seed'),
  ('umac128etm', 'reserved', 0, 'reserved', 'seed'),
  ('umac64', 'reserved', 0, 'reserved', 'seed'),
  ('umac64etm', 'reserved', 0, 'reserved', 'seed'),
  ('undef', 'reserved', 0, 'reserved', 'seed'),
  ('undefined', 'reserved', 0, 'reserved', 'seed'),
  ('unfollow', 'reserved', 0, 'reserved', 'seed'),
  ('unlike', 'reserved', 0, 'reserved', 'seed'),
  ('unsubscribe', 'reserved', 0, 'reserved', 'seed'),
  ('update', 'reserved', 0, 'reserved', 'seed'),
  ('upgrade', 'reserved', 0, 'reserved', 'seed'),
  ('upload', 'reserved', 0, 'reserved', 'seed'),
  ('uploads', 'reserved', 0, 'reserved', 'seed'),
  ('url', 'reserved', 0, 'reserved', 'seed'),
  ('usage', 'reserved', 0, 'reserved', 'seed'),
  ('usenet', 'reserved', 0, 'reserved', 'seed'),
  ('user', 'reserved', 0, 'reserved', 'seed'),
  ('username', 'reserved', 0, 'reserved', 'seed'),
  ('users', 'reserved', 0, 'reserved', 'seed'),
  ('usuario', 'reserved', 0, 'reserved', 'seed'),
  ('uucp', 'reserved', 0, 'reserved', 'seed'),
  ('var', 'reserved', 0, 'reserved', 'seed'),
  ('vendas', 'reserved', 0, 'reserved', 'seed'),
  ('ver', 'reserved', 0, 'reserved', 'seed'),
  ('verified', 'reserved', 0, 'reserved', 'seed'),
  ('verify', 'reserved', 0, 'reserved', 'seed'),
  ('version', 'reserved', 0, 'reserved', 'seed'),
  ('video', 'reserved', 0, 'reserved', 'seed'),
  ('videos', 'reserved', 0, 'reserved', 'seed'),
  ('view', 'reserved', 0, 'reserved', 'seed'),
  ('visitor', 'reserved', 0, 'reserved', 'seed'),
  ('void', 'reserved', 0, 'reserved', 'seed'),
  ('vote', 'reserved', 0, 'reserved', 'seed'),
  ('vpn', 'reserved', 0, 'reserved', 'seed'),
  ('watch', 'reserved', 0, 'reserved', 'seed'),
  ('weather', 'reserved', 0, 'reserved', 'seed'),
  ('web', 'reserved', 0, 'reserved', 'seed'),
  ('webhook', 'reserved', 0, 'reserved', 'seed'),
  ('webhooks', 'reserved', 0, 'reserved', 'seed'),
  ('webmail', 'reserved', 0, 'reserved', 'seed'),
  ('webmaster', 'reserved', 0, 'reserved', 'seed'),
  ('website', 'reserved', 0, 'reserved', 'seed'),
  ('websites', 'reserved', 0, 'reserved', 'seed'),
  ('welcome', 'reserved', 0, 'reserved', 'seed'),
  ('wellknown', 'reserved', 0, 'reserved', 'seed'),
  ('widget', 'reserved', 0, 'reserved', 'seed'),
  ('widgets', 'reserved', 0, 'reserved', 'seed'),
  ('wiki', 'reserved', 0, 'reserved', 'seed'),
  ('win', 'reserved', 0, 'reserved', 'seed'),
  ('windows', 'reserved', 0, 'reserved', 'seed'),
  ('word', 'reserved', 0, 'reserved', 'seed'),
  ('work', 'reserved', 0, 'reserved', 'seed'),
  ('works', 'reserved', 0, 'reserved', 'seed'),
  ('workshop', 'reserved', 0, 'reserved', 'seed'),
  ('wpad', 'reserved', 0, 'reserved', 'seed'),
  ('write', 'reserved', 0, 'reserved', 'seed'),
  ('ww', 'reserved', 0, 'reserved', 'seed'),
  ('wws', 'reserved', 0, 'reserved', 'seed'),
  ('www', 'reserved', 0, 'reserved', 'seed'),
  ('www1', 'reserved', 0, 'reserved', 'seed'),
  ('www2', 'reserved', 0, 'reserved', 'seed'),
  ('www3', 'reserved', 0, 'reserved', 'seed'),
  ('www4', 'reserved', 0, 'reserved', 'seed'),
  ('www5', 'reserved', 0, 'reserved', 'seed'),
  ('www6', 'reserved', 0, 'reserved', 'seed'),
  ('www7', 'reserved', 0, 'reserved', 'seed'),
  ('wwwdata', 'reserved', 0, 'reserved', 'seed'),
  ('wwws', 'reserved', 0, 'reserved', 'seed'),
  ('wwww', 'reserved', 0, 'reserved', 'seed'),
  ('xfn', 'reserved', 0, 'reserved', 'seed'),
  ('xml', 'reserved', 0, 'reserved', 'seed'),
  ('xmpp', 'reserved', 0, 'reserved', 'seed'),
  ('xpg', 'reserved', 0, 'reserved', 'seed'),
  ('xxx', 'reserved', 0, 'reserved', 'seed'),
  ('yaml', 'reserved', 0, 'reserved', 'seed'),
  ('year', 'reserved', 0, 'reserved', 'seed'),
  ('yml', 'reserved', 0, 'reserved', 'seed'),
  ('you', 'reserved', 0, 'reserved', 'seed'),
  ('yourdomain', 'reserved', 0, 'reserved', 'seed'),
  ('yourname', 'reserved', 0, 'reserved', 'seed'),
  ('yoursite', 'reserved', 0, 'reserved', 'seed'),
  ('yourusername', 'reserved', 0, 'reserved', 'seed'),
  ('zlib', 'reserved', 0, 'reserved', 'seed'),
  ('support', 'impersonation', 4, 'block', 'seed'),
  ('official', 'impersonation', 4, 'block', 'seed'),
  ('staff', 'impersonation', 4, 'block', 'seed'),
  ('team', 'impersonation', 4, 'block', 'seed'),
  ('admin', 'impersonation', 4, 'block', 'seed'),
  ('verified', 'impersonation', 4, 'block', 'seed'),
  ('styleflo', 'impersonation', 4, 'block', 'seed'),
  ('stylefloai', 'impersonation', 4, 'block', 'seed'),
  ('styleflo support', 'impersonation', 4, 'block', 'seed'),
  ('styleflo official', 'impersonation', 4, 'block', 'seed'),
  ('official support', 'impersonation', 4, 'block', 'seed'),
  ('styleflo staff', 'impersonation', 4, 'block', 'seed'),
  ('styleflo team', 'impersonation', 4, 'block', 'seed'),
  ('styleflo admin', 'impersonation', 4, 'block', 'seed'),
  ('styleflo verified', 'impersonation', 4, 'block', 'seed'),
  ('styleflo', 'brand_token', 4, 'block', 'seed'),
  ('stylefloai', 'brand_token', 4, 'block', 'seed')
ON CONFLICT (term, kind) DO NOTHING;
