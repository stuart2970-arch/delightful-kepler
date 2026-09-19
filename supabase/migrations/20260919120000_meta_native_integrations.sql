-- Migration: Add native Meta Graph API integration columns to chatbots and tenants tables
-- Bypasses OpenClaw with direct Meta WhatsApp, Instagram, and Messenger integrations

ALTER TABLE public.chatbots
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_waba_id text,
  ADD COLUMN IF NOT EXISTS meta_access_token text,
  ADD COLUMN IF NOT EXISTS meta_verify_token text,
  ADD COLUMN IF NOT EXISTS meta_app_secret text,
  ADD COLUMN IF NOT EXISTS instagram_account_id text,
  ADD COLUMN IF NOT EXISTS messenger_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS messenger_page_id text;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS meta_access_token text,
  ADD COLUMN IF NOT EXISTS meta_verify_token text,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_waba_id text,
  ADD COLUMN IF NOT EXISTS instagram_account_id text,
  ADD COLUMN IF NOT EXISTS messenger_page_id text;

-- Add indexes for fast lookup during inbound webhook processing
CREATE INDEX IF NOT EXISTS idx_chatbots_whatsapp_phone_number_id ON public.chatbots(whatsapp_phone_number_id) WHERE whatsapp_phone_number_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chatbots_instagram_account_id ON public.chatbots(instagram_account_id) WHERE instagram_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chatbots_messenger_page_id ON public.chatbots(messenger_page_id) WHERE messenger_page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_whatsapp_phone_number_id ON public.tenants(whatsapp_phone_number_id) WHERE whatsapp_phone_number_id IS NOT NULL;
