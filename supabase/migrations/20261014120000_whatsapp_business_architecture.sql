-- =========================================================================
-- Migration: WhatsApp Business Platform Architecture (Embedded Signup v4)
-- Multi-tenant WhatsApp Accounts, Contacts, Messages, Daily Usage, and Twilio Auto-Capture
-- Retention: 90-day automated GDPR purge
-- =========================================================================

-- 1. WHATSAPP ACCOUNTS TABLE
CREATE TABLE IF NOT EXISTS public.whatsapp_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    waba_id TEXT NOT NULL,
    phone_number_id TEXT NOT NULL UNIQUE,
    display_phone TEXT,
    display_name TEXT,
    mode TEXT NOT NULL DEFAULT 'cloud' CHECK (mode IN ('cloud', 'coexistence')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verifying', 'connected', 'error', 'disconnected')),
    business_token_enc TEXT,
    token_key_version INT NOT NULL DEFAULT 1,
    pin_enc TEXT,
    twilio_number_sid TEXT,
    quality_rating TEXT DEFAULT 'UNKNOWN',
    messaging_limit TEXT DEFAULT 'TIER_NOT_SET',
    payment_status TEXT DEFAULT 'unknown',
    card_missing BOOLEAN DEFAULT false,
    last_card_check_at TIMESTAMPTZ,
    error_message TEXT,
    error_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_tenant_id ON public.whatsapp_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_phone_id ON public.whatsapp_accounts(phone_number_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_waba_id ON public.whatsapp_accounts(waba_id);

-- 2. WHATSAPP CONTACTS TABLE
CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    wa_id TEXT NOT NULL,
    profile_name TEXT,
    last_inbound_at TIMESTAMPTZ,
    opted_out BOOLEAN DEFAULT false,
    opted_out_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT whatsapp_contacts_tenant_wa_unique UNIQUE (tenant_id, wa_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_tenant_wa ON public.whatsapp_contacts(tenant_id, wa_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_last_inbound ON public.whatsapp_contacts(tenant_id, last_inbound_at);

-- 3. WHATSAPP MESSAGES TABLE (Idempotent wa_message_id, 90-day retention)
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.whatsapp_contacts(id) ON DELETE SET NULL,
    wa_message_id TEXT NOT NULL UNIQUE,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    type TEXT NOT NULL DEFAULT 'text',
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('received', 'sent', 'delivered', 'read', 'failed')),
    body TEXT,
    pricing_category TEXT,
    billable BOOLEAN,
    error_details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_tenant ON public.whatsapp_messages(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_wa_id ON public.whatsapp_messages(wa_message_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created ON public.whatsapp_messages(created_at);

-- 4. WHATSAPP DAILY USAGE AGGREGATION
CREATE TABLE IF NOT EXISTS public.whatsapp_usage_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    inbound INT DEFAULT 0,
    outbound INT DEFAULT 0,
    outbound_template INT DEFAULT 0,
    by_category JSONB DEFAULT '{"service":0,"utility":0,"marketing":0,"authentication":0}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT whatsapp_usage_daily_tenant_date UNIQUE (tenant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_usage_daily_tenant_date ON public.whatsapp_usage_daily(tenant_id, date DESC);

-- 5. WHATSAPP VERIFICATION CODES (For real-time Twilio auto-capture)
CREATE TABLE IF NOT EXISTS public.whatsapp_verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    twilio_number_sid TEXT,
    phone_number TEXT NOT NULL,
    code_enc TEXT NOT NULL,
    method TEXT DEFAULT 'SMS' CHECK (method IN ('SMS', 'VOICE')),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    consumed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_verification_codes_lookup 
    ON public.whatsapp_verification_codes(tenant_id, consumed, expires_at);

-- 6. GDPR 90-DAY AUTOMATED PURGE STORED PROCEDURE
CREATE OR REPLACE FUNCTION public.purge_expired_whatsapp_messages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_messages integer;
BEGIN
  -- 1. Purge messages older than 90 days
  DELETE FROM public.whatsapp_messages
  WHERE created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_messages = ROW_COUNT;

  -- 2. Cleanup expired verification codes older than 1 hour
  DELETE FROM public.whatsapp_verification_codes
  WHERE expires_at < NOW() - INTERVAL '1 hour';

  RETURN deleted_messages;
END;
$$;

-- 7. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.whatsapp_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_verification_codes ENABLE ROW LEVEL SECURITY;

-- whatsapp_accounts RLS
DROP POLICY IF EXISTS select_whatsapp_accounts ON public.whatsapp_accounts;
CREATE POLICY select_whatsapp_accounts ON public.whatsapp_accounts
    FOR SELECT TO authenticated
    USING (tenant_id = public.get_auth_tenant_id());

DROP POLICY IF EXISTS update_whatsapp_accounts ON public.whatsapp_accounts;
CREATE POLICY update_whatsapp_accounts ON public.whatsapp_accounts
    FOR UPDATE TO authenticated
    USING (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin());

DROP POLICY IF EXISTS delete_whatsapp_accounts ON public.whatsapp_accounts;
CREATE POLICY delete_whatsapp_accounts ON public.whatsapp_accounts
    FOR DELETE TO authenticated
    USING (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin());

-- whatsapp_contacts RLS
DROP POLICY IF EXISTS select_whatsapp_contacts ON public.whatsapp_contacts;
CREATE POLICY select_whatsapp_contacts ON public.whatsapp_contacts
    FOR SELECT TO authenticated
    USING (tenant_id = public.get_auth_tenant_id());

-- whatsapp_messages RLS
DROP POLICY IF EXISTS select_whatsapp_messages ON public.whatsapp_messages;
CREATE POLICY select_whatsapp_messages ON public.whatsapp_messages
    FOR SELECT TO authenticated
    USING (tenant_id = public.get_auth_tenant_id());

-- whatsapp_usage_daily RLS
DROP POLICY IF EXISTS select_whatsapp_usage_daily ON public.whatsapp_usage_daily;
CREATE POLICY select_whatsapp_usage_daily ON public.whatsapp_usage_daily
    FOR SELECT TO authenticated
    USING (tenant_id = public.get_auth_tenant_id());

-- whatsapp_verification_codes RLS
DROP POLICY IF EXISTS select_whatsapp_verification_codes ON public.whatsapp_verification_codes;
CREATE POLICY select_whatsapp_verification_codes ON public.whatsapp_verification_codes
    FOR SELECT TO authenticated
    USING (tenant_id = public.get_auth_tenant_id());

-- 8. CATALOG BOLT-ON ENSURANCE
-- Ensure whatsapp_addon is cataloged in addon_catalog with dynamic superadmin pricing
INSERT INTO public.addon_catalog (
    id, name, description, category, monthly_price_pence, included_messages, is_active, display_order
) VALUES (
    'whatsapp_addon',
    'WhatsApp Business AI Channel',
    'AI-powered WhatsApp Business messaging integration with automated salon bookings and inquiries.',
    'whatsapp',
    999,
    500,
    true,
    31
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    is_active = true;
