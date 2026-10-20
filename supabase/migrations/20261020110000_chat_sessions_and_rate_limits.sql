-- STYL-176: Add-only schema for chat session tracking and rate limiting

CREATE TABLE IF NOT EXISTS public.chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chatbot_id UUID REFERENCES public.chatbots(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL UNIQUE,
    token_hash TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_chatbot ON public.chat_sessions(chatbot_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_expires_at ON public.chat_sessions(expires_at);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on chat_sessions"
    ON public.chat_sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.chat_rate_limits (
    rate_key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 1,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_rate_limits_window ON public.chat_rate_limits(window_start);

ALTER TABLE public.chat_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on chat_rate_limits"
    ON public.chat_rate_limits
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
