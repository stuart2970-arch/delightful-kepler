-- Migration: Add multichannel integration properties to chatbots table
ALTER TABLE public.chatbots
  ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number text,
  ADD COLUMN IF NOT EXISTS instagram_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS sms_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_phone_number text,
  ADD COLUMN IF NOT EXISTS openclaw_agent_token text;

-- Add indexes for fast lookup during webhook routing loops
CREATE INDEX IF NOT EXISTS idx_chatbots_whatsapp_phone ON public.chatbots(whatsapp_phone_number) WHERE whatsapp_enabled = true;
CREATE INDEX IF NOT EXISTS idx_chatbots_instagram_handle ON public.chatbots(instagram_handle) WHERE instagram_enabled = true;
CREATE INDEX IF NOT EXISTS idx_chatbots_sms_phone ON public.chatbots(sms_phone_number) WHERE sms_enabled = true;

-- Ensure that these settings are readable by authenticated users in their tenant
DROP POLICY IF EXISTS select_chatbot ON public.chatbots;
CREATE POLICY select_chatbot ON public.chatbots
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());
