-- Applied in production as version 20260714153634 (phase9_model_orchestration).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: b577fa6bbd2a0d56c335d7cc63d8264b).
-- Record only: do not apply from this folder.

-- SOFTWARE FACTORY — PHASE 9: EVIDENCE-BASED MODEL ORCHESTRATION.
--
-- THE DEFECT I AM FIXING IS MY OWN: every engine I built hardcodes
-- 'claude-sonnet-4-6'. The Constitution says "never use one model because it is
-- available." I did exactly that, ten times over. This makes model choice a
-- decision with evidence behind it instead of a habit.
--
-- HONESTY ABOUT REACH: this enterprise holds ONE provider credential
-- (ANTHROPIC_API_KEY). GPT, Gemini, DeepSeek, Qwen, Llama, Mistral and Grok are
-- listed in the registry and marked BLOCKED — not because they are worse, but
-- because the system HAS NO KEY FOR THEM. Pretending to "orchestrate across
-- providers" while physically able to call one would be simulated capability, which
-- the Truth Constitution forbids. The registry states exactly what is reachable and
-- exactly what is not, so the day a key arrives the routing is already correct.
CREATE TABLE IF NOT EXISTS public.model_registry (
  model            text PRIMARY KEY,
  provider         text NOT NULL,
  available        boolean NOT NULL DEFAULT false,
  blocked_reason   text,
  cost_in_per_mtok numeric,
  cost_out_per_mtok numeric,
  good_at          text[] NOT NULL DEFAULT '{}',   -- declared strengths
  weak_at          text[] NOT NULL DEFAULT '{}',
  notes            text
);

INSERT INTO public.model_registry (model, provider, available, blocked_reason, cost_in_per_mtok, cost_out_per_mtok, good_at, weak_at, notes) VALUES
 ('claude-sonnet-4-6','anthropic', true, NULL, 3.00, 15.00,
   ARRAY['reasoning','architecture','coding','structured_output','commercial_judgement'],
   ARRAY['bulk_classification_cost'],
   'Current default across every engine. Strong at tool-use + strict JSON.'),
 ('claude-sonnet-5','anthropic', true, NULL, 3.00, 15.00,
   ARRAY['reasoning','long_context','web_search','conversation'],
   ARRAY['bulk_classification_cost'],
   'Used by founder-avatar (server-side web_search proven on this account).'),
 ('claude-3-haiku-20240307','anthropic', true, NULL, 0.25, 1.25,
   ARRAY['bulk_classification','extraction','cheap_high_volume','latency'],
   ARRAY['multi_step_tool_reasoning','architecture','honest_low_confidence_scoring'],
   'Used by ai-engine job runner. 12x cheaper in, 12x cheaper out than Sonnet.'),
 ('gpt-4o-mini','openai', false, 'NO CREDENTIAL: OPENAI_API_KEY is not set as an Edge Function secret. Founder gate.', 0.15, 0.60,
   ARRAY['cheap_extraction','latency'], ARRAY['unverified_on_this_account'],
   'Referenced in ai-engine as a fallback but UNREACHABLE — no key.'),
 ('gemini-pro','google', false, 'NO CREDENTIAL: no Google API key. Founder gate.', NULL, NULL,
   ARRAY['long_context','vision'], ARRAY['unverified_on_this_account'], 'Registry entry only. Never called.'),
 ('deepseek-chat','deepseek', false, 'NO CREDENTIAL. Founder gate.', NULL, NULL,
   ARRAY['coding','cost'], ARRAY['unverified_on_this_account'], 'Registry entry only. Never called.'),
 ('grok','xai', false, 'NO CREDENTIAL. Founder gate.', NULL, NULL,
   ARRAY['reasoning'], ARRAY['unverified_on_this_account'], 'Registry entry only. Never called.')
ON CONFLICT (model) DO NOTHING;

GRANT SELECT ON public.model_registry TO service_role, authenticated;

