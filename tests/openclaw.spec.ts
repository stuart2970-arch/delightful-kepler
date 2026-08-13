import { test, expect } from '@playwright/test';

test.describe('StyleFlo + OpenClaw Omnichannel Integration', () => {
  test('should return 401 Unauthorized if Bearer token is missing or invalid', async ({ request }) => {
    const response = await request.post('/api/openclaw/webhook?chatbotId=c0000000-0000-0000-0000-000000000001', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        senderId: '+447700900011',
        messageText: 'Hello',
        channelType: 'whatsapp',
      },
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  test('should return 400 Bad Request if chatbotId parameter is missing', async ({ request }) => {
    const response = await request.post('/api/openclaw/webhook', {
      headers: {
        'Authorization': 'Bearer openclaw_secret_bearer_key_to_styleflo_api',
        'Content-Type': 'application/json',
      },
      data: {
        senderId: '+447700900011',
        messageText: 'Hello',
        channelType: 'whatsapp',
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Missing chatbotId reference parameter');
  });
});
