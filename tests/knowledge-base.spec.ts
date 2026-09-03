import { test, expect } from '@playwright/test';

test.describe('Knowledge Base Ingestion Pipeline (URL, Text, File)', () => {
  const testChatbotId = '0d37a64b-a4e7-462d-834a-22c948bba528'; // Betfred chatbot

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

  test('POST /api/ingest/file should accept and process markdown uploads', async ({ request }) => {
    const fileContent = 'StyleFlo Brand Guidelines: Primary color is #260475. StyleFlo provides AI Receptionist builders for businesses.';
    const buffer = Buffer.from(fileContent, 'utf-8');

    const response = await request.post('/api/ingest/file', {
      multipart: {
        file: {
          name: 'brand-guidelines-test.md',
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

    // Missing file
    const fileRes = await request.post('/api/ingest/file', {
      multipart: {
        chatbotId: testChatbotId,
      },
    });
    expect(fileRes.status()).toBe(400);
  });
});
