-- Applied in production as version 20260727101506 (ai_jobs_allow_retry_status).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 02a0097cc2594870df815299003ce038).
-- Record only: do not apply from this folder.

ALTER TABLE public.ai_jobs DROP CONSTRAINT ai_jobs_status_check;
ALTER TABLE public.ai_jobs ADD CONSTRAINT ai_jobs_status_check
  CHECK (status = ANY (ARRAY['pending', 'running', 'completed', 'failed', 'retry']));
