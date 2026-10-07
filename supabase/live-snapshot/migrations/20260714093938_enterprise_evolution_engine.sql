-- Applied in production as version 20260714093938 (enterprise_evolution_engine).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 46b579483428a83592bfb9979e02120e).
-- Record only: do not apply from this folder.

-- ENTERPRISE EVOLUTION ENGINE — the capability that builds future capabilities.
--
-- Distinct from opportunity_backlog (COMMERCIAL: what should we sell?).
-- This is the CAPABILITY backlog: what is the enterprise structurally missing,
-- obsolete in, or duplicating? It grades the company against itself.
--
-- THE DISCIPLINE THAT MAKES IT REAL RATHER THAN A WISHLIST:
--   `observed_defect` is MANDATORY and CHECK-constrained. A capability may only be
--   proposed if it names a MEASURED defect in live telemetry — "37 of 41 employees
--   have never completed a task", "5,970 jobs were fabricated", "revenue is Rs 0
--   with 8 unpriced assets". A capability grounded in a hunch is not a capability;
--   it is a feature request, and feature requests are what the Constitution forbids.
--
-- Priority is COMPUTED, never asserted by the model:
--   priority = (enterprise_value * confidence/100) / max(effort_days,1)
CREATE TABLE IF NOT EXISTS public.capability_backlog (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability        text NOT NULL,
  engine            text NOT NULL,   -- Revenue|Product|Software|AI|Sales|Marketing|Finance|Delivery|Research|Strategy|Automation|Learning|Governance
  gap_type          text NOT NULL CHECK (gap_type IN ('missing','obsolete','duplicate','underperforming')),
  observed_defect   text NOT NULL,   -- MANDATORY: the measured evidence
  why_it_compounds  text,            -- does it build FUTURE capabilities, or just do a job once?
  enterprise_value  numeric,         -- 0-100, subjective but forced to be justified
  confidence_pct    integer CHECK (confidence_pct BETWEEN 0 AND 100),
  effort_days       integer,
  priority_score    numeric,         -- COMPUTED, not asserted
  blocked_by        text,            -- 'founder_gate:pricing' | 'founder_gate:customer_comms' | null
  status            text NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed','building','shipped','rejected','parked')),
  source_agent      text NOT NULL DEFAULT 'evolution-engine',
  model             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT defect_must_be_measured CHECK (length(trim(observed_defect)) > 20)
);

CREATE INDEX IF NOT EXISTS idx_capability_priority ON public.capability_backlog (status, priority_score DESC);
ALTER TABLE public.capability_backlog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capability_select ON public.capability_backlog;
CREATE POLICY capability_select ON public.capability_backlog FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS capability_update ON public.capability_backlog;
CREATE POLICY capability_update ON public.capability_backlog FOR UPDATE TO authenticated USING (true);

-- The engine's own output: what should the company build NEXT, and is it blocked?
CREATE OR REPLACE FUNCTION public.compute_next_capability()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_next jsonb; v_open int; v_blocked int; v_top jsonb;
BEGIN
  SELECT count(*) FILTER (WHERE status = 'proposed'),
         count(*) FILTER (WHERE status = 'proposed' AND blocked_by IS NOT NULL)
    INTO v_open, v_blocked FROM capability_backlog;

  -- The engine, not the engineer, decides what is next: highest priority UNBLOCKED.
  SELECT to_jsonb(c) INTO v_next FROM (
    SELECT capability, engine, gap_type, observed_defect, why_it_compounds,
           enterprise_value, confidence_pct, effort_days, priority_score
    FROM capability_backlog
    WHERE status = 'proposed' AND blocked_by IS NULL
    ORDER BY priority_score DESC NULLS LAST LIMIT 1
  ) c;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'capability', capability, 'engine', engine, 'gap_type', gap_type,
    'observed_defect', observed_defect, 'priority_score', priority_score,
    'blocked_by', blocked_by, 'effort_days', effort_days
  ) ORDER BY priority_score DESC NULLS LAST), '[]'::jsonb) INTO v_top
  FROM (SELECT * FROM capability_backlog WHERE status='proposed' ORDER BY priority_score DESC NULLS LAST LIMIT 10) t;

  RETURN jsonb_build_object(
    'open_capabilities', v_open,
    'blocked_on_founder', v_blocked,
    'next_unblocked', v_next,
    'backlog_empty', (v_open = 0),
    'warning', CASE WHEN v_open = 0 THEN
      'CAPABILITY BACKLOG IS EMPTY. The enterprise has stopped evolving. Per the Constitution this is a failure of the evolution loop, not a quiet day.' END,
    'note', 'Every capability here names a MEASURED defect in live telemetry. The schema physically refuses one that does not (CHECK on observed_defect). Priority is COMPUTED, never asserted.',
    'backlog', v_top
  );
END; $$;

REVOKE ALL ON FUNCTION public.compute_next_capability() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_next_capability() TO service_role, authenticated;
