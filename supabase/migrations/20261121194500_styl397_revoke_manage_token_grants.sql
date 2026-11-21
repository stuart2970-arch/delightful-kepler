-- STYL-397: appointment_manage_tokens is service-role API only (RLS on, no policies).
-- Supabase default privileges grant anon/authenticated DML; revoke them.

REVOKE ALL ON TABLE public.appointment_manage_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.appointment_manage_tokens FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.appointment_manage_tokens TO service_role;