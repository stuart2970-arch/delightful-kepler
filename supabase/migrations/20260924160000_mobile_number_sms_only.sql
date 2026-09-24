-- Migration: Remove voice minutes from mobile number bolt-on (strictly for WhatsApp and SMS only)
UPDATE public.addon_catalog
SET included_voice_minutes = 0,
    description = 'Dedicated mobile number for WhatsApp and SMS messages. Price varies by number type (£10.99–£14.99/mo).'
WHERE id = 'mobile_addon' OR category = 'mobile';
