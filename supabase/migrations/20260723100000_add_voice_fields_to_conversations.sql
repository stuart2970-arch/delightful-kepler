-- Add voice specific fields to conversations table
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS is_voice_call BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS resulted_in_booking BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS recording_url TEXT,
ADD COLUMN IF NOT EXISTS transcript TEXT;
