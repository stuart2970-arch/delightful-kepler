-- STYL-389: secure per-booking manage tokens (hash only; raw token never stored)
CREATE TABLE public.appointment_manage_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id uuid NOT NULL UNIQUE REFERENCES public.appointments (id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX appointment_manage_tokens_token_hash_idx
    ON public.appointment_manage_tokens (token_hash);

CREATE INDEX appointment_manage_tokens_expires_at_idx
    ON public.appointment_manage_tokens (expires_at);

ALTER TABLE public.appointment_manage_tokens ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies: access only via service role API routes.