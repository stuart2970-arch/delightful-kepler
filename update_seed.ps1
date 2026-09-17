$seedFile = "supabase/seed.sql"
$content = Get-Content $seedFile -Raw

$newUser = "), (
  '00000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000003',
  'authenticated',
  'authenticated',
  'colleague@acme.com',
  crypt('password123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{""provider"":""email"",""providers"":[""email""]}',
  '{""name"":""Acme Colleague""}',
  now(),
  now(),
  '',
  '',
  '',
  ''
)"
$content = $content -replace "\)\s*ON CONFLICT \(id\) DO NOTHING;\s*-- 2a\. Insert Identities", "$newUser ON CONFLICT (id) DO NOTHING;`n`n-- 2a. Insert Identities"

$newIdentity = "), (
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',
  format('{""sub"":""%s"",""email"":""%s""}', '20000000-0000-0000-0000-000000000003', 'colleague@acme.com')::jsonb,
  'email',
  '20000000-0000-0000-0000-000000000003',
  now(),
  now(),
  now()
)"
$content = $content -replace "\)\s*ON CONFLICT \(id\) DO NOTHING;\s*-- 4\. Seed Profiles", "$newIdentity ON CONFLICT (id) DO NOTHING;`n`n-- 4. Seed Profiles"

$newProfile = "), (
  '20000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'member'
)"
$content = $content -replace "\)\s*ON CONFLICT \(id\) DO NOTHING;\s*-- 5\. Seed Chatbots", "$newProfile ON CONFLICT (id) DO NOTHING;`n`n-- 5. Seed Chatbots"

$newStaff = "-- Insert Colleague Staff
INSERT INTO public.staff (id, tenant_id, user_id, email, full_name, role)
VALUES (
  '30000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003',
  'colleague@acme.com',
  'Acme Colleague',
  'stylist'
) ON CONFLICT (id) DO NOTHING;
"
$content = $content + "`n`n" + $newStaff

Set-Content $seedFile $content
