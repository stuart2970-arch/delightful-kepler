import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test.describe('STYL-226: voice completion logs are ids only', () => {
  test('custom LLM routes do not log caller content or PII', () => {
    const chatbot = readFileSync(join(root, 'src/app/api/voice/[chatbotId]/chat/completions/route.ts'), 'utf8');
    const legacy = readFileSync(join(root, 'src/app/api/voice/chat/completions/route.ts'), 'utf8');
    expect(chatbot).not.toContain('Ignoring echoed assistant greeting turn:');
    expect(chatbot).toContain("console.log('[Vapi Custom LLM] Ignoring echoed assistant greeting turn', { chatbotId })");
    expect(legacy).not.toContain('Executing bookMeeting for ${custName}');
    expect(legacy).toContain("console.log('[Vapi Custom LLM Legacy] Executing bookMeeting', { tenantId, staffId, serviceId })");
    expect(chatbot).toContain('voiceLogError');
    expect(legacy).toContain('voiceLogError');
    expect(chatbot).not.toMatch(/console\.error\('[^']+', (preConvErr|e|toolErr|pass2Err|dbErr|err|logErr|error)\)/);
    expect(legacy).not.toMatch(/console\.error\('[^']+', (preConvErr|e|dbErr|err|error)\)/);
  });
});
