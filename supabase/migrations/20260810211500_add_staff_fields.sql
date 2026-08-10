-- Add image_url, specialist_product, and bio to the staff table
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS specialist_product text,
  ADD COLUMN IF NOT EXISTS bio text;
