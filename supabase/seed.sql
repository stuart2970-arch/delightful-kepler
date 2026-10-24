-- =========================================================================
-- DATABASE SEED SCRIPT FOR STYLEFLO (STYL-202)
-- =========================================================================
-- Holds NO real customer or production data. All names, emails, and phone
-- numbers are synthetic fixtures for local/staging resets only.
-- Phone numbers use the Ofcom UK drama range 07700 900xxx (never allocated).
-- Password for all seeded auth users: password123
-- =========================================================================

-- Skip signup provisioning / superadmin protect while seeding.
-- Uses app.seed_mode GUC (STYL-202) — seed role cannot ALTER TRIGGER on auth.users.
SELECT set_config('app.seed_mode', 'on', false);

-- 1. Helper function to generate a dummy vector of 768 dimensions
CREATE OR REPLACE FUNCTION public.make_dummy_vector(val float)
RETURNS vector(768) AS $$
DECLARE
    arr float[];
BEGIN
    SELECT array_agg(val + (i * 0.0001)) INTO arr FROM generate_series(1, 768) i;
    RETURN arr::vector(768);
END;
$$ LANGUAGE plpgsql;

-- 2. Seed Tenants (plan_tier = foundation per STYL rename)
INSERT INTO public.tenants (
  id, tenant_id, company_name, slug, plan_tier, has_google_calendar,
  general_operating_hours
)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Acme Corp',
  'acme-corp',
  'foundation',
  true,
  '{
    "monday":    {"unavailable": false, "hours": {"start": "09:00", "end": "17:00"}},
    "tuesday":   {"unavailable": false, "hours": {"start": "09:00", "end": "17:00"}},
    "wednesday": {"unavailable": false, "hours": {"start": "09:00", "end": "17:00"}},
    "thursday":  {"unavailable": false, "hours": {"start": "09:00", "end": "17:00"}},
    "friday":    {"unavailable": false, "hours": {"start": "09:00", "end": "17:00"}},
    "saturday":  {"unavailable": true,  "hours": null},
    "sunday":    {"unavailable": true,  "hours": null}
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET
  has_google_calendar = true,
  plan_tier = 'foundation',
  general_operating_hours = EXCLUDED.general_operating_hours;

INSERT INTO public.tenants (id, tenant_id, company_name, slug, plan_tier)
VALUES (
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002',
  'Globex Corporation',
  'globex-corporation',
  'foundation'
) ON CONFLICT (id) DO UPDATE SET plan_tier = 'foundation';

