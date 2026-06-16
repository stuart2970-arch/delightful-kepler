-- Enable the pgvector extension to work with embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- =========================================================================
-- 1. TENANTS TABLE
-- =========================================================================
CREATE TABLE public.tenants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    company_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenants_tenant_id_matches_id CHECK (tenant_id = id),
    CONSTRAINT tenants_tenant_id_unique UNIQUE (tenant_id)
);

-- Trigger to automatically set tenant_id = id on insert if not provided
CREATE OR REPLACE FUNCTION public.set_tenant_id()
RETURNS trigger AS $$
BEGIN
    IF NEW.id IS NULL THEN
        NEW.id := gen_random_uuid();
    END IF;
    NEW.tenant_id := NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_tenant_id
BEFORE INSERT ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.set_tenant_id();

-- =========================================================================
-- 2. PROFILES TABLE
-- =========================================================================
CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- 3. CHATBOTS TABLE
-- =========================================================================
CREATE TABLE public.chatbots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name text NOT NULL,
    configuration_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    primary_color text NOT NULL DEFAULT '#4F46E5',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chatbots_tenant_id_id_key UNIQUE (tenant_id, id)
);

-- =========================================================================
-- 4. DOCUMENT CHUNKS TABLE
-- =========================================================================
CREATE TABLE public.document_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    chatbot_id uuid NOT NULL,
    content text NOT NULL,
    embedding vector(1536),
    source_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Enforce that a document chunk's chatbot belongs to the same tenant
    CONSTRAINT document_chunks_chatbot_fkey FOREIGN KEY (tenant_id, chatbot_id) REFERENCES public.chatbots(tenant_id, id) ON DELETE CASCADE
);

-- =========================================================================
-- 5. CONVERSATIONS TABLE
-- =========================================================================
CREATE TABLE public.conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    chatbot_id uuid NOT NULL,
    user_session_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Enforce that a conversation's chatbot belongs to the same tenant
    CONSTRAINT conversations_chatbot_fkey FOREIGN KEY (tenant_id, chatbot_id) REFERENCES public.chatbots(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT conversations_tenant_id_id_key UNIQUE (tenant_id, id)
);

-- =========================================================================
-- 6. MESSAGES TABLE
-- =========================================================================
CREATE TABLE public.messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL,
    sender_type text NOT NULL CHECK (sender_type IN ('user', 'bot')),
    text_content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Enforce that a message's conversation belongs to the same tenant
    CONSTRAINT messages_conversation_fkey FOREIGN KEY (tenant_id, conversation_id) REFERENCES public.conversations(tenant_id, id) ON DELETE CASCADE
);

-- =========================================================================
-- INDEXES FOR PERFORMANCE
-- =========================================================================
-- Standard indexes on tenant_id for RLS performance
CREATE INDEX IF NOT EXISTS tenants_tenant_id_idx ON public.tenants(tenant_id);
CREATE INDEX IF NOT EXISTS profiles_tenant_id_idx ON public.profiles(tenant_id);
CREATE INDEX IF NOT EXISTS chatbots_tenant_id_idx ON public.chatbots(tenant_id);
CREATE INDEX IF NOT EXISTS document_chunks_tenant_id_idx ON public.document_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS conversations_tenant_id_idx ON public.conversations(tenant_id);
CREATE INDEX IF NOT EXISTS messages_tenant_id_idx ON public.messages(tenant_id);

-- Foreign key indexes
CREATE INDEX IF NOT EXISTS document_chunks_chatbot_idx ON public.document_chunks(chatbot_id);
CREATE INDEX IF NOT EXISTS conversations_chatbot_idx ON public.conversations(chatbot_id);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON public.messages(conversation_id);

-- Vector similarity search index (HNSW for high-performance approximate nearest neighbor)
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx 
ON public.document_chunks 
USING hnsw (embedding vector_cosine_ops);

-- =========================================================================
-- ROW LEVEL SECURITY (RLS) & POLICIES
-- =========================================================================

-- Helper function to fetch the current user's tenant ID securely
-- Define as SECURITY DEFINER to bypass RLS when querying profiles
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql;

-- Enable RLS on all tables
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 1. TENANTS Policies
CREATE POLICY select_tenants ON public.tenants
  FOR SELECT TO authenticated
  USING (id = public.get_auth_tenant_id());

CREATE POLICY insert_tenants ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK (true); -- Allow authenticated users to create a tenant initially

CREATE POLICY update_tenants ON public.tenants
  FOR UPDATE TO authenticated
  USING (id = public.get_auth_tenant_id())
  WITH CHECK (id = public.get_auth_tenant_id());

CREATE POLICY delete_tenants ON public.tenants
  FOR DELETE TO authenticated
  USING (id = public.get_auth_tenant_id());

-- 2. PROFILES Policies
CREATE POLICY select_profiles ON public.profiles
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY insert_profiles ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_auth_tenant_id() OR auth.uid() = id); -- Allow initial profile creation during sign-up

CREATE POLICY update_profiles ON public.profiles
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY delete_profiles ON public.profiles
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

-- 3. CHATBOTS Policies
CREATE POLICY select_chatbots ON public.chatbots
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY insert_chatbots ON public.chatbots
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY update_chatbots ON public.chatbots
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY delete_chatbots ON public.chatbots
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

-- 4. DOCUMENT CHUNKS Policies
CREATE POLICY select_document_chunks ON public.document_chunks
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY insert_document_chunks ON public.document_chunks
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY update_document_chunks ON public.document_chunks
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY delete_document_chunks ON public.document_chunks
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

-- 5. CONVERSATIONS Policies
CREATE POLICY select_conversations ON public.conversations
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY insert_conversations ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY update_conversations ON public.conversations
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY delete_conversations ON public.conversations
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

-- 6. MESSAGES Policies
CREATE POLICY select_messages ON public.messages
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY insert_messages ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY update_messages ON public.messages
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY delete_messages ON public.messages
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());
