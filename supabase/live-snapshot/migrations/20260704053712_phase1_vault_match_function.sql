-- Applied in production as version 20260704053712 (phase1_vault_match_function).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 786694126213b1784ccef9fa4cf59363).
-- Record only: do not apply from this folder.

-- Chunks table uses `text` column and has its own brand_id — corrected
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON brain_knowledge_chunks USING hnsw (embedding vector_cosine_ops);

DROP FUNCTION IF EXISTS match_knowledge_chunks(vector, integer, uuid);
CREATE FUNCTION match_knowledge_chunks(
  query_embedding vector(384),
  match_count int DEFAULT 5,
  filter_brand_id uuid DEFAULT NULL
) RETURNS TABLE (id uuid, document_id uuid, chunk_text text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.document_id, c.text AS chunk_text,
         1 - (c.embedding <=> query_embedding) AS similarity
  FROM brain_knowledge_chunks c
  WHERE c.embedding IS NOT NULL
    AND (filter_brand_id IS NULL OR c.brand_id = filter_brand_id)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
