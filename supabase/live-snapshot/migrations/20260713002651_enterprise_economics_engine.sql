-- Applied in production as version 20260713002651 (enterprise_economics_engine).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 74743d9ebb554123dfd86a76621d6322).
-- Record only: do not apply from this folder.

-- ENTERPRISE ECONOMICS — "The Only Success Metric", made unavoidable.
-- The Operating Model gives the CEO a standing mandate to increase revenue and
-- reduce costs. FKAIOS could do neither, because it could not state what it
-- spends or what it earns in the same sentence. This does.
--
-- HONESTY REQUIREMENT baked into the output: only 3 of 41 agents write cost
-- rows at all (the Lead Qualifier has made 362 LLM dispatches and logged ZERO
-- cost). Therefore measured spend is a FLOOR, not a total, and this function
-- says so rather than presenting a confident number that is wrong-low.
CREATE OR REPLACE FUNCTION public.compute_enterprise_economics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spend numeric; v_revenue numeric; v_calls integer;
  v_agents_logging integer; v_agents_total integer;
  v_untracked_dispatches integer; v_by_agent jsonb;
  v_revenue_spend numeric; v_founder_spend numeric;
  v_model_unknown integer;
BEGIN
  SELECT COALESCE(SUM(estimated_cost_usd), 0), count(*), count(DISTINCT agent_id)
    INTO v_spend, v_calls, v_agents_logging FROM agent_performance_metrics;
  SELECT count(*) INTO v_agents_total FROM ai_agents;
  SELECT COALESCE(SUM(amount_received_inr), 0) INTO v_revenue FROM company_invoices;
  SELECT count(*) INTO v_model_unknown FROM agent_performance_metrics WHERE model IS NULL;

  -- LLM work that happened but was never costed: dispatches by agents that have
  -- never written a single cost row. This is the size of the blind spot.
  SELECT count(*) INTO v_untracked_dispatches
  FROM agent_dispatch_log d
  WHERE d.agent_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM agent_performance_metrics m
      JOIN ai_agents a ON a.id = d.agent_id
      WHERE m.agent_id = a.name OR m.agent_id = a.id::text
    );

  -- Spend that went to the Founder's own avatar vs spend that went to anything
  -- with a path to revenue. This ratio is the enterprise's honest self-portrait.
  SELECT COALESCE(SUM(estimated_cost_usd), 0) INTO v_founder_spend
    FROM agent_performance_metrics WHERE agent_id = 'founder-avatar';
  v_revenue_spend := v_spend - v_founder_spend;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'spend_usd')::numeric DESC), '[]'::jsonb) INTO v_by_agent
  FROM (
    SELECT jsonb_build_object(
      'agent', agent_id,
      'calls', count(*),
      'spend_usd', ROUND(COALESCE(SUM(estimated_cost_usd), 0)::numeric, 4),
      'failed', count(*) FILTER (WHERE NOT success)
    ) AS x
    FROM agent_performance_metrics GROUP BY agent_id
  ) t;

  RETURN jsonb_build_object(
    'computed_at', now(),
    'measured_spend_usd', ROUND(v_spend::numeric, 4),
    'revenue_inr', v_revenue,
    'llm_calls_costed', v_calls,
    'spend_on_founder_avatar_usd', ROUND(v_founder_spend::numeric, 4),
    'spend_on_revenue_work_usd', ROUND(v_revenue_spend::numeric, 4),
    'pct_spend_on_founder_avatar', CASE WHEN v_spend > 0
      THEN ROUND((v_founder_spend / v_spend) * 100, 1) ELSE 0 END,
    'agents_logging_cost', v_agents_logging,
    'agents_total', v_agents_total,
    'untracked_llm_dispatches', v_untracked_dispatches,
    'model_unknown_rows', v_model_unknown,
    'spend_is_a_floor', (v_untracked_dispatches > 0),
    'coverage_warning', CASE WHEN v_untracked_dispatches > 0 THEN format(
      'Measured spend is a FLOOR, not a total. Only %s of %s agents write cost rows; %s agent dispatches (incl. every Lead Qualifier LLM call) were never costed. True spend is HIGHER than $%s and is currently unknowable from this data.',
      v_agents_logging, v_agents_total, v_untracked_dispatches, ROUND(v_spend::numeric, 2)) END,
    'traceability_warning', CASE WHEN v_model_unknown > 0 THEN format(
      '%s of %s costed executions do not record WHICH model ran or why it was chosen. The LLM Execution Graph the Operating Model requires cannot be drawn for these. Columns now exist; rows were not backfilled because the model used cannot be proven retroactively.',
      v_model_unknown, v_calls) END,
    'verdict', CASE
      WHEN v_revenue > 0 THEN 'Enterprise is earning.'
      WHEN v_spend > 0 THEN format(
        'The enterprise has spent at least $%s on AI and earned Rs 0. %s%% of every measured dollar went to the Founder talking to his own avatar, not to work that could produce revenue.',
        ROUND(v_spend::numeric, 2),
        CASE WHEN v_spend > 0 THEN ROUND((v_founder_spend / v_spend) * 100, 1) ELSE 0 END)
      ELSE 'No spend and no revenue recorded.' END,
    'by_agent', v_by_agent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_enterprise_economics() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_enterprise_economics() TO service_role, authenticated;
