import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TENANT_PROFILE_SELECT, salonNameFromTenant } from '../src/lib/tenant-profile';

/**
 * STYL-217: the salon name entered at sign-up is stored on tenants.company_name.
 * The dashboard was selecting dropped business_address/postcode columns, so PostgREST
 * rejected the whole tenant row and the name never appeared.
 */

const root = process.cwd();

test.describe('STYL-217 salon name', () => {
  test('dashboard tenant select reads company_name and not the dropped address columns', () => {
    const columns = TENANT_PROFILE_SELECT.split(',').map((column) => column.trim());
    expect(columns).toContain('company_name');
    expect(columns).not.toContain('business_address');
    expect(columns).not.toContain('postcode');

    const page = readFileSync(join(root, 'src/app/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('TENANT_PROFILE_SELECT');
    expect(page).toContain('salonNameFromTenant');
    expect(page).not.toMatch(/select\(\s*['"`][^'"`]*\bbusiness_address\b/);
    expect(page).not.toMatch(/\.select\(\s*['"`][^'"`]*\bpostcode\b/);
  });

  test('salon display name is the saved company name', () => {
    expect(salonNameFromTenant('Willow & Thread Hair Studio')).toBe('Willow & Thread Hair Studio');
    expect(salonNameFromTenant('  Willow & Thread Hair Studio  ')).toBe('Willow & Thread Hair Studio');
    expect(salonNameFromTenant('')).toBe('');
    expect(salonNameFromTenant(null)).toBe('');
  });

  test('sidebar, account settings, and integrations show the salon name', () => {
    const dashboard = readFileSync(join(root, 'src/components/DashboardClient.tsx'), 'utf8');
    const integrations = readFileSync(join(root, 'src/components/dashboard-views/IntegrationsView.tsx'), 'utf8');
    expect(dashboard).toContain('data-testid="salon-name"');
    expect(dashboard).toContain('{tenantName}');
    expect(dashboard).toContain('data-testid="account-salon-name"');
    expect(integrations).toContain('data-testid="official-business-name"');
    expect(integrations).toContain('value={businessNameInput}');
  });
});
