import http from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { hashNormalizedContent, normalizeForHash } from '@/lib/knowledge/normalize-for-hash';
import {
  formatPreviewMessage,
  formatStoredIngestMessage,
  netIncomingForAllowance,
  prepareIncomingChunks,
} from '@/lib/knowledge/dedupe-chunks';
import { createTestNormalUser, type TestUserSession } from './test-auth-helper';

const acmeTenantId = '10000000-0000-0000-0000-000000000001';
const acmeChatbotId = 'e0000000-0000-0000-0000-000000000001';
const tenant2Id = '10000000-0000-0000-0000-000000000002';
const tenant2ChatbotId = 'e0000000-0000-0000-0000-000000000002';

test.describe('STYL-189 normalisation and hash', () => {
  test('normalizeForHash folds case, collapses whitespace, and keeps punctuation', () => {
    expect(normalizeForHash('  Hello \t\n WORLD  ')).toBe('hello world');
    expect(normalizeForHash('Hello, World!')).toBe('hello, world!');
    expect(normalizeForHash('Hello, World!')).not.toBe(normalizeForHash('Hello World'));
  });

  test('normalizeForHash applies Unicode NFC and treats empty text as empty', () => {
    expect(normalizeForHash('Cafe\u0301')).toBe(normalizeForHash('Café'));
    expect(normalizeForHash('Café')).toBe('café');
    expect(normalizeForHash('   \n\t  ')).toBe('');
    expect(normalizeForHash('')).toBe('');
  });

  test('hash is stable SHA-256 hex and changes when the text changes', () => {
    const left = hashNormalizedContent('Hello   WORLD');
    const right = hashNormalizedContent('hello world');
    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
    expect(hashNormalizedContent('Hello, World!')).not.toBe(hashNormalizedContent('Hello World'));
    expect(hashNormalizedContent('   ')).toBe('');
  });

  test('prepareIncomingChunks drops empties and keeps one copy of each hash', () => {
    const prepared = prepareIncomingChunks([
      'Hello World',
      'hello   world',
      '   \n',
      'Other fact about balayage aftercare.',
    ]);
    expect(prepared).toHaveLength(2);
    expect(prepared[0].content).toBe('Hello World');
    expect(prepared[0].contentHash).toBe(hashNormalizedContent('hello world'));
    expect(prepared[1].contentHash).toBe(hashNormalizedContent('Other fact about balayage aftercare.'));
  });

  test('allowance only counts knowledge items that will be stored', () => {
    expect(netIncomingForAllowance(3, 5)).toBe(0);
    expect(netIncomingForAllowance(8, 5)).toBe(3);
    expect(netIncomingForAllowance(2, 0)).toBe(2);
  });

  test('customer copy says knowledge items and never chunks', () => {
    const preview = formatPreviewMessage(3, 9);
    const stored = formatStoredIngestMessage(3, 9, '"Price list"');
    expect(preview).toBe('3 new knowledge items, 9 already covered (not charged).');
    expect(stored).toContain('already covered, not counted');
    expect(preview.toLowerCase()).not.toContain('chunk');
    expect(stored.toLowerCase()).not.toContain('chunk');
    expect(formatStoredIngestMessage(1, 0)).toBe('Successfully ingested 1 knowledge item.');
  });
});

function adminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for STYL-189 tests');
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function countRows(
  admin: SupabaseClient,
  filters: { tenantId?: string; chatbotId?: string; contentHash?: string; sourceUrl?: string },
): Promise<number> {
  let query = admin.from('document_chunks').select('*', { count: 'exact', head: true });
  if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
  if (filters.chatbotId) query = query.eq('chatbot_id', filters.chatbotId);
  if (filters.contentHash) query = query.eq('content_hash', filters.contentHash);
  if (filters.sourceUrl) query = query.eq('source_url', filters.sourceUrl);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count || 0;
}

