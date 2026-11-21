import { test, expect } from '@playwright/test';
import {
  CHAT_CONVERSATION_IDLE_MS,
  CHAT_FAIR_USE_ASSISTANT_REPLIES,
  assistantReplyCountAtFairUseLimit,
  conversationAllowanceWouldExceed,
  isConversationIdle,
  shouldStartNewConversationSession,
} from '../../src/lib/chat/conversation-metering';
import { chatConversationSectorTag } from '../../src/lib/billing/credit-grant-keys';

test.describe('STYL-310 conversation metering helpers', () => {
  test('starts a new conversation only after 30 minutes idle', () => {
    const now = Date.parse('2026-11-21T12:00:00.000Z');
    const recent = '2026-11-21T11:45:00.000Z';
    const stale = '2026-11-21T11:00:00.000Z';

    expect(isConversationIdle(recent, now)).toBe(false);
    expect(shouldStartNewConversationSession(recent, now)).toBe(false);
    expect(isConversationIdle(stale, now)).toBe(true);
    expect(shouldStartNewConversationSession(stale, now)).toBe(true);
    expect(CHAT_CONVERSATION_IDLE_MS).toBe(30 * 60 * 1000);
  });

  test('continues within the idle window', () => {
    const now = Date.now();
    const insideWindow = new Date(now - CHAT_CONVERSATION_IDLE_MS + 5_000).toISOString();
    expect(shouldStartNewConversationSession(insideWindow, now)).toBe(false);
  });

  test('fair-use boundary at 30 assistant replies', () => {
    expect(assistantReplyCountAtFairUseLimit(CHAT_FAIR_USE_ASSISTANT_REPLIES - 1)).toBe(false);
    expect(assistantReplyCountAtFairUseLimit(CHAT_FAIR_USE_ASSISTANT_REPLIES)).toBe(true);
    expect(CHAT_FAIR_USE_ASSISTANT_REPLIES).toBe(30);
  });

  test('sector tags identify one billable conversation', () => {
    const conversationId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(chatConversationSectorTag(conversationId)).toBe(`chat_conversation:${conversationId}`);
  });

  test('allowance boundary blocks another conversation unit at the limit', () => {
    expect(conversationAllowanceWouldExceed(1499, 1500, 1)).toBe(false);
    expect(conversationAllowanceWouldExceed(1500, 1500, 1)).toBe(true);
    expect(conversationAllowanceWouldExceed(500, null, 1)).toBe(false);
  });
});