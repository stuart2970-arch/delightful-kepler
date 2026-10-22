-- Migration: Add conversations.channel and caller_number (no data changes)
-- STYL-190: Phone calls channel and caller number

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS channel text CHECK (channel IN ('web_chat', 'web_voice', 'phone')),
ADD COLUMN IF NOT EXISTS caller_number text;

CREATE INDEX IF NOT EXISTS conversations_tenant_channel_idx ON public.conversations(tenant_id, channel);
