import { checkFeatureEntitlement } from '@/lib/entitlements';
import { batchEmbedTexts } from '@/lib/embeddings';
import {
  formatPreviewMessage,
  formatStoredIngestMessage,
  netIncomingForAllowance,
  partitionAgainstExisting,
  prepareIncomingChunks,
  type HashedChunk,
} from '@/lib/knowledge/dedupe-chunks';

const HASH_LOOKUP_BATCH = 400;

export interface DedupeIngestArgs {
  dbClient: any;
  tenantId: string;
  chatbotId: string;
  chunks: string[];
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
  dryRun?: boolean;
  /** STYL-186: replace rows for this sourceUrl before the duplicate lookup. */
  replaceExistingSource?: boolean;
  /** Quoted label for the customer message, for example `"Price list"`. */
  sourceLabel?: string;
  embedTexts?: (texts: string[]) => Promise<number[][]>;
}

export interface DedupeIngestBody {
  success: true;
  dryRun?: boolean;
  chunksCount: number;
  insertedCount: number;
  skippedDuplicateCount: number;
  alreadyCoveredCount: number;
  wouldInsertCount?: number;
  message: string;
}

export type DedupeIngestOutcome =
  | { ok: true; status: 200; body: DedupeIngestBody }
  | { ok: false; status: number; body: { error: string } };

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '23505') return true;
  return /duplicate key|unique constraint|content_hash/i.test(error.message || '');
}

/**
 * Hashes that already exist for this chatbot, optionally ignoring rows that
 * belong to the source we are about to replace. Ignoring that source lets a
 * re-crawl reclaim text that lived only on that URL, while copies on other
 * sources stay skipped. The delete itself runs only after the allowance check
 * and a successful embed, so a refused or failed ingest does not wipe the source.
 */
export async function findExistingContentHashes(
  dbClient: any,
  tenantId: string,
  chatbotId: string,
  hashes: string[],
  ignoreSourceUrl?: string | null,
): Promise<Set<string>> {
  const found = new Set<string>();
  if (hashes.length === 0) return found;

  for (let i = 0; i < hashes.length; i += HASH_LOOKUP_BATCH) {
    const slice = hashes.slice(i, i + HASH_LOOKUP_BATCH);
    const { data, error } = await dbClient.rpc('knowledge_existing_hashes', {
      p_tenant_id: tenantId,
      p_chatbot_id: chatbotId,
      p_hashes: slice,
      p_ignore_source_url: ignoreSourceUrl || null,
    });

    if (error) {
      throw new Error(`Failed to look up existing knowledge items: ${error.message}`);
    }

    for (const row of data || []) {
      if (row?.content_hash) found.add(row.content_hash);
    }
  }

  return found;
}

