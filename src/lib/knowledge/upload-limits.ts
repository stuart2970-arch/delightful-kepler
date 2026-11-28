export const MAX_KNOWLEDGE_FILE_BYTES = 20 * 1024 * 1024;

export const KNOWLEDGE_FILE_TOO_LARGE_MESSAGE =
  'This file is too large. Knowledge uploads are limited to 20 MB — please use a smaller file or paste the text instead.';

export const isKnowledgeFileTooLarge = (byteLength: number): boolean =>
  Number.isFinite(byteLength) && byteLength > MAX_KNOWLEDGE_FILE_BYTES;