import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { extractTextFromFile, sanitizeForPostgres } from '@/lib/file-parser';
import { requireUser } from '@/lib/auth/require-superadmin';
import { dedupedIngest } from '@/lib/knowledge/ingest-documents';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  console.log(`[Ingest File][${requestId}] Processing file ingestion request...`);

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

    // 2. Parse form data
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (parseErr: any) {
      return NextResponse.json({ error: 'Invalid multipart/form-data payload' }, { status: 400 });
    }

    const file = formData.get('file') as File | null;
    const chatbotId = formData.get('chatbotId') as string | null;
    const dryRun = formData.get('dryRun') === 'true';

    if (!file || !chatbotId) {
      return NextResponse.json({ error: 'Missing file or chatbotId' }, { status: 400 });
    }

    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(chatbotId)) {
      return NextResponse.json({ error: 'Invalid chatbot ID format' }, { status: 400 });
    }

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

    // 4. Process file through universal multi-format file parser
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    console.log(`[Ingest File][${requestId}] Parsing file "${file.name}" (size: ${buffer.length} bytes)...`);
    const rawText = await extractTextFromFile(buffer, file.name, file.type);
    const textContent = sanitizeForPostgres(rawText);

    if (!textContent || textContent.length < 10) {
      return NextResponse.json({
        error: `Extracted text from "${file.name}" is empty or unreadable. If this is a scanned image, please copy and paste the text as TXT or Markdown.`
      }, { status: 400 });
    }

    console.log(`[Ingest File][${requestId}] Extracted ${textContent.length} characters of clean text.`);

    // 5. Split text into chunks
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
    const docOutputs = await splitter.createDocuments([textContent]);
    const chunks = docOutputs
      .map((doc) => sanitizeForPostgres(doc.pageContent))
      .filter((content) => content.length > 0);

    if (chunks.length === 0) {
      return NextResponse.json({ error: 'Text splitting generated zero knowledge items' }, { status: 400 });
    }

    // 6. Hash and skip exact duplicates (STYL-189). Replacing this file (STYL-186)
    // does not count copies that already exist under another source name.
    const sanitizedFileName = sanitizeForPostgres(file.name);
    const outcome = await dedupedIngest({
      dbClient,
      tenantId,
      chatbotId: targetChatbotId,
      chunks,
      sourceUrl: sanitizedFileName,
      metadata: { source_type: 'file', title: sanitizedFileName },
      dryRun,
      replaceExistingSource: true,
      sourceLabel: `"${sanitizedFileName}"`,
    });

    if (!outcome.ok) {
      return NextResponse.json(outcome.body, { status: outcome.status });
    }

    console.log(
      `[Ingest File][${requestId}] ${dryRun ? 'Preview' : 'Stored'} ` +
      `${outcome.body.insertedCount} new, ${outcome.body.alreadyCoveredCount} already covered from ${sanitizedFileName}`,
    );
    return NextResponse.json(outcome.body);
  } catch (error: any) {
    console.error(`[Ingest File][${requestId}] Unhandled error:`, error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
