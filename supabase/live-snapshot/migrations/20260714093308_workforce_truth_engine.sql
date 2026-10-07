-- Applied in production as version 20260714093308 (workforce_truth_engine).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 76d62b090205741909b12ff6b075bf44).
-- Record only: do not apply from this folder.

-- EXECUTIVE KPI & EMPLOYEE OPERATING SYSTEM (Executive Office engine).
--
-- THE PROBLEM: 41 AI employees sit on the roster. FOUR have ever produced output.
-- The org chart is mostly nameplates and nothing in the product admits it. An
-- enterprise that cannot see which of its employees do nothing cannot govern them —
-- and a Founder reading "41 AI employees" is reading a vanity metric.
--
-- This grades every employee against REAL evidence: lifetime output, 24h output,
-- LLM spend, last activity. Verdicts are deliberately harsh and honest:
--   PRODUCING  — did real work in the last 24h
--   DORMANT    — has produced before, but nothing in 24h
--   NAMEPLATE  — has NEVER completed a single task in its existence
--   BURNING    — costs money and has never produced output (the worst class)
-- No agent is flattered. An honest NAMEPLATE count is worth more than 41.
CREATE OR REPLACE FUNCTION public.compute_workforce_truth()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total int; v_producing int; v_nameplate int; v_burning int; v_dormant int;
        v_agents jsonb; v_spend numeric;
BEGIN
  WITH out24 AS (
    SELECT d.agent_id, count(*) AS jobs_24h
    FROM agent_dispatch_log d
    WHERE d.created_at > now() - interval '24 hours'
      AND d.status IN ('completed','success')
    GROUP BY d.agent_id
  ),
  spend AS (
    -- agent_performance_metrics keys on agent NAME (text), ai_agents on uuid.
    SELECT m.agent_id AS agent_name, COALESCE(SUM(m.estimated_cost_usd),0) AS usd,
           count(*) AS llm_calls, count(*) FILTER (WHERE NOT m.success) AS llm_failures
    FROM agent_performance_metrics m GROUP BY m.agent_id
  ),
  graded AS (
    SELECT
      a.id, a.name,
      COALESCE(a.department, a.dept, 'UNASSIGNED') AS department,
      COALESCE(a.total_tasks_completed, 0) AS lifetime_tasks,
      COALESCE(o.jobs_24h, 0)              AS output_24h,
      COALESCE(s.usd, 0)                   AS spend_usd,
      COALESCE(s.llm_calls, 0)             AS llm_calls,
      COALESCE(s.llm_failures, 0)          AS llm_failures,
      a.last_active_at,
      CASE
        WHEN COALESCE(o.jobs_24h,0) > 0 THEN 'PRODUCING'
        WHEN COALESCE(a.total_tasks_completed,0) = 0 AND COALESCE(s.usd,0) > 0 THEN 'BURNING'
        WHEN COALESCE(a.total_tasks_completed,0) = 0 THEN 'NAMEPLATE'
        ELSE 'DORMANT'
      END AS verdict
    FROM ai_agents a
    LEFT JOIN out24 o ON o.agent_id = a.id
    LEFT JOIN spend s ON s.agent_name = a.name
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE verdict = 'PRODUCING'),
    count(*) FILTER (WHERE verdict = 'NAMEPLATE'),
    count(*) FILTER (WHERE verdict = 'BURNING'),
    count(*) FILTER (WHERE verdict = 'DORMANT'),
    COALESCE(SUM(spend_usd), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'name', name, 'department', department, 'verdict', verdict,
      'lifetime_tasks', lifetime_tasks, 'output_24h', output_24h,
      'spend_usd', ROUND(spend_usd::numeric, 4), 'llm_calls', llm_calls,
      'llm_failures', llm_failures, 'last_active_at', last_active_at)
      ORDER BY (verdict = 'BURNING') DESC, output_24h DESC, lifetime_tasks DESC), '[]'::jsonb)
  INTO v_total, v_producing, v_nameplate, v_burning, v_dormant, v_spend, v_agents
  FROM graded;

  RETURN jsonb_build_object(
    'computed_at', now(),
    'total_employees', v_total,
    'producing_24h', v_producing,
    'dormant', v_dormant,
    'nameplate', v_nameplate,
    'burning', v_burning,
    'total_llm_spend_usd', ROUND(v_spend::numeric, 4),
    'headline', format(
      '%s AI employees on the roster. %s produced work in the last 24h. %s have NEVER completed a single task. "%s employees" is a vanity metric until that gap closes.',
      v_total, v_producing, v_nameplate + v_burning, v_total),
    'burning_warning', CASE WHEN v_burning > 0 THEN format(
      '%s employee(s) have SPENT MONEY and produced NOTHING, ever. This is the worst class: cost without output.', v_burning) END,
    'employees', v_agents
  );
END; $$;

REVOKE ALL ON FUNCTION public.compute_workforce_truth() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_workforce_truth() TO service_role, authenticated;
