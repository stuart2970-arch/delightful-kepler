-- STYL-359: usage meters and limit banners read features.name.
-- The id knowledge_data_chunks stays. Only the customer-facing label changes.
UPDATE public.features
SET name = 'Knowledge Items'
WHERE id = 'knowledge_data_chunks'
  AND name ILIKE '%chunk%';
