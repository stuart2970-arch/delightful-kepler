-- =========================================================================
-- DATABASE SEED SCRIPT FOR STYLEFLO
-- =========================================================================

-- 1. Helper function to generate a dummy vector of 768 dimensions
-- (Used to populate mock embeddings without giant float array text)
CREATE OR REPLACE FUNCTION public.make_dummy_vector(val float)
RETURNS vector(768) AS $$
DECLARE
    arr float[];
BEGIN
    SELECT array_agg(val + (i * 0.0001)) INTO arr FROM generate_series(1, 768) i;
    RETURN arr::vector(768);
END;
$$ LANGUAGE plpgsql;

-- 2. Seed Tenants
INSERT INTO public.tenants (id, tenant_id, company_name)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Acme Corp'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenants (id, tenant_id, company_name)
VALUES (
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002',
  'Globex Corporation'
) ON CONFLICT (id) DO NOTHING;

-- 3. Seed auth.users
-- Password is 'password123'
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  recovery_sent_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'admin@acme.com',
  crypt('password123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"Acme Admin"}',
  now(),
  now(),
  '',
  '',
  '',
  ''
), (
  '00000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000002',
  'authenticated',
  'authenticated',
  'staff@globex.com',
  crypt('password123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"Globex Staff"}',
  now(),
  now(),
  '',
  '',
  '',
  ''
) ON CONFLICT (id) DO NOTHING;

-- 4. Seed Profiles
INSERT INTO public.profiles (id, tenant_id, role)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'owner'
), (
  '20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002',
  'admin'
) ON CONFLICT (id) DO NOTHING;

-- 5. Seed Chatbots
-- Acme Support Bot (Emerald Green theme)
INSERT INTO public.chatbots (id, tenant_id, name, configuration_json, primary_color)
VALUES (
  'e0000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Acme Support Bot',
  '{"welcome_message": "Hello! I am the Acme support bot. How can I help you?", "suggested_prompts": ["What is Acme?", "How do I sign up?"]}',
  '#10B981'
) ON CONFLICT (id) DO NOTHING;

-- Globex Helpdesk (Indigo theme)
INSERT INTO public.chatbots (id, tenant_id, name, configuration_json, primary_color)
VALUES (
  'e0000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002',
  'Globex Helpdesk',
  '{"welcome_message": "Welcome to Globex Support. What can we do for you?", "suggested_prompts": ["Server Status", "Open a Ticket"]}',
  '#4F46E5'
) ON CONFLICT (id) DO NOTHING;

-- 6. Seed Document Chunks
-- Chunks for Acme support bot
INSERT INTO public.document_chunks (id, tenant_id, chatbot_id, content, embedding, source_url)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000001',
  'Acme Corp is a globally renowned supplier of premium anvils, rockets, and giant magnets. Founded in 1948, we operate in over 90 countries providing gadgets to support all of your high-speed desert chasing activities. Our headquarters is located in Coyote Canyon, Arizona.',
  public.make_dummy_vector(0.01),
  'https://acme.com/about'
), (
  'c0000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000001',
  'To sign up for an Acme account, navigate to the Acme registration page at acme.com/signup. You will need to provide an email, choose a password, and select your shipping tier. We offer Ground shipping (3-5 business days) and Rocket Express (15 seconds, delivered via ballistic missile).',
  public.make_dummy_vector(0.02),
  'https://acme.com/help/signup'
), (
  'c0000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000001',
  'Acme offers a 30-day money-back guarantee on all unused products, except for explosives and items affected by gravity. To initiate a return, contact our customer support at support@acme.com with your order number and a brief description of the coyote issue.',
  public.make_dummy_vector(0.03),
  'https://acme.com/returns'
) ON CONFLICT (id) DO NOTHING;

-- Chunks for Globex helpdesk
INSERT INTO public.document_chunks (id, tenant_id, chatbot_id, content, embedding, source_url)
VALUES (
  'c0000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000002',
  'Globex Corporation specializes in high-tech research, server infrastructure, and energy grids. Led by Hank Scorpio, Globex is committed to employee empowerment and global domination. Our core values include freedom, recreation, and thermal energy development.',
  public.make_dummy_vector(0.05),
  'https://globex.com/about'
), (
  'c0000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000002',
  'Globex server infrastructure is fully redundant, operating 12 primary data centers across North America and Europe. For status updates, check status.globex.com. If you experience latency on your node, please verify that your local sub-grid is active and running.',
  public.make_dummy_vector(0.06),
  'https://globex.com/status'
) ON CONFLICT (id) DO NOTHING;

-- 7. Seed conversations & messages logs
INSERT INTO public.conversations (id, tenant_id, chatbot_id, user_session_id)
VALUES (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000001',
  'session_test_acme'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.messages (id, tenant_id, conversation_id, sender_type, text_content, created_at)
VALUES (
  '60000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  'user',
  'What is Acme?',
  now() - interval '5 minutes'
), (
  '60000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  'bot',
  'Acme Corp is a globally renowned supplier of premium anvils, rockets, and giant magnets. How can I assist you with our product line today?',
  now() - interval '4 minutes'
) ON CONFLICT (id) DO NOTHING;

-- Clean up helper function to leave public schema clean
DROP FUNCTION IF EXISTS public.make_dummy_vector(float);
