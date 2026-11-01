import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWebCallVapiStartFields } from '../src/lib/voice/web-call-config';

const root = process.cwd();

test.describe('STYL-226: widget web calls do not record and use our webhook', () => {
  test('widget start payload sets recordingEnabled false and the Vapi webhook URL', () => {
    for (const rel of ['src/widget/index.ts', 'src/widget/embed.ts']) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src).toContain('recordingEnabled: false');
      expect(src).toContain('artifactPlan');
      expect(src).toContain('/api/webhooks/vapi');
      expect(src).not.toContain('vapiInstance.delete');
    }
    expect(buildWebCallVapiStartFields('https://staging.styleflo.ai')).toEqual({
      recordingEnabled: false,
      artifactPlan: { recordingEnabled: false },
      server: { url: 'https://staging.styleflo.ai/api/webhooks/vapi' },
    });
  });
});
