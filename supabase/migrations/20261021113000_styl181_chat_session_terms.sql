-- STYL-181: Record terms acceptance timestamp and version on chat_sessions
ALTER TABLE public.chat_sessions
ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS terms_version text NULL;

COMMENT ON COLUMN public.chat_sessions.terms_accepted_at IS 'Timestamp when user accepted terms of service and privacy notice';
COMMENT ON COLUMN public.chat_sessions.terms_version IS 'Version of terms accepted during session initialization';

-- STYL-181: Ensure homepage chatbot exists for session tracking and testing
INSERT INTO public.chatbots (id, tenant_id, name, configuration_json, primary_color)
SELECT 
  '9825855e-d478-443f-b75c-6c0d77039ca6',
  t.id,
  'StyleFlo Homepage Assistant',
  '{"welcome_message": "Hi, you''re through to FloChat! How can I help you today?", "require_client_name": true, "terms_version": "1.0"}'::jsonb,
  '#260475'
FROM public.tenants t
LIMIT 1
ON CONFLICT (id) DO NOTHING;

