import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'path';
import { getAvailableDays, type CalculatedSlot } from '../src/lib/calendar/availability';

test.describe('STYL-271 widget, channel wording, QUICK_DAYS, lead email', () => {
  test('widget source does not pre-fill onboarding email from localStorage', () => {
    const root = path.resolve(__dirname, '..');
    for (const rel of ['src/widget/index.ts', 'src/widget/embed.ts']) {
      const src = readFileSync(path.join(root, rel), 'utf8');
      expect(src, rel).not.toMatch(/onboardingEmail\.value\s*=\s*storedEmail/);
    }
  });

  test('chat stream prompts reference this chat', () => {
    const routeSrc = readFileSync(
      path.resolve(__dirname, '../src/app/api/chat/stream/route.ts'),
      'utf8',
    );
    expect(routeSrc).toContain('in this chat');
    expect(routeSrc).toContain('MANAGE BOOKINGS IN THIS CHAT');
  });

  test('voice completion prompts reference this call', () => {
    const voiceSrc = readFileSync(
      path.resolve(__dirname, '../src/app/api/voice/[chatbotId]/chat/completions/route.ts'),
      'utf8',
    );
    expect(voiceSrc).toContain('on this call');
    expect(voiceSrc).toContain('throughout this call');
  });

  test('getAvailableDays never returns days with slotsCount 0', () => {
    const slot: CalculatedSlot = {
      staffId: 's1',
      staffName: 'Alex',
      date: '2026-12-01',
      displayDate: 'Tue 1 Dec',
      time: '09:00',
      start: '2026-12-01T09:00:00.000Z',
      end: '2026-12-01T09:30:00.000Z',
    };
    const days = getAvailableDays([slot, { ...slot, time: '10:00', start: '2026-12-01T10:00:00.000Z', end: '2026-12-01T10:30:00.000Z' }]);
    expect(days).toHaveLength(1);
    expect(days[0].slotsCount).toBe(2);
    expect(getAvailableDays([])).toEqual([]);
    expect(days.every((d) => d.slotsCount > 0)).toBe(true);
  });
});