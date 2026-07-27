-- Idempotency key for GENERATE_INVOICE job-pipeline persistence
-- (writeInvoicePersistence() in ai-engine). A unique-violation on insert
-- means this exact ai_jobs.id already created its invoice on a prior
-- attempt — the existing row is fetched and returned instead of duplicating.

ALTER TABLE public.company_invoices
  ADD COLUMN IF NOT EXISTS source_job_id uuid REFERENCES public.ai_jobs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS company_invoices_source_job_id_uniq
  ON public.company_invoices (source_job_id)
  WHERE source_job_id IS NOT NULL;
