-- =====================================================================
-- DEALER CRM — 003: OBSERVABILITY SCHEMA
-- Wave 1 | Agent: Database Architect
--
-- WHY THIS SHIPS IN WAVE 1 AND NOT AS AN AFTERTHOUGHT: the parent enterprise ran for
-- months with a funnel that was mathematically incapable of producing a qualified lead
-- (BANT ceiling 32 vs a bar of 40) and NOBODY KNEW, because nothing watched the chain.
-- It also accumulated 5,970 fabricated "completed" jobs and 1,188 uncosted LLM calls.
-- Observability built last is observability built never. It goes in the foundation.
-- =====================================================================

CREATE TABLE public.activities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dealer_id      uuid REFERENCES public.dealers(id) ON DELETE CASCADE,
  deal_id        uuid REFERENCES public.deals(id) ON DELETE CASCADE,
  actor_type     text NOT NULL CHECK (actor_type IN ('human','ai')),
  actor          text NOT NULL,
  action         text NOT NULL,
  outcome        text,
  status         text NOT NULL DEFAULT 'completed'
                 CHECK (status IN ('completed','failed','pending')),
  evidence       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- THE 5,970 LESSON, ENCODED: an AI cannot record a completed action without evidence.
  -- A human can (they were there); a machine must show its work.
  CONSTRAINT ai_completion_requires_evidence
    CHECK (NOT (actor_type = 'ai' AND status = 'completed')
           OR length(trim(coalesce(evidence,''))) > 8)
);
CREATE INDEX idx_activities_dealer ON public.activities (dealer_id, created_at DESC);
CREATE INDEX idx_activities_deal   ON public.activities (deal_id, created_at DESC);
CREATE INDEX idx_activities_failed ON public.activities (created_at DESC) WHERE status = 'failed';

CREATE TABLE public.llm_cost_ledger (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  agent              text NOT NULL,
  task_type          text NOT NULL,
  model              text NOT NULL,          -- NEVER nullable. An uncosted call is a leak.
  provider           text NOT NULL,
  selection_reason   text,                   -- WHY this model. A choice without a reason is a habit.
  prompt_version     text,
  input_tokens       integer,
  output_tokens      integer,
  -- NULL = genuinely unknown price. NEVER a guessed 0 — a zero silently UNDERSTATES
  -- burn, which is worse than admitting ignorance.
  estimated_cost_usd numeric,
  latency_ms         integer,
  retries            integer NOT NULL DEFAULT 0,
  success            boolean NOT NULL,
  error_message      text,
  business_objective text,                   -- what the money was FOR
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT failure_requires_error
    CHECK (success OR length(trim(coalesce(error_message,''))) > 3)
);
CREATE INDEX idx_llm_cost_model ON public.llm_cost_ledger (model, created_at DESC);
CREATE INDEX idx_llm_cost_agent ON public.llm_cost_ledger (agent, created_at DESC);

-- The watchdog. Answers "is the commercial chain actually alive?" — the question the
-- parent enterprise could not answer for months.
CREATE TABLE public.pipeline_monitor_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at        timestamptz NOT NULL DEFAULT now(),
  leads_total       integer NOT NULL,
  leads_scored      integer NOT NULL,
  leads_qualified   integer NOT NULL,   -- score >= threshold
  best_score_ever   integer,            -- the number that exposed the parent's dead funnel
  deals_open        integer NOT NULL,
  proposals_sent    integer NOT NULL,
  invoices_paid     integer NOT NULL,
  revenue_received  numeric NOT NULL DEFAULT 0,
  chain_break_stage text,               -- the FIRST stage where the chain dies
  verdict           text NOT NULL
);
CREATE INDEX idx_monitor_time ON public.pipeline_monitor_log (checked_at DESC);

ALTER TABLE public.activities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_cost_ledger      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_monitor_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY activities_owner ON public.activities FOR ALL TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY llm_cost_read ON public.llm_cost_ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY monitor_read  ON public.pipeline_monitor_log FOR SELECT TO authenticated USING (true);
