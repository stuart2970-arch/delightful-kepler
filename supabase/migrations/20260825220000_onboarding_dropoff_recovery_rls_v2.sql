-- =========================================================================
-- WP-123 Limited (trading as StyleFlo)
-- Production Supabase Migration: Row-Level Security (RLS) & Onboarding Triggers (v2)
-- Support for: Unrepresented (No Maps), Website-less (No URL), and Mobile/Digital-Only Tenants
-- Location: Basecamp Liverpool, L1 0AH
-- Migration ID: 20260825220000_onboarding_dropoff_recovery_rls_v2
-- =========================================================================

-- Enable UUID Extension if not already active
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Ensure target schemas exist
CREATE SCHEMA IF NOT EXISTS public;

-- -------------------------------------------------------------------------
-- 1. DATABASE SCHEMA EXTENSIONS (Support Mobile/Digital/Unlisted B2B & Recovery)
-- -------------------------------------------------------------------------

-- Ensure address and postcode columns on tenants can be NULL
ALTER TABLE public.tenants ALTER COLUMN business_address DROP NOT NULL;
ALTER TABLE public.tenants ALTER COLUMN postcode DROP NOT NULL;

-- Add mobile-first context & drop-off recovery tracking columns to public.tenants if they do not exist
ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS operational_model text DEFAULT 'physical' CHECK (operational_model IN ('physical', 'mobile', 'digital')),
ADD COLUMN IF NOT EXISTS service_city text,
ADD COLUMN IF NOT EXISTS service_radius numeric DEFAULT 10,
ADD COLUMN IF NOT EXISTS has_website boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS onboarding_status text DEFAULT 'in_progress' CHECK (onboarding_status IN ('in_progress', 'completed')),
ADD COLUMN IF NOT EXISTS last_step text DEFAULT 'ACCOUNT',
ADD COLUMN IF NOT EXISTS resume_code text UNIQUE,
ADD COLUMN IF NOT EXISTS dropoff_email_sent boolean DEFAULT false;

-- -------------------------------------------------------------------------
-- 2. HELPER SECURITY DEFINER FUNCTIONS
-- -------------------------------------------------------------------------

-- Function to dynamically fetch the tenant_id of the currently authenticated user.
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t_id uuid;
BEGIN
  SELECT tenant_id INTO t_id
  FROM public.profiles
  WHERE id = auth.uid();
  RETURN t_id;
END;
$$;

-- Function to check if the current user has administrative rights (Owner/Admin) in their tenant.
CREATE OR REPLACE FUNCTION public.is_auth_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role text;
BEGIN
  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = auth.uid();
  RETURN (user_role = 'owner' OR user_role = 'admin');
END;
$$;

-- -------------------------------------------------------------------------
-- 3. SCHEMAS & RLS ENABLERS
-- -------------------------------------------------------------------------

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Handle pgvector document_chunks table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'document_chunks') THEN
    ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'documents') THEN
    ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 4. ROW-LEVEL SECURITY (RLS) POLICIES
-- -------------------------------------------------------------------------

-- Drop old policies to avoid conflict regressions
DROP POLICY IF EXISTS select_tenant ON public.tenants;
DROP POLICY IF EXISTS update_tenant ON public.tenants;
DROP POLICY IF EXISTS select_profile ON public.profiles;
DROP POLICY IF EXISTS update_profile ON public.profiles;
DROP POLICY IF EXISTS select_staff ON public.staff;
DROP POLICY IF EXISTS insert_staff ON public.staff;
DROP POLICY IF EXISTS update_staff ON public.staff;
DROP POLICY IF EXISTS delete_staff ON public.staff;
DROP POLICY IF EXISTS select_chatbot ON public.chatbots;
DROP POLICY IF EXISTS update_chatbot ON public.chatbots;
DROP POLICY IF EXISTS select_conversation ON public.conversations;
DROP POLICY IF EXISTS insert_conversation ON public.conversations;
DROP POLICY IF EXISTS select_message ON public.messages;
DROP POLICY IF EXISTS insert_message ON public.messages;

-- --- TENANTS TABLE ---
CREATE POLICY select_tenant ON public.tenants
  FOR SELECT TO authenticated
  USING (id = public.get_auth_tenant_id());

CREATE POLICY update_tenant ON public.tenants
  FOR UPDATE TO authenticated
  USING (id = public.get_auth_tenant_id() AND public.is_auth_admin())
  WITH CHECK (id = public.get_auth_tenant_id() AND public.is_auth_admin());

