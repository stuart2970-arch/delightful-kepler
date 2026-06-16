-- PostgreSQL RPC function to match documents based on vector similarity
-- This function is restricted by tenant and chatbot to prevent cross-contamination.

CREATE OR REPLACE FUNCTION public.match_documents (
  query_embedding vector(1536),
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
