-- Add Vapi Voice Integration capabilities to chatbots table

ALTER TABLE public.chatbots 
ADD COLUMN IF NOT EXISTS voice_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS vapi_public_key text,
ADD COLUMN IF NOT EXISTS vapi_assistant_id text;

-- The existing RLS policies on the chatbots table (e.g., SELECT for public/tenant, UPDATE for tenant/superadmin)
-- will automatically apply to these new columns. No new RLS policies are needed.
