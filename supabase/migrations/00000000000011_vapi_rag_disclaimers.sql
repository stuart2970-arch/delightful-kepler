-- 00000000000011_vapi_rag_disclaimers.sql

-- 1. Extend public.tenants with global voice disclaimer
ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS global_voice_disclaimer TEXT DEFAULT 'The following conversation is between you and an AI assistant and as such may not be 100% correct. You may also be asked for your email address, mobile number, and name. These details will be used to contact you with details of your booking and marketing at a later date. If you do not wish to be marketed to, you can unsubscribe at any time by following the link at the bottom of the email.';
