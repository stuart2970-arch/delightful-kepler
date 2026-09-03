import { test, expect } from '@playwright/test';
import { sanitizeForPostgres } from '@/lib/file-parser';

test.describe('Knowledge Base Ingestion Pipeline (URL, Text, File)', () => {
  const testChatbotId = '0d37a64b-a4e7-462d-834a-22c948bba528'; // Betfred chatbot

  test('sanitizeForPostgres should strip null bytes and unsupported Unicode escape sequences', () => {
    const dirtyText = 'StyleFlo\u0000 AI\x00 Receptionist\u0000 with \x0Bcontrol \x0Cchars and \uD800surrogates.';
    const cleanText = sanitizeForPostgres(dirtyText);
    expect(cleanText).not.toContain('\u0000');
    expect(cleanText).not.toContain('\x00');
    expect(cleanText).toBe('StyleFlo AI Receptionist with control chars and surrogates.');
  });

  test('POST /api/ingest/text should ingest text and generate vector embeddings', async ({ request }) => {
    const uniqueSourceName = `Playwright Test Text ${Date.now()}`;
    const testContent = 'Betfred is a leading UK bookmaker founded by Fred Done in Salford in 1967. Betfred provides sports betting, casino games, and customer care.';

    const response = await request.post('/api/ingest/text', {
      data: {
        text: testContent,
        sourceName: uniqueSourceName,
        chatbotId: testChatbotId,
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
      data: {
        text: dirtyContent,
        sourceName: uniqueSourceName,
        chatbotId: testChatbotId,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.chunksCount).toBeGreaterThan(0);
  });

  test('POST /api/ingest/file should accept and process markdown uploads with binary characters', async ({ request }) => {
    const fileContent = 'StyleFlo Brand Guidelines: \u0000Primary color is #260475.\x00 StyleFlo provides AI Receptionist builders for businesses.';
    const buffer = Buffer.from(fileContent, 'utf-8');

    const response = await request.post('/api/ingest/file', {
      multipart: {
        file: {
          name: 'brand-guidelines-\u0000test.md',
          mimeType: 'text/markdown',
          buffer: buffer,
        },
        chatbotId: testChatbotId,
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
      multipart: {
        file: {
          name: 'services.csv',
          mimeType: 'text/csv',
          buffer: buffer,
        },
        chatbotId: testChatbotId,
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
      data: {
        text: 'Short',
        sourceName: '',
        chatbotId: testChatbotId,
      },
    });
    expect(textRes.status()).toBe(400);
    const textData = await textRes.json();
    expect(textData.error).toBeTruthy();

    // Missing file
    const fileRes = await request.post('/api/ingest/file', {
      multipart: {
        chatbotId: testChatbotId,
      },
    });
    expect(fileRes.status()).toBe(400);
    const fileData = await fileRes.json();
    expect(fileData.error).toBeTruthy();

    // Invalid chatbot UUID
    const invalidBotRes = await request.post('/api/ingest/text', {
      data: {
        text: 'This is a valid length text sample for error testing.',
        sourceName: 'Test',
        chatbotId: 'invalid-uuid-123',
      },
    });
    expect(invalidBotRes.status()).toBe(400);
  });
});
