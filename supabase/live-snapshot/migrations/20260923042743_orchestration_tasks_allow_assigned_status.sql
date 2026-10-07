-- Applied in production as version 20260923042743 (orchestration_tasks_allow_assigned_status).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 97fb500c99090c7806fd5f4dda1f8cff).
-- Record only: do not apply from this folder.

ALTER TABLE public.orchestration_tasks DROP CONSTRAINT orchestration_tasks_status_check;
ALTER TABLE public.orchestration_tasks ADD CONSTRAINT orchestration_tasks_status_check
  CHECK (status = ANY (ARRAY['pending', 'assigned', 'done', 'rework', 'approved']));
