-- Applied in production as version 20260704054216 (phase1_fix_embedding_dims_384).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: b0c87e60d333d7c8224ba07c0589b50d).
-- Record only: do not apply from this folder.

ALTER TABLE brain_knowledge_chunks DROP COLUMN embedding CASCADE;
ALTER TABLE brain_knowledge_chunks ADD COLUMN embedding vector(384);
CREATE INDEX idx_chunks_embedding ON brain_knowledge_chunks USING hnsw (embedding vector_cosine_ops);
