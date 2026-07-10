-- Supabase Custom JWT Auth Hook for O(1) RLS Checks

-- 1. Create the hook function that injects tenant_id into the JWT
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    claims jsonb;
    user_tenant_id uuid;
    user_is_superadmin boolean;
BEGIN
    -- Extract current claims
    claims := event->'claims';
    
    -- Lookup the user's profile details
    SELECT tenant_id, is_super_admin 
    INTO user_tenant_id, user_is_superadmin
    FROM public.profiles 
    WHERE id = (event->>'user_id')::uuid;

    -- Inject into the app_metadata inside the JWT
    IF user_tenant_id IS NOT NULL THEN
        claims := jsonb_set(claims, '{app_metadata, tenant_id}', to_jsonb(user_tenant_id));
    END IF;

    IF user_is_superadmin IS NOT NULL THEN
        claims := jsonb_set(claims, '{app_metadata, is_super_admin}', to_jsonb(user_is_superadmin));
    END IF;

    -- Update the event with modified claims
    event := jsonb_set(event, '{claims}', claims);
    
    RETURN event;
END;
$$;

-- 2. Grant permissions so Supabase Auth can execute the hook
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- NOTE: To fully activate this, the user must go to the Supabase Dashboard -> Authentication -> Hooks
-- and assign `custom_access_token_hook` as the "Custom Access Token (JWT) Hook".

-- 3. Refactor Example RLS Policy
-- Below is how to migrate an existing policy to use the fast O(1) JWT claim
-- Example for messages:
-- OLD: CREATE POLICY "View own messages" ON messages USING (tenant_id = public.get_auth_tenant_id());
-- NEW: CREATE POLICY "View own messages" ON messages USING (
--          tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
--          OR (auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true
--      );

-- Drop the old helper function if all policies are updated to JWT (optional but recommended once verified)
-- DROP FUNCTION IF EXISTS public.get_auth_tenant_id();
