import { sanitizeForPostgres } from '@/lib/file-parser';
import { hashNormalizedContent, normalizeForHash } from '@/lib/knowledge/normalize-for-hash';

export interface HashedChunk {
  content: string;
  contentHash: string;
}

/**
 * Drop empty normalised text and keep one copy of each hash in this batch.
 * Stored content keeps original casing; only the hash is case-folded.
 */
export function prepareIncomingChunks(chunks: string[]): HashedChunk[] {
  const seen = new Set<string>();
  const prepared: HashedChunk[] = [];

  for (const chunk of chunks) {
    const content = sanitizeForPostgres(chunk);
    if (!normalizeForHash(content)) continue;
    const contentHash = hashNormalizedContent(content);
    if (!contentHash || seen.has(contentHash)) continue;
    seen.add(contentHash);
    prepared.push({ content, contentHash });
  }

  return prepared;
}

export function partitionAgainstExisting(
  incoming: HashedChunk[],
  existingHashes: Iterable<string>,
): { toInsert: HashedChunk[]; skippedDuplicates: HashedChunk[] } {
  const existing = existingHashes instanceof Set ? existingHashes : new Set(existingHashes);
  const toInsert: HashedChunk[] = [];
  const skippedDuplicates: HashedChunk[] = [];

  for (const chunk of incoming) {
    if (existing.has(chunk.contentHash)) skippedDuplicates.push(chunk);
    else toInsert.push(chunk);
  }

  return { toInsert, skippedDuplicates };
}

/**
 * Rows that will be deleted for a same-source replace free allowance.
 * Only the chunks we will actually insert count as new usage.
 */
export function netIncomingForAllowance(toInsertCount: number, rowsReplaced: number): number {
  return Math.max(0, toInsertCount - Math.max(0, rowsReplaced));
}

function knowledgeItemLabel(count: number): string {
  return count === 1 ? 'knowledge item' : 'knowledge items';
}

export function formatPreviewMessage(wouldInsertCount: number, alreadyCoveredCount: number): string {
  return `${wouldInsertCount} new ${knowledgeItemLabel(wouldInsertCount)}, ${alreadyCoveredCount} already covered (not charged).`;
}

export function formatStoredIngestMessage(
  insertedCount: number,
  skippedCount: number,
  sourceLabel?: string,
): string {
  const source = sourceLabel ? ` from ${sourceLabel}` : '';
  if (skippedCount > 0) {
    return `Ingested ${insertedCount} new ${knowledgeItemLabel(insertedCount)}${source} (${skippedCount} already covered, not counted).`;
  }
  return `Successfully ingested ${insertedCount} ${knowledgeItemLabel(insertedCount)}${source}.`;
}
