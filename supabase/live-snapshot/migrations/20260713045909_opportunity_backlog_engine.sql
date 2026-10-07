-- Applied in production as version 20260713045909 (opportunity_backlog_engine).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 30624a37905d912ee9e49ad5ed14fb37).
-- Record only: do not apply from this folder.

-- SELF-THINKING / OPPORTUNITY BACKLOG ENGINE (Roadmap item 1).
-- The enterprise must generate its own work. Nothing here executes autonomously:
-- an opportunity is a PROPOSAL until the Founder approves it. Commercial pricing
-- is an explicit Founder Approval Gate, so every rupee figure the engine produces
-- is stored as an ASSUMPTION and labelled as such — never as a forecast.
CREATE TABLE IF NOT EXISTS public.opportunity_backlog (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL,
  category           text,                       -- saas | services | licensing | product | partnership | automation
  problem            text NOT NULL,              -- the real market problem
  customer_segment   text,
  revenue_model      text,
  -- Estimates are ASSUMPTIONS pending Founder validation. Never presented as fact.
  est_revenue_inr    numeric,
  est_effort_days    integer,
  probability_pct    integer CHECK (probability_pct BETWEEN 0 AND 100),
  roi_score          numeric,                    -- derived, not invented: see compute below
  risk               text,
  -- Grounding: which REAL asset already in this enterprise makes this credible.
  grounded_in        text NOT NULL,
  mission_impact     text,                       -- ₹5 Cr gate vs ₹1,100 Cr mission
  status             text NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed','approved','rejected','executing','delivered','parked')),
  owning_department  text,
  source_agent       text NOT NULL DEFAULT 'ceo-engine',
  model              text,                       -- LLM execution graph
  decided_at         timestamptz,
  decided_by         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backlog_status ON public.opportunity_backlog (status, roi_score DESC);

ALTER TABLE public.opportunity_backlog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS backlog_select ON public.opportunity_backlog;
CREATE POLICY backlog_select ON public.opportunity_backlog FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS backlog_update ON public.opportunity_backlog;
CREATE POLICY backlog_update ON public.opportunity_backlog FOR UPDATE TO authenticated USING (true);

-- The backlog must NEVER be empty (Rule 8). This reports emptiness as a failure
-- of the thinking loop rather than letting silence look like calm.
CREATE OR REPLACE FUNCTION public.compute_opportunity_backlog()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_open int; v_proposed int; v_approved int; v_top jsonb; v_last timestamptz;
BEGIN
  SELECT count(*) FILTER (WHERE status IN ('proposed','approved','executing')),
         count(*) FILTER (WHERE status = 'proposed'),
         count(*) FILTER (WHERE status = 'approved'),
         max(created_at)
    INTO v_open, v_proposed, v_approved, v_last FROM opportunity_backlog;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'roi_score')::numeric DESC), '[]'::jsonb) INTO v_top
  FROM (
    SELECT jsonb_build_object(
      'id', id, 'title', title, 'category', category, 'problem', problem,
      'customer_segment', customer_segment, 'revenue_model', revenue_model,
      'est_revenue_inr', est_revenue_inr, 'est_effort_days', est_effort_days,
      'probability_pct', probability_pct, 'roi_score', roi_score, 'risk', risk,
      'grounded_in', grounded_in, 'mission_impact', mission_impact,
      'status', status, 'owning_department', owning_department, 'model', model,
      'created_at', created_at
    ) AS x FROM opportunity_backlog WHERE status = 'proposed'
    ORDER BY roi_score DESC NULLS LAST LIMIT 10
  ) t;

  RETURN jsonb_build_object(
    'open', v_open, 'proposed', v_proposed, 'approved', v_approved,
    'last_generated_at', v_last,
    'backlog_empty', (v_open = 0),
    'warning', CASE WHEN v_open = 0 THEN
      'THE OPPORTUNITY BACKLOG IS EMPTY. The enterprise has stopped thinking. Per the Constitution the backlog must never be empty — an empty backlog is a failure of the self-thinking loop, not a quiet day.' END,
    'estimates_are_assumptions', 'Every rupee figure below is an ASSUMPTION produced by the CEO engine, not a validated forecast. Commercial pricing is a Founder Approval Gate.',
    'top', v_top
  );
END; $$;

REVOKE ALL ON FUNCTION public.compute_opportunity_backlog() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_opportunity_backlog() TO service_role, authenticated;