-- --- PROFILES TABLE ---
CREATE POLICY select_profile ON public.profiles
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY update_profile ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin()))
  WITH CHECK (id = auth.uid() OR (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin()));

-- --- STAFF TABLE ---
CREATE POLICY select_staff ON public.staff
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY insert_staff ON public.staff
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin());

CREATE POLICY update_staff ON public.staff
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin())
  WITH CHECK (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin());

CREATE POLICY delete_staff ON public.staff
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin());

-- --- CHATBOTS TABLE ---
CREATE POLICY select_chatbot ON public.chatbots
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY select_chatbot_public ON public.chatbots
  FOR SELECT TO anon
  USING (true);

CREATE POLICY update_chatbot ON public.chatbots
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin())
  WITH CHECK (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin());

-- --- CONVERSATIONS TABLE ---
CREATE POLICY select_conversation ON public.conversations
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY insert_conversation_public ON public.conversations
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- --- MESSAGES TABLE ---
CREATE POLICY select_message ON public.messages
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY insert_message_public ON public.messages
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- --- DOCUMENT CHUNKS TABLE (RAG INDEXES - STRICT TENANT ISOLATION) ---
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'document_chunks') THEN
    EXECUTE 'DROP POLICY IF EXISTS select_chunks ON public.document_chunks;';
    EXECUTE 'CREATE POLICY select_chunks ON public.document_chunks FOR SELECT TO authenticated USING (tenant_id = public.get_auth_tenant_id());';
    EXECUTE 'DROP POLICY IF EXISTS modify_chunks ON public.document_chunks;';
    EXECUTE 'CREATE POLICY modify_chunks ON public.document_chunks FOR ALL TO authenticated USING (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin());';
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'documents') THEN
    EXECUTE 'DROP POLICY IF EXISTS select_docs ON public.documents;';
    EXECUTE 'CREATE POLICY select_docs ON public.documents FOR SELECT TO authenticated USING (tenant_id = public.get_auth_tenant_id());';
    EXECUTE 'DROP POLICY IF EXISTS modify_docs ON public.documents;';
    EXECUTE 'CREATE POLICY modify_docs ON public.documents FOR ALL TO authenticated USING (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin());';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 5. DYNAMIC INVITATION & AUTOMATED ONBOARDING SIGN-UP TRIGGERS
-- -------------------------------------------------------------------------

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

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
  company_slug text;
  
  -- Metadata extraction variables
  meta_model text;
  meta_city text;
  meta_radius numeric;
  meta_has_website boolean;
  meta_resume_code text;
BEGIN
  SELECT * INTO matching_staff_record 
  FROM public.staff 
  WHERE email = NEW.email 
  LIMIT 1;

  IF matching_staff_record.id IS NOT NULL THEN
    INSERT INTO public.profiles (id, tenant_id, role, is_super_admin) 
    VALUES (NEW.id, matching_staff_record.tenant_id, 'member', false);
  ELSE
    company_name_input := COALESCE(NEW.raw_user_meta_data->>'company_name', 'My Workspace');
    meta_model := COALESCE(NEW.raw_user_meta_data->>'operational_model', 'physical');
    meta_city := NEW.raw_user_meta_data->>'service_city';
    meta_radius := COALESCE((NEW.raw_user_meta_data->>'service_radius')::numeric, 10);
    meta_has_website := COALESCE((NEW.raw_user_meta_data->>'has_website')::boolean, true);

    company_slug := lower(regexp_replace(company_name_input, '[^a-zA-Z0-9]+', '-', 'g'));
    company_slug := rtrim(company_slug, '-');

    -- Generate unique 6-character resumption code (e.g. FLO-8921)
    meta_resume_code := 'FLO-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 4));

    INSERT INTO public.tenants (
      company_name, 
      slug, 
      operational_model, 
      service_city, 
      service_radius, 
      has_website,
      onboarding_status,
      last_step,
      resume_code,
      dropoff_email_sent
    ) 
    VALUES (
      company_name_input, 
      company_slug, 
      meta_model, 
      meta_city, 
      meta_radius, 
      meta_has_website,
      'in_progress',
      'ACCOUNT',
      meta_resume_code,
      false
    ) 
    RETURNING id INTO new_tenant_id;

    INSERT INTO public.profiles (id, tenant_id, role, is_super_admin) 
    VALUES (NEW.id, new_tenant_id, 'owner', false);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================================
-- END OF MIGRATION SCRIPT
-- =========================================================================
