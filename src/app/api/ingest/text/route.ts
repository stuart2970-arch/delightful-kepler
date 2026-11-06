import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { z } from 'zod';
import { sanitizeForPostgres } from '@/lib/file-parser';
import { requireUser } from '@/lib/auth/require-superadmin';
import { dedupedIngest } from '@/lib/knowledge/ingest-documents';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const IngestTextSchema = z.object({
  text: z.string().min(10, { message: 'Text content must be at least 10 characters long' }),
  sourceName: z.string().min(1, { message: 'Source title/name is required' }),
  chatbotId: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, { message: 'Invalid chatbot ID format' }),
  dryRun: z.boolean().optional(),
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  console.log(`[Ingest Text][${requestId}] Processing text ingestion request...`);

  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  try {
    // 1. Authenticate user session (STYL-186: strict 401 when no session)
    const auth = await requireUser(request);
    if (!auth.ok) {
      return auth.response;
    }

    // 2. Validate request body
    const body = await request.json();
    const validation = IngestTextSchema.safeParse(body);

    if (!validation.success) {
      const errorMsg = validation.error.issues.map((i) => i.message).join(', ');
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    const { text, sourceName, chatbotId, dryRun } = validation.data;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const dbClient = adminClient;

    // 3. Verify user profile and tenant
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('tenant_id, is_super_admin')
      .eq('id', auth.userId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'User tenant profile not found' }, { status: 403 });
    }

    let tenantId: string;
    let targetChatbotId = chatbotId;

    if (profile.is_super_admin) {
      const { data: chatbot, error: chatbotError } = await adminClient
        .from('chatbots')
        .select('id, tenant_id')
        .eq('id', chatbotId)
        .maybeSingle();

      if (chatbotError || !chatbot) {
        return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
      }
      tenantId = chatbot.tenant_id;
      targetChatbotId = chatbot.id;
    } else {
      tenantId = profile.tenant_id;
      const { data: chatbot, error: chatbotError } = await adminClient
        .from('chatbots')
        .select('id, tenant_id')
        .eq('id', chatbotId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (chatbotError || !chatbot) {
        return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
      }
      targetChatbotId = chatbot.id;
    }

    // 4. Clean and sanitize text for PostgreSQL
    const textContent = sanitizeForPostgres(text);
    const sanitizedSourceName = sanitizeForPostgres(sourceName);

    if (textContent.length < 10) {
      return NextResponse.json({ error: 'Text content is too short to ingest.' }, { status: 400 });
    }

    // 5. Split text into chunks
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
    const docOutputs = await splitter.createDocuments([textContent]);
    const chunks = docOutputs
      .map((doc) => sanitizeForPostgres(doc.pageContent))
      .filter((content) => content.length > 0);

    if (chunks.length === 0) {
      return NextResponse.json({ error: 'Text splitting generated zero knowledge items' }, { status: 400 });
    }

    // 6. Hash and skip exact duplicates (STYL-189). Replacing this source (STYL-186)
    // does not count copies that already exist on another source.
    const outcome = await dedupedIngest({
      dbClient,
      tenantId,
      chatbotId: targetChatbotId,
      chunks,
      sourceUrl: sanitizedSourceName,
      metadata: { source_type: 'raw_text', title: sanitizedSourceName },
      dryRun: dryRun === true,
      replaceExistingSource: true,
      sourceLabel: `"${sanitizedSourceName}"`,
    });

    if (!outcome.ok) {
      return NextResponse.json(outcome.body, { status: outcome.status });
    }

    console.log(
      `[Ingest Text][${requestId}] ${dryRun ? 'Preview' : 'Stored'} ` +
      `${outcome.body.insertedCount} new, ${outcome.body.alreadyCoveredCount} already covered`,
    );
    return NextResponse.json(outcome.body);
  } catch (error: any) {
    console.error(`[Ingest Text][${requestId}] Unhandled error:`, error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
