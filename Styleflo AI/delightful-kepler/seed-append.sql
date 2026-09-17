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
VALUES (
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',
  format('{"sub":"%s","email":"%s"}', '20000000-0000-0000-0000-000000000003', 'colleague@acme.com')::jsonb,
  'email',
  '20000000-0000-0000-0000-000000000003',
  now(), now(), now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, role)
VALUES (
  '20000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'member'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.staff (id, tenant_id, name, email)
VALUES (
  '30000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'Acme Colleague',
  'colleague@acme.com'
) ON CONFLICT (id) DO NOTHING;
