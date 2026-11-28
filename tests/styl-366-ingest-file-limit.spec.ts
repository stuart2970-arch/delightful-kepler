import { test, expect } from '@playwright/test';
import {
  isKnowledgeFileTooLarge,
  MAX_KNOWLEDGE_FILE_BYTES,
  KNOWLEDGE_FILE_TOO_LARGE_MESSAGE,
} from '../src/lib/knowledge/upload-limits';

test.describe('STYL-366 knowledge file upload 20MB limit', () => {
  test('upload limit helper rejects payloads above 20MB', () => {
    expect(MAX_KNOWLEDGE_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(isKnowledgeFileTooLarge(MAX_KNOWLEDGE_FILE_BYTES)).toBe(false);
    expect(isKnowledgeFileTooLarge(MAX_KNOWLEDGE_FILE_BYTES + 1)).toBe(true);
    expect(KNOWLEDGE_FILE_TOO_LARGE_MESSAGE).toMatch(/20\s?MB/i);
  });
});