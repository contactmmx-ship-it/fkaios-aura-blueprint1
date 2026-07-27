-- ai_jobs_status_check never allowed 'retry' as a value, even though
-- runJobs()'s catch block (ai-engine/index.ts) has always computed
-- status:'retry' on a job's first two failures, and job-scheduler's
-- retry_failed action already queries .in("status", ["failed", "retry"])
-- expecting it to be reachable. The mismatch meant that update silently
-- violated the CHECK constraint and did nothing — discovered via a real
-- GENERATE_INVOICE test job that stayed stuck in status='running' forever
-- despite its own execution_log failure row proving the catch block ran.
-- Purely additive: widens the allowed value set, touches no existing rows,
-- matches behavior the code and job-scheduler already assumed.

ALTER TABLE public.ai_jobs DROP CONSTRAINT ai_jobs_status_check;
ALTER TABLE public.ai_jobs ADD CONSTRAINT ai_jobs_status_check
  CHECK (status = ANY (ARRAY['pending', 'running', 'completed', 'failed', 'retry']));