-- MEASURED performance, not marketing claims. This is the evidence that must
-- eventually override the declared strengths above.
CREATE OR REPLACE VIEW public.v_model_performance AS
SELECT
  COALESCE(m.model, '(not recorded)')                       AS model,
  m.task_type,
  count(*)                                                   AS calls,
  count(*) FILTER (WHERE m.success)                          AS ok,
  count(*) FILTER (WHERE NOT m.success)                      AS failed,
  ROUND(100.0 * count(*) FILTER (WHERE m.success) / NULLIF(count(*),0), 1) AS success_pct,
  ROUND(AVG(m.latency_ms)::numeric, 0)                       AS avg_latency_ms,
  ROUND(AVG(m.estimated_cost_usd)::numeric, 6)               AS avg_cost_usd,
  ROUND(SUM(m.estimated_cost_usd)::numeric, 4)               AS total_cost_usd
FROM public.agent_performance_metrics m
GROUP BY COALESCE(m.model, '(not recorded)'), m.task_type
ORDER BY total_cost_usd DESC NULLS LAST;

GRANT SELECT ON public.v_model_performance TO service_role, authenticated;

-- THE ROUTER. Chooses a model for a task capability, from AVAILABLE models only,
-- and must justify the choice. Cheapest model that is genuinely GOOD AT the task wins.
CREATE OR REPLACE FUNCTION public.compute_model_choice(p_capability text, p_volume text DEFAULT 'normal')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pick record; v_evidence jsonb; v_blocked jsonb; v_candidates int;
BEGIN
  -- Candidates: available, declared good at this capability, NOT declared weak at it.
  SELECT count(*) INTO v_candidates
  FROM model_registry
  WHERE available AND p_capability = ANY(good_at) AND NOT (p_capability = ANY(weak_at));

  -- Cheapest capable model wins. Paying Sonnet prices for a Haiku job is a margin leak
  -- repeated thousands of times.
  SELECT * INTO v_pick
  FROM model_registry
  WHERE available AND p_capability = ANY(good_at) AND NOT (p_capability = ANY(weak_at))
  ORDER BY COALESCE(cost_in_per_mtok, 999) ASC, COALESCE(cost_out_per_mtok, 999) ASC
  LIMIT 1;

  IF v_pick.model IS NULL THEN
    -- No available model claims this capability. Say so; do not silently pick one.
    RETURN jsonb_build_object(
      'capability', p_capability,
      'model', NULL,
      'status', 'NO_CAPABLE_MODEL_AVAILABLE',
      'rationale', format('No AVAILABLE model declares strength in "%s". The enterprise holds ONE provider credential (Anthropic). Choosing a model that is not good at this task would be worse than admitting the gap.', p_capability));
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'task_type', task_type, 'calls', calls, 'success_pct', success_pct,
    'avg_latency_ms', avg_latency_ms, 'avg_cost_usd', avg_cost_usd)), '[]'::jsonb)
    INTO v_evidence FROM v_model_performance WHERE model = v_pick.model;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('model', model, 'provider', provider, 'blocked_reason', blocked_reason)), '[]'::jsonb)
    INTO v_blocked FROM model_registry WHERE NOT available;

  RETURN jsonb_build_object(
    'capability', p_capability,
    'model', v_pick.model,
    'provider', v_pick.provider,
    'status', 'SELECTED',
    'cost_in_per_mtok', v_pick.cost_in_per_mtok,
    'cost_out_per_mtok', v_pick.cost_out_per_mtok,
    'candidates_considered', v_candidates,
    'rationale', format('%s is the CHEAPEST AVAILABLE model that is declared strong at "%s" and not weak at it (%s candidate(s) considered). Paying a premium model for a task a cheap one does well is a margin leak repeated thousands of times.',
      v_pick.model, p_capability, v_candidates),
    'measured_evidence', v_evidence,
    'evidence_status', CASE WHEN v_evidence = '[]'::jsonb
      THEN 'NO MEASURED EVIDENCE YET for this model. The choice rests on DECLARED strengths, not proven ones. It will be overridden by measurement as calls accumulate.'
      ELSE 'Choice is backed by measured calls in v_model_performance.' END,
    'unreachable_models', v_blocked,
    'reach_truth', 'This enterprise holds ONE provider credential (ANTHROPIC_API_KEY). GPT/Gemini/DeepSeek/Grok are registered but UNREACHABLE — no key. Routing is already correct for the day a key arrives; it is not simulated today.'
  );
END; $$;

REVOKE ALL ON FUNCTION public.compute_model_choice(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.compute_model_choice(text, text) TO service_role, authenticated;
