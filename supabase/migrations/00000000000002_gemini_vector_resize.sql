-- Drop existing HNSW index
DROP INDEX IF EXISTS public.document_chunks_embedding_hnsw_idx;

-- Alter embedding column size from 1536 to 768 (standard Gemini text-embedding-004 size)
ALTER TABLE public.document_chunks 
  ALTER COLUMN embedding TYPE vector(768);

-- Recreate HNSW index on the resized vector column
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx 
ON public.document_chunks 
USING hnsw (embedding vector_cosine_ops);

-- Replace match_documents RPC to accept the 768-dimensional query embedding
CREATE OR REPLACE FUNCTION public.match_documents (
  query_embedding vector(768),
  match_threshold float,
  match_count integer,
  targeting_tenant_id uuid,
  targeting_chatbot_id uuid
)
RETURNS TABLE (
  id uuid,
  content text,
  source_url text,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.content,
    dc.source_url,
    (1 - (dc.embedding <=> query_embedding))::float AS similarity
  FROM public.document_chunks dc
  WHERE dc.tenant_id = targeting_tenant_id
    AND dc.chatbot_id = targeting_chatbot_id
    AND (1 - (dc.embedding <=> query_embedding)) > match_threshold
  ORDER BY dc.embedding <=> query_embedding ASC
  LIMIT match_count;
END;
$$;
