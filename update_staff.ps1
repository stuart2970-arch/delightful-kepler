$seedFile = "supabase/seed.sql"
$content = Get-Content $seedFile -Raw

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
