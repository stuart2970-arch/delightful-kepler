-- Add a unique domain column to the tenants table for custom routing
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS domain varchar(255) UNIQUE;

-- Create an index to speed up domain lookups since it will be queried on every page load
CREATE INDEX IF NOT EXISTS tenants_domain_idx ON public.tenants(domain);