-- 3. Seed auth.users (incl. fake superadmin)
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
), (
  '00000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000099',
  'authenticated',
  'authenticated',
  'superadmin@styleflo.test',
  crypt('password123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"StyleFlo Superadmin"}',
  now(),
  now(),
  '',
  '',
  '',
  ''
) ON CONFLICT (id) DO NOTHING;

-- 4. Seed Profiles (superadmin attached to Acme for a valid tenant_id)
INSERT INTO public.profiles (id, tenant_id, role, is_super_admin)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'owner',
  false
), (
  '20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002',
  'admin',
  false
), (
  '20000000-0000-0000-0000-000000000099',
  '10000000-0000-0000-0000-000000000001',
  'owner',
  true
) ON CONFLICT (id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  role = EXCLUDED.role,
  is_super_admin = EXCLUDED.is_super_admin;

-- 5. Seed Chatbots
INSERT INTO public.chatbots (id, tenant_id, name, configuration_json, primary_color)
VALUES (
  'e0000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Acme Support Bot',
  '{"welcome_message": "Hello! I am the Acme support bot. How can I help you?", "suggested_prompts": ["What is Acme?", "How do I sign up?"]}',
  '#10B981'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.chatbots (id, tenant_id, name, configuration_json, primary_color)
VALUES (
  'e0000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002',
  'Globex Helpdesk',
  '{"welcome_message": "Welcome to Globex Support. What can we do for you?", "suggested_prompts": ["Server Status", "Open a Ticket"]}',
  '#4F46E5'
) ON CONFLICT (id) DO NOTHING;

-- StyleFlo Homepage Assistant (STYL-181 / STYL-200 local+CI seed)
INSERT INTO public.chatbots (id, tenant_id, name, configuration_json, primary_color)
VALUES (
  '9825855e-d478-443f-b75c-6c0d77039ca6',
  '10000000-0000-0000-0000-000000000001',
  'StyleFlo Homepage Assistant',
  '{"welcome_message": "Hi, you''re through to FloChat! How can I help you today?", "require_client_name": true, "terms_version": "1.0"}'::jsonb,
  '#260475'
) ON CONFLICT (id) DO NOTHING;

-- 6. Seed Document Chunks
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

DROP FUNCTION IF EXISTS public.make_dummy_vector(float);

-- -----------------------------------------
-- ADDITIONAL COLLEAGUE DATA FOR TESTS
-- -----------------------------------------

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000003',
  'authenticated',
  'authenticated',
  'colleague@acme.com',
  crypt('password123', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"Acme Colleague"}',
  now(), now(), '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
VALUES
(
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '{"sub":"20000000-0000-0000-0000-000000000001","email":"admin@acme.com"}'::jsonb,
  'email',
  '20000000-0000-0000-0000-000000000001',
  now(), now(), now()
),
(
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000002',
  '{"sub":"20000000-0000-0000-0000-000000000002","email":"staff@globex.com"}'::jsonb,
  'email',
  '20000000-0000-0000-0000-000000000002',
  now(), now(), now()
),
(
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',
  '{"sub":"20000000-0000-0000-0000-000000000003","email":"colleague@acme.com"}'::jsonb,
  'email',
  '20000000-0000-0000-0000-000000000003',
  now(), now(), now()
),
(
  '20000000-0000-0000-0000-000000000099',
  '20000000-0000-0000-0000-000000000099',
  '{"sub":"20000000-0000-0000-0000-000000000099","email":"superadmin@styleflo.test"}'::jsonb,
  'email',
  '20000000-0000-0000-0000-000000000099',
  now(), now(), now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, role, is_super_admin)
VALUES (
  '20000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'member',
  false
) ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, role = EXCLUDED.role;

INSERT INTO public.staff (id, tenant_id, chatbot_id, name, email)
VALUES (
  '30000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000001',
  'Sarah Miller',
  'colleague@acme.com'
) ON CONFLICT (id) DO NOTHING;

-- Active add-on for Acme; keep a known disabled catalogue row for smoke checks
INSERT INTO public.tenant_active_addons (tenant_id, addon_catalog_id, is_active)
VALUES ('10000000-0000-0000-0000-000000000001', 'google_calendar_addon', true)
ON CONFLICT DO NOTHING;

UPDATE public.addon_catalog
SET is_active = false
WHERE id = 'whatsapp_addon';

-- Seed Services for Acme Corp
INSERT INTO public.services (id, tenant_id, name, duration_minutes, price)
VALUES (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Haircut & Styling',
  60,
  50.00
) ON CONFLICT (id) DO NOTHING;

-- Test customers with Ofcom drama-range numbers (07700 900xxx)
INSERT INTO public.appointments (
  id, tenant_id, staff_id, service_id,
  customer_name, customer_email, customer_phone,
  start_time, end_time
)
VALUES (
  '50000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003',
  '40000000-0000-0000-0000-000000000001',
  'Alex Drama',
  'alex.drama@example.test',
  '07700900123',
  now(),
  now() + interval '1 hour'
), (
  '50000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003',
  '40000000-0000-0000-0000-000000000001',
  'Jordan Fiction',
  'jordan.fiction@example.test',
  '07700900456',
  now() + interval '2 hours',
  now() + interval '3 hours'
) ON CONFLICT (id) DO UPDATE SET
  customer_name = EXCLUDED.customer_name,
  customer_email = EXCLUDED.customer_email,
  customer_phone = EXCLUDED.customer_phone;

-- End seed mode (signup trigger and superadmin protect resume normal behaviour)
SELECT set_config('app.seed_mode', 'off', false);
