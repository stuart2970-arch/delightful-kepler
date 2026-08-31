-- Create a secure RPC function to check if an email exists in auth.users or staff
CREATE OR REPLACE FUNCTION public.check_email_exists(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_exists boolean := false;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN false;
  END IF;

  -- 1. Check auth.users table directly
  SELECT true INTO v_exists
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  IF v_exists THEN
    RETURN true;
  END IF;

  -- 2. Check staff table for pre-invited members
  SELECT true INTO v_exists
  FROM public.staff
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  RETURN COALESCE(v_exists, false);
END;
$$;
