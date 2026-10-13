import { test, expect } from '@playwright/test';

test.describe('Meta Pixel & CookieYes Consent Tracking', () => {
  test('session-details API returns payment details without exposing personal data', async ({ request }) => {
    const res = await request.get('/api/billing/session-details?session_id=cs_test_mock_123');
    expect(res.status()).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.amount_paid).toBe(9.99);
    expect(json.currency).toBe('GBP');
    expect(json.order_id).toContain('test_order_cs_test_mock_123');

    // Security & Privacy Verification: No personal data
    expect(json.customer_name).toBeUndefined();
    expect(json.email).toBeUndefined();
    expect(json.customer_email).toBeUndefined();
    expect(json.address).toBeUndefined();
  });

  test('payment-confirmed page does not fire Purchase event when CookieYes advertising consent is missing', async ({ page }) => {
    // Collect all fbq calls in window
    await page.addInitScript(() => {
      (window as any).__fbqCalls = [];
      (window as any).fbq = (...args: any[]) => {
        (window as any).__fbqCalls.push(args);
      };
    });

    await page.goto('/payment-confirmed?session_id=cs_test_mock_123');
    await page.waitForSelector('text=Payment Confirmed');

    const fbqCalls = await page.evaluate(() => (window as any).__fbqCalls);
    const purchaseCalls = fbqCalls.filter((c: any[]) => c[0] === 'track' && c[1] === 'Purchase');
    expect(purchaseCalls.length).toBe(0);
  });

  test('payment-confirmed page fires Purchase event once when CookieYes advertising consent is granted', async ({ page }) => {
    // Set CookieYes consent with advertisement:yes and mock fbq
    await page.addInitScript(() => {
      document.cookie = 'cookieyes-consent=action:yes,advertisement:yes; path=/';
      (window as any).getCkyConsent = () => ({
        categories: { advertisement: true },
      });
      (window as any).__fbqCalls = [];
      (window as any).fbq = (...args: any[]) => {
        (window as any).__fbqCalls.push(args);
      };
    });

    await page.goto('/payment-confirmed?session_id=cs_test_mock_456&amount=14.98&order_id=sub_test_789');
    await page.waitForSelector('text=Payment Confirmed');

    const fbqCalls = await page.evaluate(() => (window as any).__fbqCalls);
    const initCalls = fbqCalls.filter((c: any[]) => c[0] === 'init');
    expect(initCalls.length).toBeGreaterThanOrEqual(1);
    expect(initCalls[0][1]).toBe('1072502378701795');

    const purchaseCalls = fbqCalls.filter((c: any[]) => c[0] === 'track' && c[1] === 'Purchase');
    expect(purchaseCalls.length).toBe(1);
    expect(purchaseCalls[0][2].currency).toBe('GBP');
    expect(purchaseCalls[0][3].eventID).toBe('pur_test_order_cs_test_mock_456');
  });

  test('when inside an iframe, CookieYes banner is NOT loaded and Purchase dispatches postMessage regardless of consent', async ({ page }) => {
    // Collect postMessage events sent to the parent window
    const messages: any[] = [];
    await page.exposeFunction('onParentMessage', (msg: any) => {
      messages.push(msg);
    });

    // Navigate to a parent page first so relative or absolute baseURL is resolved
    await page.goto('/');

    await page.evaluate(() => {
      window.addEventListener('message', (event) => {
        (window as any).onParentMessage(event.data);
      });

      const iframe = document.createElement('iframe');
      iframe.id = 'test-iframe';
      iframe.src = '/payment-confirmed?session_id=cs_test_mock_iframe&amount=9.99&order_id=sub_iframe_123';
      iframe.style.width = '800px';
      iframe.style.height = '600px';
      document.body.appendChild(iframe);
    });

    // Wait for the iframe content to load
    const iframeElement = page.frameLocator('#test-iframe');
    await expect(iframeElement.locator('text=Payment Confirmed')).toBeVisible({ timeout: 15000 });

    // 1. Verify inside the iframe, the #cookieyes banner script was NOT inserted
    const iframeCookieyes = await iframeElement.locator('#cookieyes').count();
    expect(iframeCookieyes).toBe(0);

    // 2. Verify postMessage was dispatched to parent
    const purchaseMessage = messages.find((m: any) => m && m.type === 'STYLEFLO_PURCHASE');
    expect(purchaseMessage).toBeDefined();
    expect(purchaseMessage.event).toBe('Purchase');
    expect(purchaseMessage.currency).toBe('GBP');
    expect(purchaseMessage.eventID).toContain('pur_');
  });
});
