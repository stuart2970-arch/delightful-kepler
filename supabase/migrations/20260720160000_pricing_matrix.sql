-- =========================================================================
-- Pricing Matrix Updates (Option A: Versioning Support)
-- =========================================================================

-- 1. Add is_active flag to subscription_tiers for Plan Versioning
ALTER TABLE public.subscription_tiers
ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. Add string_value to tier_entitlements for non-integer features
ALTER TABLE public.tier_entitlements
ADD COLUMN IF NOT EXISTS string_value text;

-- 3. Add new feature categories if they don't exist
INSERT INTO public.feature_categories (id, name, description)
VALUES 
('marketing', 'Marketing Tools', 'Email and SMS marketing features'),
('telephony', 'Telephony', 'Phone numbers and SMS capabilities'),
('booking', 'Booking & Scheduling', 'Calendars and staff management')
ON CONFLICT (id) DO NOTHING;

-- 4. Add missing features from the Pricing Matrix spreadsheet
ALTER TABLE public.features
ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true;

INSERT INTO public.features (id, category_id, name, is_metered, is_available) VALUES
('chatbots_limit', 'core_ai', 'Chatbots Limit', false, true),
('google_calendar', 'booking', 'Google Calendar Sync', false, true),
('staff_names', 'booking', 'Staff Names (Rota)', false, true),
('services_limit', 'booking', 'Services Limit', false, true),
('web_presence', 'channels', 'Web Presence', false, true),
('reserve_with_google', 'channels', 'Reserve with Google', false, false),
('custom_domain', 'channels', 'Website Domain Pointing', false, false),
('inventory_control', 'integrations', 'Inventory Control', false, false),
('telephone_number', 'telephony', 'Telephone Number', false, false),
('mobile_number', 'telephony', 'Mobile Number', false, false),
('sms', 'telephony', 'SMS Texting', false, false),
('email_marketing', 'marketing', 'Email Marketing', false, false),
('sms_marketing', 'marketing', 'SMS Marketing', false, false)
ON CONFLICT (id) DO NOTHING;

-- 5. Seed the explicit values from the screenshot into tier_entitlements
-- (We will UPSERT to avoid crashing on existing ones)

-- BASIC / FREE
INSERT INTO public.tier_entitlements (tier_id, feature_id, included_volume, string_value) VALUES
('basic', 'chatbots_limit', 1, NULL),
('basic', 'message_allowance', 1000, NULL),
('basic', 'knowledge_data_chunks', 50, NULL)
ON CONFLICT (tier_id, feature_id) DO UPDATE SET included_volume = EXCLUDED.included_volume, string_value = EXCLUDED.string_value;

-- STARTER
INSERT INTO public.tier_entitlements (tier_id, feature_id, included_volume, string_value) VALUES
('starter', 'chatbots_limit', 1, NULL),
('starter', 'message_allowance', 5000, NULL),
('starter', 'knowledge_data_chunks', 100, NULL),
('starter', 'google_calendar', NULL, 'Individual Calendar'),
('starter', 'staff_names', 3, NULL),
('starter', 'web_presence', NULL, 'Page = styleflo.ai/[your-business-name]'),
('starter', 'services_limit', 15, NULL),
('starter', 'voice_receptionist', 1, NULL),
('starter', 'reserve_with_google', 1, NULL)
ON CONFLICT (tier_id, feature_id) DO UPDATE SET included_volume = EXCLUDED.included_volume, string_value = EXCLUDED.string_value;

-- PREMIUM
INSERT INTO public.tier_entitlements (tier_id, feature_id, included_volume, string_value) VALUES
('premium', 'chatbots_limit', 2, NULL),
('premium', 'message_allowance', 15000, NULL),
('premium', 'knowledge_data_chunks', 5000, NULL),
('premium', 'google_calendar', NULL, 'Multiple Calendars'),
('premium', 'staff_names', 6, NULL),
('premium', 'web_presence', NULL, 'Website x 3 page'),
('premium', 'services_limit', 50, NULL),
('premium', 'voice_receptionist', 1, NULL),
('premium', 'reserve_with_google', 1, NULL),
('premium', 'custom_domain', 1, NULL),
('premium', 'white_labeling', 1, NULL),
('premium', 'inventory_control', 1, NULL)
ON CONFLICT (tier_id, feature_id) DO UPDATE SET included_volume = EXCLUDED.included_volume, string_value = EXCLUDED.string_value;

-- ULTIMATE
INSERT INTO public.tier_entitlements (tier_id, feature_id, included_volume, string_value) VALUES
('ultimate', 'chatbots_limit', 3, NULL),
('ultimate', 'message_allowance', NULL, NULL), -- NULL means infinity
('ultimate', 'knowledge_data_chunks', NULL, 'API'),
('ultimate', 'google_calendar', NULL, 'Multiple Calendars'),
('ultimate', 'staff_names', 30, NULL),
('ultimate', 'web_presence', NULL, 'Website x 3 page'),
('ultimate', 'services_limit', 100, NULL),
('ultimate', 'voice_receptionist', 1, NULL),
('ultimate', 'reserve_with_google', 1, NULL),
('ultimate', 'custom_domain', 1, NULL),
('ultimate', 'white_labeling', 1, NULL),
('ultimate', 'inventory_control', 1, NULL),
('ultimate', 'telephone_number', 1, NULL),
('ultimate', 'mobile_number', 1, NULL),
('ultimate', 'sms', 1, NULL),
('ultimate', 'whatsapp_omni', 1, NULL),
('ultimate', 'email_marketing', 1, NULL),
('ultimate', 'sms_marketing', 1, NULL)
ON CONFLICT (tier_id, feature_id) DO UPDATE SET included_volume = EXCLUDED.included_volume, string_value = EXCLUDED.string_value;
