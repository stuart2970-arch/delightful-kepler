-- Migration: Update Extra Knowledge Add-on Name, Description, and Pricing
-- Ensures customer-facing terminology uses 'knowledge items' instead of 'chunks',
-- and aligns default price to £4.99/mo (499 pence) matching /superadmin.

UPDATE public.addon_catalog
SET 
    name = 'Extra Knowledge (500 Knowledge Items)',
    description = '500 additional knowledge items for your AI agent.',
    monthly_price_pence = 499,
    max_price_pence = 499
WHERE id = 'data_pack_500';

-- Log change to addon_audit_log
INSERT INTO public.addon_audit_log (
    addon_catalog_id,
    action,
    summary,
    new_value
) VALUES (
    'data_pack_500',
    'addon_updated',
    'Updated name to Extra Knowledge (500 Knowledge Items) and monthly price to £4.99 (499 pence) per STYL-170',
    jsonb_build_object(
        'name', 'Extra Knowledge (500 Knowledge Items)',
        'monthly_price_pence', 499,
        'description', '500 additional knowledge items for your AI agent.'
    )
);
