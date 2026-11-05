-- STYL-189: exact-hash dedupe of knowledge items.
-- Idempotent. Apply on local and staging only. Do not apply to live
-- Supabase project tkoasyjvrgaglofpzduq without a separate yes.
--
-- Normalisation matches src/lib/knowledge/normalize-for-hash.ts for text that
-- has already been through sanitizeForPostgres: NFC, lowercase, collapse
-- whitespace, trim. SHA-256 hex. Uniqueness is (tenant_id, chatbot_id, content_hash).

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.knowledge_content_hash(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  cleaned text;
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;

  -- PostgreSQL text cannot store NUL, so there is nothing to strip here.
  cleaned := raw;
  cleaned := normalize(cleaned, NFC);
  -- Control characters (except tab, LF, CR) become spaces, matching sanitizeForPostgres.
  cleaned := regexp_replace(cleaned, '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', ' ', 'g');
  cleaned := lower(cleaned);
  cleaned := regexp_replace(cleaned, '\s+', ' ', 'g');
  cleaned := trim(cleaned);

  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  RETURN encode(digest(convert_to(cleaned, 'UTF8'), 'sha256'), 'hex');
END;
$$;

COMMENT ON FUNCTION public.knowledge_content_hash(text) IS
  'SHA-256 hex of normalised knowledge text (STYL-189). Empty text returns NULL.';

REVOKE ALL ON FUNCTION public.knowledge_content_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.knowledge_content_hash(text) TO service_role;

ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS content_hash text;

COMMENT ON COLUMN public.document_chunks.content_hash IS
  'SHA-256 hex of normalizeForHash(content); uniqueness scoped to tenant_id + chatbot_id (STYL-189).';

-- Backfill environments that run this migration (local and staging). Same
-- function the tests compare with the TypeScript helper.
UPDATE public.document_chunks
SET content_hash = public.knowledge_content_hash(content)
WHERE content_hash IS NULL
  AND content IS NOT NULL;

-- Keep the oldest row per tenant + chatbot + hash so the unique index can be created.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, chatbot_id, content_hash
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS rn
  FROM public.document_chunks
  WHERE content_hash IS NOT NULL
)
DELETE FROM public.document_chunks d
USING ranked r
WHERE d.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS document_chunks_tenant_chatbot_content_hash_uidx
  ON public.document_chunks (tenant_id, chatbot_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- POST lookup so a large file does not build a GET URL that Kong rejects.
CREATE OR REPLACE FUNCTION public.knowledge_existing_hashes(
  p_tenant_id uuid,
  p_chatbot_id uuid,
  p_hashes text[],
  p_ignore_source_url text DEFAULT NULL
)
RETURNS TABLE (content_hash text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT d.content_hash
  FROM public.document_chunks d
  WHERE d.tenant_id = p_tenant_id
    AND d.chatbot_id = p_chatbot_id
    AND d.content_hash = ANY(p_hashes)
    AND (
      p_ignore_source_url IS NULL
      OR d.source_url IS DISTINCT FROM p_ignore_source_url
    );
$$;

COMMENT ON FUNCTION public.knowledge_existing_hashes(uuid, uuid, text[], text) IS
  'Hashes already stored for a chatbot, optionally ignoring one source URL (STYL-189).';

REVOKE ALL ON FUNCTION public.knowledge_existing_hashes(uuid, uuid, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.knowledge_existing_hashes(uuid, uuid, text[], text) TO service_role;
