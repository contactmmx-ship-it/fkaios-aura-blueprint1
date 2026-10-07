-- Applied in production as version 20260708162411 (fleet_memory_vector_index).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: ef0c79fb0fad4f178a393035936d8ea7).
-- Record only: do not apply from this folder.

create index if not exists fleet_memory_embedding_idx on public.fleet_memory using ivfflat (embedding vector_cosine_ops) with (lists = 10);
