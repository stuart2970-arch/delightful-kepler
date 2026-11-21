import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestNormalUser, TestUserSession } from './test-auth-helper';

const GLOBEX = '10000000-0000-0000-0000-000000000002';
const DATA_PACK_ID = 'data_pack_500';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function panel(page: import('@playwright/test').Page) {
  return page.locator('main.flex-1');
}

async function clearDataPacks() {
  await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', DATA_PACK_ID);
}

async function clearGlobexKnowledgeUsage() {
  await admin.from('document_chunks').delete().eq('tenant_id', GLOBEX);
}

async function insertDataPacks(quantity: number) {
  const { error } = await admin.from('tenant_active_addons').insert({
    tenant_id: GLOBEX,
    addon_catalog_id: DATA_PACK_ID,
    feature_id: 'data_chunks_addon',
    quantity,
    is_active: true,
  });
  expect(error).toBeNull();
}

test.describe('STYL-218 / STYL-381 — knowledge items billing display', () => {
  let session: TestUserSession;

  test.beforeAll(async () => {
    session = await createTestNormalUser();
  });

  test.afterAll(async () => {
    if (session) await session.cleanup();
  });

  test.beforeEach(async () => {
    await clearDataPacks();
    await clearGlobexKnowledgeUsage();
  });

  test.afterEach(async () => {
    await clearDataPacks();
  });

  async function signIn(page: import('@playwright/test').Page) {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(session.user.email);
    await page.locator('input[type="password"]').fill('Password123!');
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  }

  test('Foundation-only tenant shows 0 of 500 knowledge items and no chunks copy', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard?tab=billing');
    await expect(panel(page)).toContainText('Knowledge items', { timeout: 15000 });
    await expect(panel(page)).toContainText('0 of 500 knowledge items');
    await expect(panel(page)).not.toContainText(/chunk/i);
  });

  test('one Extra Knowledge pack raises the limit to 1,000', async ({ page }) => {
    await insertDataPacks(1);
    await signIn(page);
    await page.goto('/dashboard?tab=billing');
    await expect(panel(page)).toContainText('0 of 1,000 knowledge items', { timeout: 15000 });
  });

  test('two Extra Knowledge packs raise the limit to 1,500', async ({ page }) => {
    await insertDataPacks(2);
    await signIn(page);
    await page.goto('/dashboard?tab=billing');
    await expect(panel(page)).toContainText('0 of 1,500 knowledge items', { timeout: 15000 });
  });
});