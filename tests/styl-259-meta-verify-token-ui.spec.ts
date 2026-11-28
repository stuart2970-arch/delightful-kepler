import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test.describe('STYL-259: META_VERIFY_TOKEN naming', () => {
  test('WhatsApp UI references META_VERIFY_TOKEN not the old name', () => {
    const view = readFileSync(
      join(process.cwd(), 'src/components/dashboard-views/WhatsAppMetaView.tsx'),
      'utf8',
    );
    expect(view).toContain('META_VERIFY_TOKEN');
    expect(view).not.toContain('META_WEBHOOK_VERIFY_TOKEN');
  });
});