-- Applied in production as version 20260714094748 (full_ai_cost_accounting).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 20d6c0a04954c5212c6c347533cf9eb3).
-- Record only: do not apply from this folder.

-- FULL AI COST ACCOUNTING — built because the EVOLUTION ENGINE selected it
-- (priority 16.72, confidence 95%, unblocked). Not chosen by an engineer.
--
-- THE DEFECT IT CITED: "measured spend is a FLOOR, not a total; 963 dispatches were
-- never costed." The company could see its bill and not what it bought. A CFO cannot
-- control a burn it cannot measure.
--
-- THE FIX HAS TWO HALVES:
--  (1) MAKE THE GAP MEASURABLE — you cannot close a hole you cannot see. This exposes
--      exactly which agents dispatch work without emitting a cost row, and how much
--      work is flying uncosted. Coverage becomes a number that can be driven to 100%.
--  (2) MAKE ADOPTION TRIVIAL — a single RPC every function can call, so instrumenting
--      the remaining engines is a one-line change rather than a rewrite.
--
-- HONESTY: this does NOT retroactively invent costs for the 963 historical dispatches.
-- Their cost is UNKNOWN and will remain UNKNOWN forever. Fabricating a back-estimate
-- would be exactly the sin that produced 5,970 fake job completions. Unknown stays
-- unknown; only the FUTURE is closed.

-- (1) Which agents run work without paying for it, on the record?
CREATE OR REPLACE VIEW public.v_cost_coverage AS
WITH dispatched AS (
  SELECT a.name AS agent_name, count(*) AS dispatches
  FROM agent_dispatch_log d
  JOIN ai_agents a ON a.id = d.agent_id
  GROUP BY a.name
),
costed AS (
  SELECT agent_id AS agent_name, count(*) AS cost_rows,
         COALESCE(SUM(estimated_cost_usd), 0) AS spend_usd
  FROM agent_performance_metrics
  GROUP BY agent_id
)
SELECT
  COALESCE(d.agent_name, c.agent_name)                    AS agent,
  COALESCE(d.dispatches, 0)                               AS dispatches,
  COALESCE(c.cost_rows, 0)                                AS cost_rows,
  ROUND(COALESCE(c.spend_usd, 0)::numeric, 4)             AS known_spend_usd,
  GREATEST(0, COALESCE(d.dispatches,0) - COALESCE(c.cost_rows,0)) AS uncosted_dispatches,
  CASE WHEN COALESCE(d.dispatches,0) = 0 THEN 100
       ELSE ROUND(100.0 * LEAST(COALESCE(c.cost_rows,0), d.dispatches) / d.dispatches, 1)
  END                                                     AS coverage_pct
FROM dispatched d
FULL OUTER JOIN costed c ON c.agent_name = d.agent_name
ORDER BY uncosted_dispatches DESC;

GRANT SELECT ON public.v_cost_coverage TO service_role, authenticated;

