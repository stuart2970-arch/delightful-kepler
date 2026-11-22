-- STYL-225: review wording and a 3-character slug minimum.
-- New migration only. Does not edit earlier migrations and does not touch production.
-- enforce_tenant_name_policy is left as defined in 20261122153000: an UPDATE that
-- changes neither company_name nor slug still returns before classification.
-- A slug-context name under 3 normalised characters is action block, so that
-- trigger already raises. Reserved slugs are still decided before the length check.
-- A derived sign-up slug under 3 characters becomes base_slug || '-' || counter.
-- An empty derived slug stays my-workspace. An explicit slug is unchanged.

CREATE OR REPLACE FUNCTION public.classify_moderated_name(p_value text, p_context text)
RETURNS TABLE(action text, message text, term text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_block constant text := 'Sorry, that name can''t be used. Please choose a different one.';
  v_review constant text := 'Thanks! We need to check this name. You can carry on setting up, and we''ll review it shortly.';
  v_short constant text := 'Web addresses need at least 3 characters.';
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
    IF char_length(v_slug) < 3 THEN
      RETURN QUERY SELECT 'block'::text, v_short, v_slug;
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

CREATE OR REPLACE FUNCTION public.moderation_profanity_decision(p_value text)
RETURNS TABLE(action text, message text, term text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_block constant text := 'Sorry, that name can''t be used. Please choose a different one.';
  v_review constant text := 'Thanks! We need to check this name. You can carry on setting up, and we''ll review it shortly.';
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
    IF NEW.raw_user_meta_data->>'slug' IS NULL
       AND char_length(regexp_replace(lower(base_slug), '[^a-z0-9]+', '', 'g')) < 3 THEN
      final_slug := base_slug || '-' || counter;
      counter := counter + 1;
    END IF;

    WHILE EXISTS (SELECT 1 FROM public.tenants WHERE slug = final_slug)
       OR (
         NEW.raw_user_meta_data->>'slug' IS NULL
         AND base_slug IS DISTINCT FROM 'my-workspace'
         AND char_length(regexp_replace(lower(final_slug), '[^a-z0-9]+', '', 'g')) < 3
       )
    LOOP
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
