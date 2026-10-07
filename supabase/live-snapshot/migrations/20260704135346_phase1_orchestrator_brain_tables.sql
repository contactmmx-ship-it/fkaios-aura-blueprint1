-- Applied in production as version 20260704135346 (phase1_orchestrator_brain_tables).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: ce134287a4e757bcaacf70d5971f9531).
-- Record only: do not apply from this folder.

-- Tables for the real master orchestrator (Prompt 3 lifecycle + Prompt 29 pipeline)
CREATE TABLE IF NOT EXISTS orchestrator_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_request text NOT NULL,
  requested_by text DEFAULT 'founder',
  classification text,           -- sales | marketing | finance | research | ops | general
  department_code text,
  target_agent_id uuid REFERENCES ai_agents(id),
  vault_sources_used int DEFAULT 0,
  plan text,                     -- the model's stated plan before acting
  risk_level text,
  autonomy_level_required int,
  action_taken text,             -- executed | filed_for_approval | answered_only
  result_summary text,
  approval_id uuid REFERENCES approvals(id),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','failed','awaiting_approval')),
  input_tokens int, output_tokens int, cost_estimate_inr numeric, latency_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE orchestrator_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY orchestrator_requests_auth ON orchestrator_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_orch_req_time ON orchestrator_requests(created_at DESC);