test.describe('STYL-189 ingest-time dedupe', () => {
  let acmeUser: TestUserSession;
  let tenant2User: TestUserSession;
  let admin: SupabaseClient;
  let fixtureServer: http.Server;
  let fixturePort = 0;
  const createdBotIds: string[] = [];

  test.beforeAll(async () => {
    admin = adminClient();
    acmeUser = await createTestNormalUser(acmeTenantId);
    tenant2User = await createTestNormalUser(tenant2Id);

    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const productMatch = url.pathname.match(/\/shop\/([^/]+)\/collections\/all\/products\.json/);
      if (productMatch) {
        const token = productMatch[1];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          products: [{
            id: 189,
            title: `Patch test ${token}`,
            handle: 'patch-test-colour',
            body_html: `<p>STYL-189 shopify colour service ${token}. Includes a patch test before dye.</p>`,
            variants: [{ title: 'Default', price: '45.00', sku: 'PT189', available: true }],
            tags: ['colour'],
            product_type: 'Colour',
          }],
        }));
        return;
      }

      const pageMatch = url.pathname.match(/\/page\/([^/]+)\/([^/]+)/);
      if (!pageMatch) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      const kind = pageMatch[1] === 'other' ? 'other' : 'shared';
      const token = pageMatch[2];
      const body = kind === 'other'
        ? `STYL-189 tuesday hours ${token}. The colour bar is open from ten until six and consultations are upstairs.`
        : `STYL-189 shared colour consultation ${token}. A patch test is completed before any dye, and aftercare is written down for the guest.`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><title>${kind}</title></head><body><p>${body}</p></body></html>`);
    });

    await new Promise<void>((resolve) => {
      fixtureServer.listen(0, '127.0.0.1', () => resolve());
    });
    const address = fixtureServer.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
    fixturePort = address.port;
  });

  test.afterAll(async () => {
    await admin
      .from('tenant_feature_overrides')
      .delete()
      .eq('tenant_id', acmeTenantId)
      .eq('feature_id', 'knowledge_data_chunks')
      .eq('reason', 'styl-189 test');
    await admin.from('document_chunks').delete().like('source_url', 'styl189-%');
    if (fixturePort) {
      await admin.from('document_chunks').delete().like('source_url', `%127.0.0.1:${fixturePort}%`);
    }
    for (const botId of createdBotIds) {
      await admin.from('chatbots').delete().eq('id', botId);
    }
    await new Promise<void>((resolve) => fixtureServer?.close(() => resolve()));
    if (acmeUser) await acmeUser.cleanup();
    if (tenant2User) await tenant2User.cleanup();
  });

  function sentence(label: string): string {
    return `STYL-189 ${label} ${crypto.randomUUID()} colour consultation includes a patch test and written aftercare.`;
  }

  async function postText(
    request: APIRequestContext,
    user: TestUserSession,
    args: { text: string; sourceName: string; chatbotId: string; dryRun?: boolean },
  ) {
    return request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${user.token}` },
      data: args,
    });
  }

  test('SQL knowledge_content_hash matches the TypeScript helper', async () => {
    const samples = [
      'Hello World',
      '  HELLO   world \n\t',
      'Hello, World!',
      'Café already normalised',
      'Cafe\u0301 composed',
    ];
    for (const sample of samples) {
      const { data, error } = await admin.rpc('knowledge_content_hash', { raw: sample });
      expect(error, error?.message).toBeNull();
      expect(data).toBe(hashNormalizedContent(sample));
    }

    const { data: emptyHash } = await admin.rpc('knowledge_content_hash', { raw: '   \n' });
    expect(emptyHash).toBeNull();
  });

  test('text, file and crawl skip an identical second source and keep the allowance unchanged', async ({ request }) => {
    const text = sentence('shared-answer');
    const hash = hashNormalizedContent(text);
    const before = await countRows(admin, { tenantId: acmeTenantId, contentHash: hash });

    const first = await postText(request, acmeUser, {
      text,
      sourceName: `styl189-text-a-${Date.now()}`,
      chatbotId: acmeChatbotId,
    });
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.insertedCount).toBeGreaterThan(0);
    expect(firstBody.chunksCount).toBe(firstBody.insertedCount);
    expect(firstBody.message.toLowerCase()).not.toContain('chunk');
    const afterFirst = await countRows(admin, { tenantId: acmeTenantId, contentHash: hash });
    expect(afterFirst).toBe(before + firstBody.insertedCount);

    const second = await postText(request, acmeUser, {
      text: text.toUpperCase().replace(/COLOUR/g, 'colour'),
      sourceName: `styl189-text-b-${Date.now()}`,
      chatbotId: acmeChatbotId,
    });
    expect(second.status()).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.insertedCount).toBe(0);
    expect(secondBody.skippedDuplicateCount).toBeGreaterThanOrEqual(1);
    expect(secondBody.alreadyCoveredCount).toBe(secondBody.skippedDuplicateCount);
    expect(secondBody.message).toContain('already covered, not counted');
    expect(await countRows(admin, { tenantId: acmeTenantId, contentHash: hash })).toBe(afterFirst);

    const fileName = `styl189-file-${Date.now()}.txt`;
    const fileRes = await request.post('/api/ingest/file', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      multipart: {
        file: { name: fileName, mimeType: 'text/plain', buffer: Buffer.from(text) },
        chatbotId: acmeChatbotId,
      },
    });
    expect(fileRes.status()).toBe(200);
    const fileBody = await fileRes.json();
    expect(fileBody.insertedCount).toBe(0);
    expect(fileBody.skippedDuplicateCount).toBeGreaterThanOrEqual(1);
    expect(await countRows(admin, { tenantId: acmeTenantId, contentHash: hash })).toBe(afterFirst);

    const token = crypto.randomUUID();
    const crawlA = `http://127.0.0.1:${fixturePort}/page/shared/${token}`;
    const crawlB = `http://127.0.0.1:${fixturePort}/page/shared-b/${token}`;
    const crawled = await request.post('/api/ingest/crawl', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: { url: crawlA, chatbotId: acmeChatbotId },
    });
    expect(crawled.status()).toBe(200);
    const crawledBody = await crawled.json();
    expect(crawledBody.insertedCount).toBeGreaterThan(0);
    const crawlCount = await countRows(admin, { tenantId: acmeTenantId, chatbotId: acmeChatbotId, sourceUrl: crawlA });

    const crawledAgain = await request.post('/api/ingest/crawl', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: { url: crawlB, chatbotId: acmeChatbotId },
    });
    expect(crawledAgain.status()).toBe(200);
    const crawledAgainBody = await crawledAgain.json();
    expect(crawledAgainBody.insertedCount).toBe(0);
    expect(crawledAgainBody.skippedDuplicateCount).toBeGreaterThanOrEqual(1);
    expect(await countRows(admin, { tenantId: acmeTenantId, chatbotId: acmeChatbotId, sourceUrl: crawlA })).toBe(crawlCount);
    expect(await countRows(admin, { tenantId: acmeTenantId, chatbotId: acmeChatbotId, sourceUrl: crawlB })).toBe(0);
  });

  test('the same text for another tenant or another chatbot is stored again', async ({ request }) => {
    const text = sentence('cross-scope');
    const hash = hashNormalizedContent(text);

    const acme = await postText(request, acmeUser, {
      text,
      sourceName: `styl189-cross-acme-${Date.now()}`,
      chatbotId: acmeChatbotId,
    });
    expect(acme.status()).toBe(200);
    expect((await acme.json()).insertedCount).toBeGreaterThan(0);

    const otherTenant = await postText(request, tenant2User, {
      text,
      sourceName: `styl189-cross-globex-${Date.now()}`,
      chatbotId: tenant2ChatbotId,
    });
    expect(otherTenant.status()).toBe(200);
    const otherBody = await otherTenant.json();
    expect(otherBody.insertedCount).toBeGreaterThan(0);
    expect(await countRows(admin, { tenantId: tenant2Id, chatbotId: tenant2ChatbotId, contentHash: hash })).toBe(otherBody.insertedCount);
    expect(await countRows(admin, { tenantId: acmeTenantId, chatbotId: acmeChatbotId, contentHash: hash })).toBeGreaterThan(0);

    const botId = crypto.randomUUID();
    createdBotIds.push(botId);
    const { error: botError } = await admin.from('chatbots').insert({
      id: botId,
      tenant_id: acmeTenantId,
      name: 'STYL-189 dedupe bot',
      configuration_json: {},
    });
    expect(botError).toBeNull();

    const otherBot = await postText(request, acmeUser, {
      text,
      sourceName: `styl189-cross-bot-${Date.now()}`,
      chatbotId: botId,
    });
    expect(otherBot.status()).toBe(200);
    expect((await otherBot.json()).insertedCount).toBeGreaterThan(0);
    expect(await countRows(admin, { tenantId: acmeTenantId, chatbotId: botId, contentHash: hash })).toBeGreaterThan(0);
  });

  test('a duplicate does not trip the allowance, and a new item still does', async ({ request }) => {
    const existing = sentence('allowance-existing');
    const fresh = sentence('allowance-fresh');
    const seeded = await postText(request, acmeUser, {
      text: existing,
      sourceName: `styl189-allow-seed-${Date.now()}`,
      chatbotId: acmeChatbotId,
    });
    expect(seeded.status()).toBe(200);

    const { data: previous } = await admin
      .from('tenant_feature_overrides')
      .select('*')
      .eq('tenant_id', acmeTenantId)
      .eq('feature_id', 'knowledge_data_chunks')
      .maybeSingle();

    const usage = await countRows(admin, { tenantId: acmeTenantId });
    const { error: overrideError } = await admin.from('tenant_feature_overrides').upsert({
      tenant_id: acmeTenantId,
      feature_id: 'knowledge_data_chunks',
      override_limit_value: usage,
      reason: 'styl-189 test',
    }, { onConflict: 'tenant_id,feature_id' });
    expect(overrideError).toBeNull();

    try {
      const duplicate = await postText(request, acmeUser, {
        text: existing,
        sourceName: `styl189-allow-dup-${Date.now()}`,
        chatbotId: acmeChatbotId,
      });
      expect(duplicate.status()).toBe(200);
      const duplicateBody = await duplicate.json();
      expect(duplicateBody.insertedCount).toBe(0);
      expect(duplicateBody.skippedDuplicateCount).toBeGreaterThanOrEqual(1);
      expect(await countRows(admin, { tenantId: acmeTenantId })).toBe(usage);

      const unique = await postText(request, acmeUser, {
        text: fresh,
        sourceName: `styl189-allow-new-${Date.now()}`,
        chatbotId: acmeChatbotId,
      });
      expect(unique.status()).toBe(403);
      const uniqueBody = await unique.json();
      expect(uniqueBody.error).toContain('Knowledge items limit reached');
      expect(await countRows(admin, { tenantId: acmeTenantId })).toBe(usage);
    } finally {
      if (previous) {
        await admin.from('tenant_feature_overrides').upsert(previous, { onConflict: 'tenant_id,feature_id' });
      } else {
        await admin
          .from('tenant_feature_overrides')
          .delete()
          .eq('tenant_id', acmeTenantId)
          .eq('feature_id', 'knowledge_data_chunks');
      }
    }
  });

  test('re-ingesting a source replaces it and does not duplicate a hash held by another source', async ({ request }) => {
    const shared = sentence('overlap-shared');
    const original = sentence('overlap-original');
    const replacement = sentence('overlap-replacement');
    const sharedHash = hashNormalizedContent(shared);
    const otherSource = `styl189-overlap-other-${Date.now()}`;
    const targetSource = `styl189-overlap-target-${Date.now()}`;

    expect((await postText(request, acmeUser, { text: shared, sourceName: otherSource, chatbotId: acmeChatbotId })).status()).toBe(200);
    expect((await postText(request, acmeUser, { text: original, sourceName: targetSource, chatbotId: acmeChatbotId })).status()).toBe(200);
    expect(await countRows(admin, { chatbotId: acmeChatbotId, sourceUrl: targetSource })).toBeGreaterThan(0);

    const replaced = await postText(request, acmeUser, {
      text: replacement,
      sourceName: targetSource,
      chatbotId: acmeChatbotId,
    });
    expect(replaced.status()).toBe(200);
    expect((await replaced.json()).insertedCount).toBeGreaterThan(0);
    expect(await countRows(admin, { chatbotId: acmeChatbotId, contentHash: hashNormalizedContent(original) })).toBe(0);
    expect(await countRows(admin, { chatbotId: acmeChatbotId, contentHash: hashNormalizedContent(replacement) })).toBeGreaterThan(0);
    expect(await countRows(admin, { chatbotId: acmeChatbotId, contentHash: sharedHash })).toBe(1);

    const overlapped = await postText(request, acmeUser, {
      text: shared,
      sourceName: targetSource,
      chatbotId: acmeChatbotId,
    });
    expect(overlapped.status()).toBe(200);
    const overlappedBody = await overlapped.json();
    expect(overlappedBody.insertedCount).toBe(0);
    expect(overlappedBody.skippedDuplicateCount).toBeGreaterThanOrEqual(1);
    expect(await countRows(admin, { chatbotId: acmeChatbotId, contentHash: sharedHash })).toBe(1);
    expect(await countRows(admin, { chatbotId: acmeChatbotId, contentHash: hashNormalizedContent(replacement) })).toBe(0);
  });

  test('dryRun reports new and already-covered counts without writing', async ({ request }) => {
    const text = sentence('preview');
    const source = `styl189-preview-${Date.now()}`;
    const before = await countRows(admin, { tenantId: acmeTenantId });

    const preview = await postText(request, acmeUser, {
      text,
      sourceName: source,
      chatbotId: acmeChatbotId,
      dryRun: true,
    });
    expect(preview.status()).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.dryRun).toBe(true);
    expect(previewBody.wouldInsertCount).toBeGreaterThan(0);
    expect(previewBody.alreadyCoveredCount).toBe(0);
    expect(previewBody.insertedCount).toBe(0);
    expect(previewBody.chunksCount).toBe(0);
    expect(previewBody.message).toContain('already covered (not charged)');
    expect(previewBody.message.toLowerCase()).not.toContain('chunk');
    expect(await countRows(admin, { tenantId: acmeTenantId })).toBe(before);

    const stored = await postText(request, acmeUser, {
      text,
      sourceName: source,
      chatbotId: acmeChatbotId,
    });
    expect(stored.status()).toBe(200);
    const afterStore = await countRows(admin, { tenantId: acmeTenantId });
    expect(afterStore).toBeGreaterThan(before);

    const secondPreview = await postText(request, acmeUser, {
      text,
      sourceName: `styl189-preview-b-${Date.now()}`,
      chatbotId: acmeChatbotId,
      dryRun: true,
    });
    expect(secondPreview.status()).toBe(200);
    const secondBody = await secondPreview.json();
    expect(secondBody.wouldInsertCount).toBe(0);
    expect(secondBody.alreadyCoveredCount).toBeGreaterThanOrEqual(1);
    expect(await countRows(admin, { tenantId: acmeTenantId })).toBe(afterStore);

    const token = crypto.randomUUID();
    const crawlUrl = `http://127.0.0.1:${fixturePort}/page/other/${token}`;
    const beforeCrawl = await countRows(admin, { tenantId: acmeTenantId });
    const crawlPreview = await request.post('/api/ingest/crawl', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: { url: crawlUrl, chatbotId: acmeChatbotId, dryRun: true },
    });
    expect(crawlPreview.status()).toBe(200);
    const crawlPreviewBody = await crawlPreview.json();
    expect(crawlPreviewBody.dryRun).toBe(true);
    expect(crawlPreviewBody.wouldInsertCount).toBeGreaterThan(0);
    expect(crawlPreviewBody.insertedCount).toBe(0);
    expect(await countRows(admin, { tenantId: acmeTenantId })).toBe(beforeCrawl);

    const filePreview = await request.post('/api/ingest/file', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      multipart: {
        file: {
          name: `styl189-preview-${Date.now()}.txt`,
          mimeType: 'text/plain',
          buffer: Buffer.from(text),
        },
        chatbotId: acmeChatbotId,
        dryRun: 'true',
      },
    });
    expect(filePreview.status()).toBe(200);
    const filePreviewBody = await filePreview.json();
    expect(filePreviewBody.dryRun).toBe(true);
    expect(filePreviewBody.wouldInsertCount).toBe(0);
    expect(filePreviewBody.alreadyCoveredCount).toBeGreaterThanOrEqual(1);
    expect(await countRows(admin, { tenantId: acmeTenantId })).toBe(beforeCrawl);
  });

  test('two parallel inserts of the same text leave a single row and both succeed', async ({ request }) => {
    const text = sentence('race');
    const hash = hashNormalizedContent(text);
    const [first, second] = await Promise.all([
      postText(request, acmeUser, {
        text,
        sourceName: `styl189-race-a-${crypto.randomUUID()}`,
        chatbotId: acmeChatbotId,
      }),
      postText(request, acmeUser, {
        text,
        sourceName: `styl189-race-b-${crypto.randomUUID()}`,
        chatbotId: acmeChatbotId,
      }),
    ]);

    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(first.status(), JSON.stringify(firstBody)).toBe(200);
    expect(second.status(), JSON.stringify(secondBody)).toBe(200);
    expect(firstBody.insertedCount + secondBody.insertedCount).toBe(1);
    expect(await countRows(admin, { tenantId: acmeTenantId, chatbotId: acmeChatbotId, contentHash: hash })).toBe(1);
  });

  test('Shopify execute skips an identical product and does not write chunk_source_type', async ({ request }) => {
    const token = crypto.randomUUID();
    const storeUrl = `http://127.0.0.1:${fixturePort}/shop/${token}`;
    const sourceUrl = `${storeUrl}/products/patch-test-colour`;

    const run = async () => {
      const response = await request.get(
        `/api/ingest/shopify/execute?storeUrl=${encodeURIComponent(storeUrl)}&chatbotId=${acmeChatbotId}`,
        { headers: { Authorization: `Bearer ${acmeUser.token}` } },
      );
      const raw = await response.text();
      expect(response.status(), raw).toBe(200);
      const events = raw.split('\n\n').flatMap((block) => {
        const line = block.split('\n').find((entry) => entry.startsWith('data: '));
        return line ? [JSON.parse(line.slice(6))] : [];
      });
      const complete = events.find((event) => event.type === 'complete');
      const error = events.find((event) => event.type === 'error');
      expect(error, raw).toBeUndefined();
      expect(complete, raw).toBeTruthy();
      return complete;
    };

    const first = await run();
    expect(first.insertedCount).toBeGreaterThan(0);
    expect(first.message.toLowerCase()).not.toContain('chunk');
    expect(await countRows(admin, { chatbotId: acmeChatbotId, sourceUrl })).toBe(first.insertedCount);

    const second = await run();
    expect(second.insertedCount).toBe(0);
    expect(second.skippedDuplicateCount).toBeGreaterThanOrEqual(1);
    expect(second.alreadyCoveredCount).toBe(second.skippedDuplicateCount);
    expect(await countRows(admin, { chatbotId: acmeChatbotId, sourceUrl })).toBe(first.insertedCount);
  });
});
