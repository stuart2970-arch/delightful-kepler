import { test, expect } from '@playwright/test';

test.describe('Audit Regression Tests (T1 - T13)', () => {
  // T1: Password logging verification
  test('T1: Password logging verification on login', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      consoleLogs.push(msg.text());
    });

    await page.goto('/login');
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');

    await emailInput.fill('test-owner@styleflo.ai');
    await passwordInput.fill('SecretPassword123!');

    const submitBtn = page.getByRole('button', { name: /Sign In with Password/i });
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
    }

    // Verify no plaintext password or credential logs are emitted
    const leakedLog = consoleLogs.find(
      (log) =>
        log.includes('TRYING TO LOGIN:') ||
        log.includes('SecretPassword123!') ||
        log.toLowerCase().includes('password:')
    );
    expect(leakedLog).toBeUndefined();
  });

  // T2: Leaked prompt check
  test('T2: Prompt leak check in DOM and scripts', async ({ page }) => {
    for (const route of ['/login', '/register', '/']) {
      await page.goto(route);
      const pageContent = await page.content();
      expect(pageContent).not.toContain('SECURITY & PRIVACY GUARDRAILS');
      expect(pageContent).not.toContain('agent.md');
    }
  });

  // T4: WhatsApp not live / coming soon copy
  test('T4: WhatsApp not presented as currently live', async ({ page }) => {
    await page.goto('/login');
    // Check login page does not claim WhatsApp is active today
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('WhatsApp live');
    expect(bodyText).not.toContain('for WhatsApp and SMS messaging');
  });

  // T6: OpenClaw codename check
  test('T6: OpenClaw codename not leaked in customer copy', async ({ page }) => {
    await page.goto('/login');
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('OpenClaw');
    expect(bodyText).not.toContain('bypassing OpenClaw');
  });

  // T9: Welcome message wording check
  test('T9: Clean FloChat welcome message wording', async ({ page }) => {
    await page.goto('/login');
    const bodyText = await page.locator('body').innerText();
    // Ensure no malformed punctuation
    expect(bodyText).not.toContain('how can i help you today.?');
    expect(bodyText).not.toContain('StyleFlo ai...');
  });

  // T14: Mobile viewport responsiveness check at 390px
  test('T14: 390px mobile viewport fits without horizontal page overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(395);
  });

  // T15: UE 07 typo check
  test('T15: No UE 07 typos in UI text', async ({ page }) => {
    await page.goto('/login');
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('UE 07');
  });

  // T21: Favicon returns 200
  test('T21: Favicon exists and returns HTTP 200', async ({ page }) => {
    const response = await page.goto('/favicon.ico');
    expect(response?.status()).toBe(200);
  });

  // T22: British English spellings & No VAT
  test('T22: British English and No VAT claims on public routes', async ({ page }) => {
    await page.goto('/login');
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/\+ ?VAT/i);
    expect(bodyText).not.toMatch(/ex ?VAT/i);
    expect(bodyText).not.toContain('cancelation');
  });
});
