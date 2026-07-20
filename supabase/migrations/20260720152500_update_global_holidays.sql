-- =========================================================================
-- Update Global Holidays Schema for Multi-Country and Specific Date
-- =========================================================================

-- We will drop and recreate the global_holidays table since it's brand new
-- and we want to change the schema from (country, month, day) to (countries text[], date date)

DROP TABLE IF EXISTS public.global_holidays;

CREATE TABLE IF NOT EXISTS public.global_holidays (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    countries text[] NOT NULL DEFAULT '{}',
    date date NOT NULL,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.global_holidays ENABLE ROW LEVEL SECURITY;

-- Allow read access for authenticated users (tenants)
CREATE POLICY "Allow read access for authenticated users on global_holidays" 
ON public.global_holidays FOR SELECT 
TO authenticated 
USING (true);
