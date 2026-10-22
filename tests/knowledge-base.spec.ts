import { test, expect } from '@playwright/test';
import { sanitizeForPostgres } from '@/lib/file-parser';
import { createTestSuperadminUser, createTestNormalUser, TestUserSession } from './test-auth-helper';

test.describe('Knowledge Base Ingestion Pipeline (URL, Text, File) & STYL-186', () => {
  const acmeTenantId = '10000000-0000-0000-0000-000000000001';
  const acmeChatbotId = 'e0000000-0000-0000-0000-000000000001'; // Local seed chatbot for Acme tenant
  const tenant2ChatbotId = 'e0000000-0000-0000-0000-000000000002'; // Local seed chatbot for Tenant 2

  let acmeUser: TestUserSession;
  let tenant2User: TestUserSession;
  let superadminUser: TestUserSession;

  test.beforeAll(async () => {
    acmeUser = await createTestNormalUser(acmeTenantId);
    tenant2User = await createTestNormalUser('10000000-0000-0000-0000-000000000002');
    superadminUser = await createTestSuperadminUser();
  });

  test.afterAll(async () => {
    if (acmeUser) await acmeUser.cleanup();
    if (tenant2User) await tenant2User.cleanup();
    if (superadminUser) await superadminUser.cleanup();
  });

  test('sanitizeForPostgres should strip null bytes and unsupported Unicode escape sequences', () => {
    const dirtyText = 'StyleFlo\u0000 AI\x00 Receptionist\u0000 with \x0Bcontrol \x0Cchars and \uD800surrogates.';
    const cleanText = sanitizeForPostgres(dirtyText);
    expect(cleanText).not.toContain('\u0000');
    expect(cleanText).not.toContain('\x00');
    expect(cleanText).toBe('StyleFlo AI Receptionist with control chars and surrogates.');
  });

  // -------------------------------------------------------------------------
  // STYL-186: Strict 401 Authentication Enforcement
  // -------------------------------------------------------------------------
  test('STYL-186: Ingest routes strictly return 401 Unauthorized when called without a session', async ({ request }) => {
    // 1. Crawl
    const crawlRes = await request.post('/api/ingest/crawl', {
      data: { url: 'https://example.com', chatbotId: acmeChatbotId }
    });
    expect(crawlRes.status()).toBe(401);

    // 2. Text
    const textRes = await request.post('/api/ingest/text', {
      data: { text: 'Some sample text content here', sourceName: 'Test Source', chatbotId: acmeChatbotId }
    });
    expect(textRes.status()).toBe(401);

    // 3. File
    const fileRes = await request.post('/api/ingest/file', {
      multipart: {
        file: { name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('Sample text') },
        chatbotId: acmeChatbotId
      }
    });
    expect(fileRes.status()).toBe(401);

    // 4. URLs list
    const urlsRes = await request.get(`/api/ingest/urls?chatbotId=${acmeChatbotId}`);
    expect(urlsRes.status()).toBe(401);

    // 5. URLs delete
    const deleteRes = await request.delete(`/api/ingest/urls?chatbotId=${acmeChatbotId}&sourceUrl=test`);
    expect(deleteRes.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // STYL-186: Chatbot ID Boundary & No Fallback
  // -------------------------------------------------------------------------
  test('STYL-186: Ingest routes return 404 for an unknown or other-tenant chatbot id (no fallback)', async ({ request }) => {
    const unknownBotId = '99999999-9999-4999-a999-999999999999';

    // 1. Unknown chatbot ID -> 404
    const unknownTextRes = await request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: { text: 'Valid test text longer than ten characters', sourceName: 'Test Source', chatbotId: unknownBotId }
    });
    expect(unknownTextRes.status()).toBe(404);

    // 2. Chatbot belonging to another tenant -> 404 (Acme user trying to access Tenant 2 chatbot)
    const otherTenantTextRes = await request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: { text: 'Valid test text longer than ten characters', sourceName: 'Cross-Tenant Attempt', chatbotId: tenant2ChatbotId }
    });
    expect(otherTenantTextRes.status()).toBe(404);

    // 3. Other tenant file ingestion -> 404
    const otherTenantFileRes = await request.post('/api/ingest/file', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      multipart: {
        file: { name: 'test.txt', mimeType: 'text/plain', buffer: Buffer.from('Valid content for test file') },
        chatbotId: tenant2ChatbotId
      }
    });
    expect(otherTenantFileRes.status()).toBe(404);

    // 4. Other tenant URLs list query -> 404
    const otherTenantUrlsRes = await request.get(`/api/ingest/urls?chatbotId=${tenant2ChatbotId}`, {
      headers: { Authorization: `Bearer ${acmeUser.token}` }
    });
    expect(otherTenantUrlsRes.status()).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Text Ingestion
  // -------------------------------------------------------------------------
  test('POST /api/ingest/text should ingest text and generate vector embeddings', async ({ request }) => {
    const uniqueSourceName = `Playwright Test Text ${Date.now()}`;
    const testContent = 'Betfred is a leading UK bookmaker founded by Fred Done in Salford in 1967. Betfred provides sports betting, casino games, and customer care.';

    const response = await request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: {
        text: testContent,
        sourceName: uniqueSourceName,
        chatbotId: acmeChatbotId,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.chunksCount).toBeGreaterThan(0);
  });

  test('POST /api/ingest/text with null bytes and special unicode should sanitize and ingest cleanly', async ({ request }) => {
    const uniqueSourceName = `Unicode Clean Test ${Date.now()}`;
    const dirtyContent = 'Document containing null byte \u0000 and escape sequence \\u0000 for StyleFlo customer onboarding testing.';

    const response = await request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: {
        text: dirtyContent,
        sourceName: uniqueSourceName,
        chatbotId: acmeChatbotId,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.chunksCount).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // File Ingestion
  // -------------------------------------------------------------------------
  test('POST /api/ingest/file should accept and process markdown uploads with binary characters', async ({ request }) => {
    const fileContent = 'StyleFlo Brand Guidelines: \u0000Primary color is #260475.\x00 StyleFlo provides AI Receptionist builders for businesses.';
    const buffer = Buffer.from(fileContent, 'utf-8');

    const response = await request.post('/api/ingest/file', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      multipart: {
        file: {
          name: `brand-guidelines-${Date.now()}-\u0000test.md`,
          mimeType: 'text/markdown',
          buffer: buffer,
        },
        chatbotId: acmeChatbotId,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.chunksCount).toBeGreaterThan(0);
  });

  test('POST /api/ingest/file should accept and process PDF uploads with valid text extraction', async ({ request }) => {
    const minimalPdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 54>>stream\nBT /F1 12 Tf 100 700 Td (Racing and Football Outlook 2026) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000244 00000 n \n0000000347 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n422\n%%EOF';
    const buffer = Buffer.from(minimalPdf);

    const response = await request.post('/api/ingest/file', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      multipart: {
        file: {
          name: `Racing-and-Football-Outlook-${Date.now()}.pdf`,
          mimeType: 'application/pdf',
          buffer: buffer,
        },
        chatbotId: acmeChatbotId,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.chunksCount).toBeGreaterThan(0);
  });

  test('POST /api/ingest/file should accept and format CSV spreadsheets', async ({ request }) => {
    const csvContent = 'Service,Price,Duration\nHaircut,£25,30 mins\nBeard Trim,£15,20 mins\nFull Package,£35,45 mins';
    const buffer = Buffer.from(csvContent, 'utf-8');

    const response = await request.post('/api/ingest/file', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      multipart: {
        file: {
          name: `services-${Date.now()}.csv`,
          mimeType: 'text/csv',
          buffer: buffer,
        },
        chatbotId: acmeChatbotId,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.chunksCount).toBeGreaterThan(0);
  });

  test('Knowledge Base API routes should enforce schema and return proper error responses on invalid payloads', async ({ request }) => {
    // Missing required text
    const textRes = await request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: {
        text: 'Short',
        sourceName: '',
        chatbotId: acmeChatbotId,
      },
    });
    expect(textRes.status()).toBe(400);
    const textData = await textRes.json();
    expect(textData.error).toBeTruthy();

    // Missing file
    const fileRes = await request.post('/api/ingest/file', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      multipart: {
        chatbotId: acmeChatbotId,
      },
    });
    expect(fileRes.status()).toBe(400);
    const fileData = await fileRes.json();
    expect(fileData.error).toBeTruthy();

    // Invalid chatbot UUID
    const invalidBotRes = await request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: {
        text: 'This is a valid length text sample for error testing.',
        sourceName: 'Test',
        chatbotId: 'invalid-uuid-123',
      },
    });
    expect(invalidBotRes.status()).toBe(400);
  });

  // -------------------------------------------------------------------------
  // STYL-186: List Grouping & Quota
  // -------------------------------------------------------------------------
  test('STYL-186: GET /api/ingest/urls groups sources and provides chunk counts, date, and quota', async ({ request }) => {
    const listRes = await request.get(`/api/ingest/urls?chatbotId=${acmeChatbotId}`, {
      headers: { Authorization: `Bearer ${acmeUser.token}` }
    });

    expect(listRes.status()).toBe(200);
    const data = await listRes.json();
    expect(Array.isArray(data.urls)).toBe(true);
    expect(typeof data.totalChunks).toBe('number');
    expect(data.quota).toBeDefined();
    expect(typeof data.quota.limit).toBe('number');
    expect(typeof data.quota.currentUsage).toBe('number');
    expect(typeof data.quota.remaining).toBe('number');

    if (data.urls.length > 0) {
      const first = data.urls[0];
      expect(first.url).toBeTruthy();
      expect(first.chunkCount).toBeGreaterThan(0);
      expect(first.latestDate).toBeTruthy();
      expect(first.sourceType).toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // STYL-186: No Duplicates on Re-ingest
  // -------------------------------------------------------------------------
  test('STYL-186: Re-ingesting the same source replaces chunks rather than duplicating them', async ({ request }) => {
    const sourceTitle = `Re-Ingest-Check-${Date.now()}`;
    const initialText = 'Initial version of the document knowledge content for duplication verification.';

    // Ingest turn 1
    const res1 = await request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: { text: initialText, sourceName: sourceTitle, chatbotId: acmeChatbotId }
    });
    expect(res1.status()).toBe(200);

    // Query list
    const list1 = await request.get(`/api/ingest/urls?chatbotId=${acmeChatbotId}`, {
      headers: { Authorization: `Bearer ${acmeUser.token}` }
    });
    const data1 = await list1.json();
    const matches1 = data1.urls.filter((u: any) => u.url === sourceTitle);
    expect(matches1.length).toBe(1);

    // Ingest turn 2 with updated text for the same sourceName
    const updatedText = 'Updated version with new pricing and business policies replacing previous content.';
    const res2 = await request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: { text: updatedText, sourceName: sourceTitle, chatbotId: acmeChatbotId }
    });
    expect(res2.status()).toBe(200);

    // Query list again: must still be exactly 1 item for this sourceTitle
    const list2 = await request.get(`/api/ingest/urls?chatbotId=${acmeChatbotId}`, {
      headers: { Authorization: `Bearer ${acmeUser.token}` }
    });
    const data2 = await list2.json();
    const matches2 = data2.urls.filter((u: any) => u.url === sourceTitle);
    expect(matches2.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // STYL-186: Delete Single Source
  // -------------------------------------------------------------------------
  test('STYL-186: DELETE /api/ingest/urls removes only the targeted source', async ({ request }) => {
    const sourceToDelete = `To-Delete-${Date.now()}`;
    const textToKeep = `Keep-This-${Date.now()}`;

    // Insert both
    await request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: { text: 'Content to delete shortly', sourceName: sourceToDelete, chatbotId: acmeChatbotId }
    });
    await request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: { text: 'Content to remain untouched', sourceName: textToKeep, chatbotId: acmeChatbotId }
    });

    // Delete single source
    const delRes = await request.delete(`/api/ingest/urls?chatbotId=${acmeChatbotId}&sourceUrl=${encodeURIComponent(sourceToDelete)}`, {
      headers: { Authorization: `Bearer ${acmeUser.token}` }
    });
    expect(delRes.status()).toBe(200);
    const delData = await delRes.json();
    expect(delData.success).toBe(true);
    expect(delData.deletedCount).toBeGreaterThan(0);

    // Verify list: sourceToDelete is gone, textToKeep remains
    const listRes = await request.get(`/api/ingest/urls?chatbotId=${acmeChatbotId}`, {
      headers: { Authorization: `Bearer ${acmeUser.token}` }
    });
    const listData = await listRes.json();
    expect(listData.urls.some((u: any) => u.url === sourceToDelete)).toBe(false);
    expect(listData.urls.some((u: any) => u.url === textToKeep)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // STYL-186: Delete All Knowledge for Chatbot (Tenant-Scoped)
  // -------------------------------------------------------------------------
  test('STYL-186: DELETE /api/ingest/urls?all=true clears all chunks for that bot without affecting other bots or tenants', async ({ request }) => {
    const uniqueAcmeItem = `Acme-Item-${Date.now()}`;
    const uniqueTenant2Item = `Tenant2-Item-${Date.now()}`;

    // Add chunk to Acme bot
    await request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: { text: 'Acme test chunk to be cleared by delete-all', sourceName: uniqueAcmeItem, chatbotId: acmeChatbotId }
    });

    // Add chunk to Tenant 2 bot
    await request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${tenant2User.token}` },
      data: { text: 'Tenant 2 chunk that must remain completely untouched', sourceName: uniqueTenant2Item, chatbotId: tenant2ChatbotId }
    });

    // Execute DELETE ALL on Acme bot
    const delAllRes = await request.delete(`/api/ingest/urls?chatbotId=${acmeChatbotId}&all=true`, {
      headers: { Authorization: `Bearer ${acmeUser.token}` }
    });
    expect(delAllRes.status()).toBe(200);
    const delAllData = await delAllRes.json();
    expect(delAllData.success).toBe(true);

    // Acme bot URLs list should now be empty
    const acmeListRes = await request.get(`/api/ingest/urls?chatbotId=${acmeChatbotId}`, {
      headers: { Authorization: `Bearer ${acmeUser.token}` }
    });
    const acmeListData = await acmeListRes.json();
    expect(acmeListData.urls.length).toBe(0);
    expect(acmeListData.totalChunks).toBe(0);

    // Tenant 2 bot must still contain its chunks untouched!
    const t2ListRes = await request.get(`/api/ingest/urls?chatbotId=${tenant2ChatbotId}`, {
      headers: { Authorization: `Bearer ${tenant2User.token}` }
    });
    const t2ListData = await t2ListRes.json();
    expect(t2ListData.urls.some((u: any) => u.url === uniqueTenant2Item)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // STYL-186: Knowledge Items Quota Limit Enforcement
  // -------------------------------------------------------------------------
  test('STYL-186: Knowledge items quota limit is strictly enforced with informative message', async ({ request }) => {
    // Generate a payload that requests far more than the 500 limit (e.g. 600,000 characters -> 600 chunks)
    const largeText = 'StyleFlo AI Receptionist customer knowledge entry for volume limit verification testing. '.repeat(6500);

    const overLimitRes = await request.post('/api/ingest/text', {
      headers: { Authorization: `Bearer ${acmeUser.token}` },
      data: {
        text: largeText,
        sourceName: `Oversized-Document-${Date.now()}`,
        chatbotId: acmeChatbotId,
      }
    });

    expect(overLimitRes.status()).toBe(403);
    const errData = await overLimitRes.json();
    expect(errData.error).toContain('Knowledge items limit reached');
    expect(errData.error).toContain('remaining');
  });
});
