-- Applied in production as version 20260714095217 (multi_executive_intelligence).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: f9024db9d018d980239c0b0eb52293d1).
-- Record only: do not apply from this folder.

-- MULTI-EXECUTIVE INTELLIGENCE + ENTERPRISE BRAIN ARBITRATION.
--
-- WHY THIS IS NOT A DUPLICATE OF THE EVOLUTION ENGINE (the Constitution forbids
-- duplicate capabilities, so this must justify itself):
--   evolution-engine reasons as ONE voice optimising ENTERPRISE VALUE.
--   This is a BOARD. Each executive reasons ONLY from its own mandate and is
--   REQUIRED to say where it disagrees with the others.
--
-- A CFO whose mandate is "protect margin" and a CRO whose mandate is "acquire
-- revenue" will reach OPPOSITE conclusions from the SAME telemetry. A single
-- reasoner silently averages that tension away and produces a bland consensus that
-- is wrong in a specific, expensive direction. The disagreement IS the signal.
--
-- The Brain does NOT resolve conflicts by picking a winner. It SURFACES them to the
-- Founder, because a genuine executive conflict is a FOUNDER decision, not an
-- arithmetic one. Averaging two executives is how boards make catastrophic decisions
-- that nobody actually argued for.
CREATE TABLE IF NOT EXISTS public.executive_recommendations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exec_role          text NOT NULL,
  mandate            text NOT NULL,          -- what this executive is FOR
  recommendation     text NOT NULL,
  observed_evidence  text NOT NULL,          -- MANDATORY measured evidence
  conflicts_with     text,                   -- which executive this opposes
  conflict_summary   text,                   -- the actual tension, stated plainly
  urgency            text CHECK (urgency IN ('now','this_quarter','strategic')),
  confidence_pct     integer CHECK (confidence_pct BETWEEN 0 AND 100),
  blocked_by         text,
  status             text NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed','accepted','rejected','superseded')),
  model              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_required CHECK (length(trim(observed_evidence)) > 20)
);

CREATE INDEX IF NOT EXISTS idx_exec_rec_status ON public.executive_recommendations (status, created_at DESC);
ALTER TABLE public.executive_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exec_rec_select ON public.executive_recommendations;
CREATE POLICY exec_rec_select ON public.executive_recommendations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS exec_rec_update ON public.executive_recommendations;
CREATE POLICY exec_rec_update ON public.executive_recommendations FOR UPDATE TO authenticated USING (true);

-- ARBITRATION: surface conflicts, do not average them.
CREATE OR REPLACE FUNCTION public.compute_brain_arbitration()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total int; v_conflicts int; v_blocked int; v_recs jsonb; v_conf jsonb;
BEGIN
  SELECT count(*) FILTER (WHERE status='proposed'),
         count(*) FILTER (WHERE status='proposed' AND conflicts_with IS NOT NULL),
         count(*) FILTER (WHERE status='proposed' AND blocked_by IS NOT NULL)
    INTO v_total, v_conflicts, v_blocked FROM executive_recommendations;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'exec_role', exec_role, 'mandate', mandate, 'recommendation', recommendation,
    'evidence', observed_evidence, 'urgency', urgency, 'confidence_pct', confidence_pct,
    'blocked_by', blocked_by
  ) ORDER BY CASE urgency WHEN 'now' THEN 1 WHEN 'this_quarter' THEN 2 ELSE 3 END,
    confidence_pct DESC), '[]'::jsonb) INTO v_recs
  FROM executive_recommendations WHERE status='proposed';

  -- The conflicts are the point. They go to the Founder, unaveraged.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'between', exec_role || ' vs ' || conflicts_with,
    'tension', conflict_summary,
    'position', recommendation
  ) ORDER BY created_at DESC), '[]'::jsonb) INTO v_conf
  FROM executive_recommendations
  WHERE status='proposed' AND conflicts_with IS NOT NULL AND conflict_summary IS NOT NULL;

  RETURN jsonb_build_object(
    'computed_at', now(),
    'open_recommendations', v_total,
    'executive_conflicts', v_conflicts,
    'blocked_on_founder', v_blocked,
    'arbitration_policy',
      'The Brain does NOT pick a winner between executives. A genuine conflict between two mandates (protect margin vs acquire revenue) is a FOUNDER decision, not an arithmetic one. Averaging two executives produces a consensus nobody argued for and is how boards make expensive mistakes.',
    'conflicts', v_conf,
    'recommendations', v_recs,
    'warning', CASE WHEN v_total > 0 AND v_conflicts = 0 THEN
      'ZERO executive conflicts. Either the company is trivially healthy, or the executives are agreeing because they are all reasoning from the same prompt rather than from opposing mandates. Unanimity in a board is usually a bug.' END
  );
END; $$;

REVOKE ALL ON FUNCTION public.compute_brain_arbitration() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_brain_arbitration() TO service_role, authenticated;