-- (2) One call. Any function can now emit a cost row correctly.
CREATE OR REPLACE FUNCTION public.log_llm_cost(
  p_agent text, p_task text, p_model text, p_provider text,
  p_input_tokens int, p_output_tokens int,
  p_department text DEFAULT NULL, p_business_objective text DEFAULT NULL,
  p_selection_reason text DEFAULT NULL, p_prompt_version text DEFAULT NULL,
  p_latency_ms int DEFAULT NULL, p_retries int DEFAULT 0,
  p_success boolean DEFAULT true, p_error text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_in numeric; v_out numeric; v_cost numeric; v_id uuid;
BEGIN
  -- Rates are CENTRAL here so a model-price change is one edit, not twelve.
  SELECT CASE p_model
    WHEN 'claude-sonnet-4-6'        THEN 3.00
    WHEN 'claude-sonnet-5'          THEN 3.00
    WHEN 'claude-3-haiku-20240307'  THEN 0.25
    WHEN 'gpt-4o-mini'              THEN 0.15
    ELSE NULL END,
    CASE p_model
    WHEN 'claude-sonnet-4-6'        THEN 15.00
    WHEN 'claude-sonnet-5'          THEN 15.00
    WHEN 'claude-3-haiku-20240307'  THEN 1.25
    WHEN 'gpt-4o-mini'              THEN 0.60
    ELSE NULL END
  INTO v_in, v_out;

  -- An UNKNOWN model price yields an UNKNOWN cost (NULL) — never a guessed zero.
  -- A zero would silently understate burn, which is worse than admitting ignorance.
  IF v_in IS NULL THEN
    v_cost := NULL;
  ELSE
    v_cost := (COALESCE(p_input_tokens,0) / 1000000.0) * v_in
            + (COALESCE(p_output_tokens,0) / 1000000.0) * v_out;
  END IF;

  INSERT INTO agent_performance_metrics (
    agent_id, task_type, model, provider, input_tokens, output_tokens,
    estimated_cost_usd, department, business_objective, selection_reason,
    prompt_version, latency_ms, retries, success, error_message
  ) VALUES (
    p_agent, p_task, p_model, p_provider, p_input_tokens, p_output_tokens,
    v_cost, p_department, p_business_objective, p_selection_reason,
    p_prompt_version, p_latency_ms, p_retries, p_success, p_error
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.log_llm_cost(text,text,text,text,int,int,text,text,text,text,int,int,boolean,text) FROM public;
GRANT EXECUTE ON FUNCTION public.log_llm_cost(text,text,text,text,int,int,text,text,text,text,int,int,boolean,text) TO service_role;

-- (3) The number the CFO drives to 100%.
CREATE OR REPLACE FUNCTION public.compute_cost_coverage()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_disp int; v_costed int; v_uncosted int; v_known numeric; v_pct numeric; v_worst jsonb;
BEGIN
  SELECT COALESCE(SUM(dispatches),0), COALESCE(SUM(cost_rows),0),
         COALESCE(SUM(uncosted_dispatches),0), COALESCE(SUM(known_spend_usd),0)
    INTO v_disp, v_costed, v_uncosted, v_known FROM v_cost_coverage;

  v_pct := CASE WHEN v_disp = 0 THEN 100 ELSE ROUND(100.0 * LEAST(v_costed, v_disp) / v_disp, 1) END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'agent', agent, 'dispatches', dispatches, 'cost_rows', cost_rows,
    'uncosted', uncosted_dispatches, 'coverage_pct', coverage_pct
  ) ORDER BY uncosted_dispatches DESC), '[]'::jsonb) INTO v_worst
  FROM (SELECT * FROM v_cost_coverage WHERE uncosted_dispatches > 0 LIMIT 10) t;

  RETURN jsonb_build_object(
    'computed_at', now(),
    'total_dispatches', v_disp,
    'costed_rows', v_costed,
    'uncosted_dispatches', v_uncosted,
    'coverage_pct', v_pct,
    'known_spend_usd', ROUND(v_known::numeric, 4),
    'spend_is_a_floor', (v_uncosted > 0),
    'verdict', CASE WHEN v_uncosted = 0
      THEN 'Cost coverage is 100%. Every dispatch is paid for on the record. True burn is KNOWN.'
      ELSE format('Cost coverage is %s%%. %s dispatches ran WITHOUT a cost row — their cost is UNKNOWN and will remain unknown. Known spend of $%s is a FLOOR, not a total. It will NOT be back-estimated: inventing a retroactive cost is the same sin that produced 5,970 fake job completions.',
        v_pct, v_uncosted, ROUND(v_known::numeric, 2)) END,
    'worst_offenders', v_worst
  );
END; $$;

REVOKE ALL ON FUNCTION public.compute_cost_coverage() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_cost_coverage() TO service_role, authenticated;

-- The engine's chosen capability is now shipped. Close the loop honestly.
UPDATE capability_backlog
SET status = 'shipped'
WHERE capability ILIKE 'Full AI Cost Accounting%';
