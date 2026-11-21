import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyVapiNoRecordingFlags } from '../src/lib/voice/vapi-recording-policy';
import { sealWebCallAssistant } from '../src/lib/voice/vapi-server';
import { voiceUnavailableAssistantResponse } from '../src/lib/voice/unavailable-assistant';

const root = process.cwd();

const REQUIRED_RECORDING_PATHS = [
  'src/lib/voice/vapi-server.ts',
  'src/lib/voice/unavailable-assistant.ts',
  'src/app/api/webhooks/vapi/assistant/route.ts',
  'src/lib/voice/web-call-config.ts',
  'src/widget/index.ts',
  'src/widget/embed.ts',
  'src/lib/voice/end-of-call-report.ts',
] as const;

test.describe('STYL-384: Vapi recordings stay off everywhere', () => {
  test('applyVapiNoRecordingFlags wins over client overrides', () => {
    const sealed = applyVapiNoRecordingFlags({
      recordingEnabled: true,
      videoRecordingEnabled: true,
      artifactPlan: { recordingEnabled: true, videoRecordingEnabled: true },
    });
    expect(sealed.recordingEnabled).toBe(false);
    expect(sealed.videoRecordingEnabled).toBe(false);
    expect((sealed.artifactPlan as Record<string, unknown>).recordingEnabled).toBe(false);
    expect((sealed.artifactPlan as Record<string, unknown>).videoRecordingEnabled).toBe(false);
  });

  test('sealWebCallAssistant and unavailable assistant force recording off', () => {
    const web = sealWebCallAssistant({ recordingEnabled: true }, { url: 'https://app.test/api/webhooks/vapi', secret: 's' });
    expect(web.recordingEnabled).toBe(false);
    expect(web.videoRecordingEnabled).toBe(false);

    const unavailable = voiceUnavailableAssistantResponse();
    expect(unavailable.assistant.recordingEnabled).toBe(false);
    expect(unavailable.assistant.videoRecordingEnabled).toBe(false);
  });

  test('call-creation paths reference the shared no-recording policy', () => {
    for (const rel of REQUIRED_RECORDING_PATHS) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).toMatch(/applyVapiNoRecordingFlags|buildWebCallVapiStartFields|vapi-recording-policy/);
      expect(src, rel).not.toMatch(/recordingEnabled:\s*true/);
    }
    const ingest = readFileSync(join(root, 'src/lib/voice/end-of-call-report.ts'), 'utf8');
    expect(ingest).toContain('Recording artifact present but recordings are disabled');
    expect(ingest).toContain('recording_url: null');
  });
});