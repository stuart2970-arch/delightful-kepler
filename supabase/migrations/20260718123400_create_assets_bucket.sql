-- Create the chatbot-assets bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('chatbot-assets', 'chatbot-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Set up RLS policies for the bucket
-- Allow public access to read files
CREATE POLICY "Public Access" 
ON storage.objects FOR SELECT 
USING ( bucket_id = 'chatbot-assets' );

-- Allow authenticated users to upload files to their own tenant folder
CREATE POLICY "Tenant Upload Access" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (
    bucket_id = 'chatbot-assets' 
    AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
);

-- Allow authenticated users to update their own files
CREATE POLICY "Tenant Update Access" 
ON storage.objects FOR UPDATE 
TO authenticated 
USING (
    bucket_id = 'chatbot-assets' 
    AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
)
WITH CHECK (
    bucket_id = 'chatbot-assets' 
    AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
);

-- Allow authenticated users to delete their own files
CREATE POLICY "Tenant Delete Access" 
ON storage.objects FOR DELETE 
TO authenticated 
USING (
    bucket_id = 'chatbot-assets' 
    AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
);
