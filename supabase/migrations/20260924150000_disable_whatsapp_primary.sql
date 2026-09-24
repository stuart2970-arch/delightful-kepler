-- Deactivate whatsapp_primary bolt-on so users cannot purchase standalone WhatsApp without an agent / base subscription
UPDATE public.addon_catalog 
SET is_active = false 
WHERE id = 'whatsapp_primary';
