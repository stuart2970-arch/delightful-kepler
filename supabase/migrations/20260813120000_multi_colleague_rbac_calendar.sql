-- Migration: Add user binding and OAuth fields to staff table
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS google_access_token text,
  ADD COLUMN IF NOT EXISTS google_refresh_token text,
  ADD COLUMN IF NOT EXISTS google_token_expiry timestamptz,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- Create index for fast user_id lookups
CREATE INDEX IF NOT EXISTS idx_staff_user_id ON public.staff(user_id);

-- Enforce RLS on staff table
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------
-- ROW-LEVEL SECURITY (RLS) POLICIES FOR STAFF
-- -------------------------------------------------------------

-- Drop legacy staff policies to avoid conflicts
DROP POLICY IF EXISTS select_staff ON public.staff;
DROP POLICY IF EXISTS insert_staff ON public.staff;
DROP POLICY IF EXISTS update_staff ON public.staff;
DROP POLICY IF EXISTS delete_staff ON public.staff;

-- 1. SELECT: Any authenticated workspace user can view the staff roster
CREATE POLICY select_staff ON public.staff
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

-- 2. INSERT: Only Owners/Admins can create/invite staff members
CREATE POLICY insert_staff ON public.staff
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_auth_tenant_id() AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'owner' OR role = 'admin')
    )
  );

-- 3. UPDATE: Owners/Admins can edit any staff, while colleagues can only edit their own staff profile
CREATE POLICY update_staff ON public.staff
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_auth_tenant_id() AND (
      auth.uid() = user_id OR
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND (role = 'owner' OR role = 'admin')
      )
    )
  )
  WITH CHECK (
    tenant_id = public.get_auth_tenant_id() AND (
      auth.uid() = user_id OR
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND (role = 'owner' OR role = 'admin')
      )
    )
  );

-- 4. DELETE: Only Owners/Admins can delete/remove staff members
CREATE POLICY delete_staff ON public.staff
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_auth_tenant_id() AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'owner' OR role = 'admin')
    )
  );

-- -------------------------------------------------------------
-- DYNAMIC INVITATION TRIGGERS (handle_new_user Refactor)
-- -------------------------------------------------------------

-- Update handle_new_user to dynamically check if the email has been pre-invited as staff
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matching_staff_record RECORD;
  new_tenant_id uuid;
  company_name_input text;
BEGIN
  -- Look for pre-invited staff with a matching email
  SELECT * INTO matching_staff_record
  FROM public.staff
  WHERE email = NEW.email
  LIMIT 1;

  IF matching_staff_record.id IS NOT NULL THEN
    -- Scenario A: User was invited. Bind them to the existing tenant as a 'member'
    INSERT INTO public.profiles (id, tenant_id, role, is_super_admin)
    VALUES (NEW.id, matching_staff_record.tenant_id, 'member', false);

    -- Update the staff profile to point to their Auth UID
    UPDATE public.staff
    SET user_id = NEW.id
    WHERE id = matching_staff_record.id;
  ELSE
    -- Scenario B: Normal registration. Provision new tenant and set as 'owner'
    company_name_input := COALESCE(NEW.raw_user_meta_data->>'company_name', 'My Workspace');

    INSERT INTO public.tenants (company_name)
    VALUES (company_name_input)
    RETURNING id INTO new_tenant_id;

    INSERT INTO public.profiles (id, tenant_id, role, is_super_admin)
    VALUES (NEW.id, new_tenant_id, 'owner', false);
  END IF;

  RETURN NEW;
END;
$$;
