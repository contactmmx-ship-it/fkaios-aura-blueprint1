-- Applied in production as version 20260727092543 (company_invoices_source_job_id).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 89cda014b9e99e05cf81c5d02181e9fd).
-- Record only: do not apply from this folder.

ALTER TABLE public.company_invoices
  ADD COLUMN IF NOT EXISTS source_job_id uuid REFERENCES public.ai_jobs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS company_invoices_source_job_id_uniq
  ON public.company_invoices (source_job_id)
  WHERE source_job_id IS NOT NULL;
