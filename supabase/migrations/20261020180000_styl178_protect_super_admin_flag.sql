-- ==============================================================================
-- Migration: Protect Super Admin Flag from Privilege Escalation (STYL-178)
-- Prevents authenticated users or tenant admins from modifying is_super_admin
-- ==============================================================================

-- 1. Create protection trigger function
CREATE OR REPLACE FUNCTION public.protect_super_admin_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Block unauthorized updates to is_super_admin
  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      IF auth.role() IS NULL OR auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized: only service role can modify is_super_admin flag';
      END IF;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    -- Block unauthorized creation of super admin profiles
    IF NEW.is_super_admin = true THEN
      IF auth.role() IS NULL OR auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized: only service role can create a super admin profile';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Attach trigger to public.profiles
DROP TRIGGER IF EXISTS tr_protect_super_admin_flag ON public.profiles;
CREATE TRIGGER tr_protect_super_admin_flag
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_super_admin_flag();

-- 3. Revoke direct column update permissions on is_super_admin for authenticated and anon roles
REVOKE UPDATE (is_super_admin) ON public.profiles FROM authenticated, anon;
