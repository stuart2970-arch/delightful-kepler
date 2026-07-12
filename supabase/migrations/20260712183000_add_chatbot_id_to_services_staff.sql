-- Add chatbot_id to services
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS chatbot_id uuid REFERENCES public.chatbots(id) ON DELETE CASCADE;

-- Add chatbot_id to staff
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS chatbot_id uuid REFERENCES public.chatbots(id) ON DELETE CASCADE;
