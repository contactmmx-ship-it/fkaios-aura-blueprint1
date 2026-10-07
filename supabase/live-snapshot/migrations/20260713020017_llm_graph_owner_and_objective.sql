-- Applied in production as version 20260713020017 (llm_graph_owner_and_objective).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 488bf4c231911d5c6c9860a3ff27cca3).
-- Record only: do not apply from this folder.

-- LLM EXECUTION GRAPH — completing the record the Constitution requires:
-- "selected model, provider, why selected, prompt version, cost, tokens, latency,
--  retry count, OWNER AI, DEPARTMENT, BUSINESS OBJECTIVE."
-- model/provider/selection_reason/prompt_version/retries already exist.
-- The last three did not: no LLM call could say which DEPARTMENT it served or
-- WHAT BUSINESS OBJECTIVE it was spending money toward. Cost without an objective
-- is untraceable spend — the CFO could see the bill but not what it bought.
ALTER TABLE public.agent_performance_metrics
  ADD COLUMN IF NOT EXISTS department        text,
  ADD COLUMN IF NOT EXISTS business_objective text;

COMMENT ON COLUMN public.agent_performance_metrics.business_objective IS
  'What this spend was FOR (e.g. "₹5 Cr gate: qualify inbound lead"). NULL = not recorded; never inferred.';

-- Cost per business objective — the CFO view that did not exist.
CREATE OR REPLACE VIEW public.v_llm_spend_by_objective AS
SELECT
  COALESCE(business_objective, '(not recorded)') AS business_objective,
  COALESCE(department, '(not recorded)')         AS department,
  COALESCE(model, '(not recorded)')              AS model,
  count(*)                                        AS calls,
  count(*) FILTER (WHERE NOT success)             AS failed,
  ROUND(COALESCE(SUM(estimated_cost_usd), 0)::numeric, 4) AS spend_usd
FROM public.agent_performance_metrics
GROUP BY 1, 2, 3
ORDER BY spend_usd DESC;

GRANT SELECT ON public.v_llm_spend_by_objective TO service_role, authenticated;
