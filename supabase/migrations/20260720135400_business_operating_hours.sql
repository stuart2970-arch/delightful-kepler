-- =========================================================================
-- Business Operating Hours and Global Holidays
-- =========================================================================

-- 1. Add JSONB columns to the tenants table for operating hours
ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS general_operating_hours jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS operating_hours_overrides jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS holiday_settings jsonb DEFAULT '{}'::jsonb;

-- 2. Create the global_holidays table for Superadmins
CREATE TABLE IF NOT EXISTS public.global_holidays (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country text NOT NULL,
    month integer NOT NULL CHECK (month >= 1 AND month <= 12),
    day integer NOT NULL CHECK (day >= 1 AND day <= 31),
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Enable RLS on global_holidays
ALTER TABLE public.global_holidays ENABLE ROW LEVEL SECURITY;

-- Superadmin can do anything to global_holidays, but since we don't have a strict superadmin role in DB, 
-- we will just allow authenticated users to read it (public info), and we will protect the insert/update/delete 
-- operations at the API layer (server-side with SERVICE_ROLE key).
CREATE POLICY select_global_holidays ON public.global_holidays 
FOR SELECT TO authenticated USING (true);
