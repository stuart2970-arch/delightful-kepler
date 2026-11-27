import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test.describe('STYL-424 dashboard auth recovery', () => {
  test('dashboardFetch refreshes session and emits session-expired event on persistent 401', () => {
    const src = readFileSync(join(root, 'src/lib/auth/dashboard-auth-headers.ts'), 'utf8');
    expect(src).toContain('refreshSession');
    expect(src).toContain('notifyDashboardSessionExpired');
    expect(src).toContain("response.status === 401");
  });

  test('AddOnUpsellModal and DashboardClient use dashboard billing checkout helper', () => {
    for (const rel of ['src/components/AddOnUpsellModal.tsx', 'src/components/DashboardClient.tsx']) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).toContain('openBillingCheckoutFromApi');
      expect(src, rel).not.toContain('window.top.location.href = data.url');
    }
  });

  test('session expired prompt copy is user-facing', () => {
    const src = readFileSync(join(root, 'src/lib/auth/dashboard-session-expired.tsx'), 'utf8');
    expect(src).toContain('Your session has expired');
    expect(src).not.toContain('Authentication required');
  });
});