async function countSourceRows(
  dbClient: any,
  chatbotId: string,
  sourceUrl: string,
): Promise<number> {
  const { count } = await dbClient
    .from('document_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('chatbot_id', chatbotId)
    .eq('source_url', sourceUrl);

  return count || 0;
}

async function deleteSourceRows(
  dbClient: any,
  chatbotId: string,
  sourceUrl: string,
): Promise<void> {
  const { error } = await dbClient
    .from('document_chunks')
    .delete()
    .eq('chatbot_id', chatbotId)
    .eq('source_url', sourceUrl);

  if (error) {
    console.warn('[Ingest] Failed to replace existing knowledge items for this source:', error);
  }
}

async function insertSkippingConflicts(
  dbClient: any,
  records: Record<string, unknown>[],
): Promise<{ inserted: number; skippedRace: number; error: { code?: string; message?: string } | null }> {
  if (records.length === 0) return { inserted: 0, skippedRace: 0, error: null };

  const { error } = await dbClient.from('document_chunks').insert(records);
  if (!error) return { inserted: records.length, skippedRace: 0, error: null };
  if (!isUniqueViolation(error)) return { inserted: 0, skippedRace: 0, error };

  let inserted = 0;
  let skippedRace = 0;
  for (const record of records) {
    const { error: rowError } = await dbClient.from('document_chunks').insert(record);
    if (!rowError) {
      inserted += 1;
      continue;
    }
    if (isUniqueViolation(rowError)) {
      skippedRace += 1;
      continue;
    }
    return { inserted, skippedRace, error: rowError };
  }

  return { inserted, skippedRace, error: null };
}

function successBody(args: {
  dryRun: boolean;
  insertedCount: number;
  skippedCount: number;
  wouldInsertCount?: number;
  sourceLabel?: string;
}): DedupeIngestBody {
  const alreadyCoveredCount = args.skippedCount;
  if (args.dryRun) {
    const wouldInsertCount = args.wouldInsertCount ?? 0;
    return {
      success: true,
      dryRun: true,
      wouldInsertCount,
      chunksCount: 0,
      insertedCount: 0,
      skippedDuplicateCount: alreadyCoveredCount,
      alreadyCoveredCount,
      message: formatPreviewMessage(wouldInsertCount, alreadyCoveredCount),
    };
  }

  return {
    success: true,
    chunksCount: args.insertedCount,
    insertedCount: args.insertedCount,
    skippedDuplicateCount: alreadyCoveredCount,
    alreadyCoveredCount,
    message: formatStoredIngestMessage(args.insertedCount, alreadyCoveredCount, args.sourceLabel),
  };
}

export async function dedupedIngest(args: DedupeIngestArgs): Promise<DedupeIngestOutcome> {
  const dryRun = args.dryRun === true;
  const replace = args.replaceExistingSource === true && !!args.sourceUrl;
  const prepared = prepareIncomingChunks(args.chunks);

  if (prepared.length === 0) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Text splitting generated zero knowledge items' },
    };
  }

  let rowsReplaced = 0;
  if (replace && args.sourceUrl) {
    rowsReplaced = await countSourceRows(args.dbClient, args.chatbotId, args.sourceUrl);
  }

  let existingHashes: Set<string>;
  try {
    existingHashes = await findExistingContentHashes(
      args.dbClient,
      args.tenantId,
      args.chatbotId,
      prepared.map((chunk) => chunk.contentHash),
      replace ? args.sourceUrl : null,
    );
  } catch (err: any) {
    return { ok: false, status: 500, body: { error: err.message || 'Failed to look up existing knowledge items' } };
  }

  const { toInsert, skippedDuplicates } = partitionAgainstExisting(prepared, existingHashes);

  if (dryRun) {
    return {
      ok: true,
      status: 200,
      body: successBody({
        dryRun: true,
        insertedCount: 0,
        skippedCount: skippedDuplicates.length,
        wouldInsertCount: toInsert.length,
        sourceLabel: args.sourceLabel,
      }),
    };
  }

  const entitlement = await checkFeatureEntitlement(
    args.dbClient,
    args.tenantId,
    'knowledge_data_chunks',
    netIncomingForAllowance(toInsert.length, replace ? rowsReplaced : 0),
  );

  if (!entitlement.allowed) {
    return { ok: false, status: 403, body: { error: entitlement.error || 'Knowledge items limit reached.' } };
  }

  let embedded: number[][] = [];
  if (toInsert.length > 0) {
    const embedTexts = args.embedTexts || batchEmbedTexts;
    try {
      embedded = await embedTexts(toInsert.map((chunk) => chunk.content));
    } catch (err: any) {
      return {
        ok: false,
        status: 502,
        body: { error: err.message || 'Failed to generate embeddings for the knowledge items' },
      };
    }

    if (!embedded || embedded.length === 0) {
      return {
        ok: false,
        status: 502,
        body: { error: 'Failed to generate embeddings for the knowledge items' },
      };
    }
  }

  if (replace && rowsReplaced > 0 && args.sourceUrl) {
    await deleteSourceRows(args.dbClient, args.chatbotId, args.sourceUrl);
  }

  const records = toInsert.slice(0, embedded.length).map((chunk: HashedChunk, index) => ({
    tenant_id: args.tenantId,
    chatbot_id: args.chatbotId,
    content: chunk.content,
    content_hash: chunk.contentHash,
    embedding: embedded[index],
    source_url: args.sourceUrl,
    metadata: args.metadata,
  }));

  const inserted = await insertSkippingConflicts(args.dbClient, records);
  if (inserted.error) {
    return {
      ok: false,
      status: 500,
      body: { error: `Failed to save knowledge items to database: ${inserted.error.message}` },
    };
  }

  const skippedCount = skippedDuplicates.length + inserted.skippedRace;
  return {
    ok: true,
    status: 200,
    body: successBody({
      dryRun: false,
      insertedCount: inserted.inserted,
      skippedCount,
      sourceLabel: args.sourceLabel,
    }),
  };
}
