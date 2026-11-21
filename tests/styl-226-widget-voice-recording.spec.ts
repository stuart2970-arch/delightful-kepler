import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWebCallVapiStartFields } from '../src/lib/voice/web-call-config';

const root = process.cwd();

test.describe('STYL-226: widget web calls do not record and use our webhook', () => {
  test('widget start payload sets recordingEnabled false and the Vapi webhook URL', () => {
    for (const rel of ['src/widget/index.ts', 'src/widget/embed.ts']) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src).toContain('buildWebCallVapiStartFields');
      expect(src).not.toContain('recordingEnabled: true');
      expect(src).toContain('/api/voice/web-call');
      expect(src).toContain('x-session-token');
      expect(src).not.toContain('serverUrl');
      expect(src).not.toContain('VAPI_WEBHOOK_SECRET');
      expect(src).not.toContain('vapiInstance.delete');
    }
    expect(buildWebCallVapiStartFields('https://staging.styleflo.ai')).toEqual({
      recordingEnabled: false,
      videoRecordingEnabled: false,
      artifactPlan: { recordingEnabled: false, videoRecordingEnabled: false },
    });
  });
});
