-- 1. Ensure tenants table has necessary dynamic metadata and location columns
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS google_maps_share_url text,
ADD COLUMN IF NOT EXISTS google_reviews jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS latitude numeric(10, 7),
ADD COLUMN IF NOT EXISTS longitude numeric(10, 7),
ADD COLUMN IF NOT EXISTS operating_hours_overrides jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS holiday_settings jsonb DEFAULT '{}'::jsonb;

-- 2. Ensure staff table has working_days JSONB schedule blocks and role
ALTER TABLE public.staff
ADD COLUMN IF NOT EXISTS working_days jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS role text DEFAULT 'Specialist';

-- 3. Create a public read-only indexes on slug and tenant columns for blazing-fast cached lookups
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON public.tenants (slug);
CREATE INDEX IF NOT EXISTS idx_staff_chatbot_id ON public.staff (chatbot_id);
