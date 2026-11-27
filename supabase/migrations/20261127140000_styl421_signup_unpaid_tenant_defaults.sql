-- STYL-421: New business sign-ups stay unpaid until Foundation checkout completes.
-- Does not edit 20261024130000_styl202_addon_unique_and_helpers.sql. Local / staging only via migration workflow.

ALTER TABLE public.tenants
  ALTER COLUMN is_active SET DEFAULT false;

ALTER TABLE public.tenants
  ALTER COLUMN subscription_status SET DEFAULT 'incomplete';

COMMENT ON COLUMN public.tenants.subscription_status IS
  'Stripe-aligned lifecycle. New sign-ups default to incomplete until checkout.session.completed.';

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
       AND char_length(regexp_replace(public.moderation_normalize(base_slug), '[^a-z0-9]+', '', 'g')) < 3 THEN
      final_slug := base_slug || '-' || counter;
      counter := counter + 1;
    END IF;

    WHILE EXISTS (SELECT 1 FROM public.tenants WHERE slug = final_slug)
       OR (
         NEW.raw_user_meta_data->>'slug' IS NULL
         AND base_slug IS DISTINCT FROM 'my-workspace'
         AND char_length(regexp_replace(public.moderation_normalize(final_slug), '[^a-z0-9]+', '', 'g')) < 3
       )
    LOOP
      IF counter > 50 THEN
        final_slug := 'my-workspace-' || counter;
      ELSE
        final_slug := base_slug || '-' || counter;
      END IF;
      counter := counter + 1;
    END LOOP;

    IF NEW.raw_user_meta_data->>'slug' IS NULL
       AND char_length(regexp_replace(public.moderation_normalize(final_slug), '[^a-z0-9]+', '', 'g')) < 3 THEN
      final_slug := 'my-workspace-' || counter;
    END IF;

    INSERT INTO public.tenants (
      company_name,
      slug,
      is_active,
      subscription_status,
      plan_tier
    )
    VALUES (company_name_input, final_slug, false, 'incomplete', 'base_tier')
    RETURNING id INTO new_tenant_id;

    INSERT INTO public.profiles (id, tenant_id, role, is_super_admin)
    VALUES (NEW.id, new_tenant_id, 'owner', false);
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;