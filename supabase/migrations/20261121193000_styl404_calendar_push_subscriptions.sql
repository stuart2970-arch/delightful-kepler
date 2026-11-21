-- STYL-404: store Google events.watch channels and Microsoft Graph change-notification subscriptions
CREATE TABLE IF NOT EXISTS public.calendar_push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
    calendar_id text NOT NULL,
    channel_id text NOT NULL,
    resource_id text,
    verification_token text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT calendar_push_subscriptions_provider_channel_key UNIQUE (provider, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_push_subscriptions_tenant
    ON public.calendar_push_subscriptions (tenant_id, provider);

CREATE INDEX IF NOT EXISTS idx_calendar_push_subscriptions_expires
    ON public.calendar_push_subscriptions (expires_at);

COMMENT ON TABLE public.calendar_push_subscriptions IS
    'Google events.watch push channels and Microsoft Graph webhook subscriptions for calendar change notifications';

ALTER TABLE public.calendar_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Rollback note: DROP TABLE IF EXISTS public.calendar_push_subscriptions CASCADE;