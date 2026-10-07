-- Applied in production as version 20260713002623 (llm_execution_traceability_columns).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 20805d9f7b3875485188102c09a8657e).
-- Record only: do not apply from this folder.

-- LLM EXECUTION GRAPH — foundation (Autonomous Enterprise Operating Model).
-- The model demands: for every execution, show which LLM was selected, why,
-- the prompt version, and the retry count. agent_performance_metrics recorded
-- NONE of these — cost was tracked, attribution was not. You could see that the
-- enterprise spent money; you could not see what it spent it ON.
--
-- Columns are NULLABLE and are NOT backfilled. Every historical row predates
-- this capability, and I will not stamp 'claude-sonnet-5' onto 88 rows I cannot
-- prove — that would be fabricating an audit trail, which is worse than an
-- honest gap. NULL here means "we did not record it", and it will say so.
ALTER TABLE public.agent_performance_metrics
  ADD COLUMN IF NOT EXISTS model           text,
  ADD COLUMN IF NOT EXISTS provider        text,
  ADD COLUMN IF NOT EXISTS selection_reason text,
  ADD COLUMN IF NOT EXISTS prompt_version  text,
  ADD COLUMN IF NOT EXISTS retries         integer;

COMMENT ON COLUMN public.agent_performance_metrics.model IS
  'LLM used for this execution. NULL = not recorded (pre-dates traceability); never inferred.';
COMMENT ON COLUMN public.agent_performance_metrics.selection_reason IS
  'Why this model was chosen for this task. NULL = not recorded.';

CREATE INDEX IF NOT EXISTS idx_apm_model ON public.agent_performance_metrics (model);
