import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

async function createSupabaseClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are missing');
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {}
      },
    },
  });
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const targetTenantId = formData.get('tenantId') as string;

    if (!file || !targetTenantId) {
      return NextResponse.json({ error: 'File and tenantId are required' }, { status: 400 });
    }

    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image size must be less than 2MB' }, { status: 400 });
    }

    const adminClient = getSupabaseAdmin();

    // Verify user ownership or superadmin status
    const { data: profile } = await adminClient
      .from('profiles')
      .select('tenant_id, is_super_admin')
      .eq('id', user.id)
      .single();

    if (!profile || (!profile.is_super_admin && profile.tenant_id !== targetTenantId)) {
      return NextResponse.json({ error: 'Unauthorized for this tenant' }, { status: 403 });
    }

    // Ensure bucket exists in Supabase Storage
    const bucketName = 'chatbot-assets';
    const { data: bucket, error: bucketError } = await adminClient.storage.getBucket(bucketName);

    if (bucketError || !bucket) {
      console.log(`[Upload Avatar API] Bucket '${bucketName}' not found. Creating...`);
      const { error: createBucketErr } = await adminClient.storage.createBucket(bucketName, {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
        fileSizeLimit: 2097152, // 2MB
      });

      if (createBucketErr) {
        console.error('[Upload Avatar API] Failed to create bucket:', createBucketErr);
      }
    }

    const fileExt = file.name.split('.').pop() || 'png';
    const filePath = `${targetTenantId}/${crypto.randomUUID()}.${fileExt}`;
    const arrayBuffer = await file.arrayBuffer();

    const { error: uploadError } = await adminClient.storage
      .from(bucketName)
      .upload(filePath, arrayBuffer, {
        upsert: true,
        contentType: file.type || 'image/png',
      });

    if (uploadError) {
      console.error('[Upload Avatar API] Upload error:', uploadError);
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    const { data: publicUrlData } = adminClient.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    return NextResponse.json({ 
      url: publicUrlData.publicUrl,
      avatarUrl: publicUrlData.publicUrl 
    });
  } catch (err: any) {
    console.error('[Upload Avatar API] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
