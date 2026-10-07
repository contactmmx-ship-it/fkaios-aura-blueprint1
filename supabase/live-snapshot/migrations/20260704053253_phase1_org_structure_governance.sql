-- Applied in production as version 20260704053253 (phase1_org_structure_governance).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 364b55e238a7200f34a57dff05c80a3f).
-- Record only: do not apply from this folder.

-- PHASE 1 STEP 1: Org structure (Prompts 4/5) + Governance (Prompts 11/28) + Autonomy (Prompt 3)
-- Additive only. Never destroys working functionality (Prompt 1).

-- 1. DEPARTMENTS (Prompt 5: mission, KPIs, budget, automation level)
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  mission text NOT NULL,
  executive_agent text,
  kpis jsonb NOT NULL DEFAULT '[]',
  monthly_budget_inr numeric DEFAULT 0,
  automation_level int NOT NULL DEFAULT 1 CHECK (automation_level BETWEEN 1 AND 5),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS departments_auth ON departments;
CREATE POLICY departments_auth ON departments FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO departments (code, name, mission, executive_agent, kpis, automation_level) VALUES
 ('SALES','Sales','Generate predictable franchise-distribution revenue','CRO', '["qualified_leads","pipeline_value_inr","conversion_rate","revenue_inr"]', 3),
 ('MARKETING','Marketing','Acquire leads efficiently across Instagram, Facebook, YouTube, WhatsApp','CMO','["leads_generated","cost_per_lead_inr","roas"]', 2),
 ('HR_TRAINING','HR & Training','Manage AI workforce: targets, reviews, morning/evening rhythm','CHRO','["agent_success_rate","reports_on_time","targets_met"]', 3),
 ('ACCOUNTS','Accounts','Financial visibility: 70:30 investor splits, 2.5% royalty, 30% FOCO, subscriptions. Report-only — MD executes all money movement','CFO','["invoices_raised","collections_inr","forecast_accuracy"]', 2),
 ('RND','R&D','Research markets, competitors, technologies; feed the vault','CRO_RESEARCH','["research_briefs","vault_documents_added"]', 3),
 ('SOFTWARE_FACTORY','Software Factory','Build client apps/CRMs/websites: one-time fee + subscription revenue','CTO','["projects_delivered","subscription_mrr_inr","client_satisfaction"]', 2),
 ('SUPPORT','Customer Support','World-class experience for franchisees, investors, and software clients','CCO','["first_response_mins","resolution_hours","csat"]', 3)
ON CONFLICT (code) DO NOTHING;

-- 2. AGENT GOVERNANCE COLUMNS (Prompt 3 autonomy levels, Prompt 4 permissions/budget)
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id),
  ADD COLUMN IF NOT EXISTS autonomy_level int NOT NULL DEFAULT 1 CHECK (autonomy_level BETWEEN 0 AND 5),
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '["read"]',
  ADD COLUMN IF NOT EXISTS monthly_token_budget_inr numeric DEFAULT 500,
  ADD COLUMN IF NOT EXISTS escalation_rule text DEFAULT 'escalate_to_founder_on_low_confidence';

-- Map existing 27 agents to departments by their department text field
UPDATE ai_agents a SET department_id = d.id
FROM departments d
WHERE a.department_id IS NULL AND (
  (lower(coalesce(a.department,a.dept,'')) LIKE '%sale%' AND d.code='SALES') OR
  (lower(coalesce(a.department,a.dept,'')) LIKE '%market%' AND d.code='MARKETING') OR
  (lower(coalesce(a.department,a.dept,'')) LIKE '%hr%' AND d.code='HR_TRAINING') OR
  (lower(coalesce(a.department,a.dept,'')) LIKE '%train%' AND d.code='HR_TRAINING') OR
  (lower(coalesce(a.department,a.dept,'')) LIKE '%financ%' AND d.code='ACCOUNTS') OR
  (lower(coalesce(a.department,a.dept,'')) LIKE '%account%' AND d.code='ACCOUNTS') OR
  (lower(coalesce(a.department,a.dept,'')) LIKE '%research%' AND d.code='RND') OR
  (lower(coalesce(a.department,a.dept,'')) LIKE '%r&d%' AND d.code='RND') OR
  (lower(coalesce(a.department,a.dept,'')) LIKE '%engineer%' AND d.code='SOFTWARE_FACTORY') OR
  (lower(coalesce(a.department,a.dept,'')) LIKE '%develop%' AND d.code='SOFTWARE_FACTORY') OR
  (lower(coalesce(a.department,a.dept,'')) LIKE '%support%' AND d.code='SUPPORT') OR
  (lower(coalesce(a.department,a.dept,'')) LIKE '%customer%' AND d.code='SUPPORT')
);

-- 3. APPROVALS TABLE (Prompt 28 governance; MD finance boundary). approval-engine finally gets a real table.
CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by_agent uuid REFERENCES ai_agents(id),
  department_code text,
  action_type text NOT NULL,           -- e.g. send_payment_link, launch_ad_spend, sign_proposal
  payload jsonb NOT NULL DEFAULT '{}', -- full prepared action, executed only after approval
  risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','critical')),
  amount_inr numeric,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','executed')),
  decided_by text,
  decided_at timestamptz,
  expires_at timestamptz DEFAULT now() + interval '72 hours',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approvals_auth ON approvals;
CREATE POLICY approvals_auth ON approvals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(status) WHERE status='pending';

-- 4. UNIFIED EXECUTION LOG (Prompt 24: everything observable; replaces unwired audit tables going forward)
CREATE TABLE IF NOT EXISTS execution_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  function_name text NOT NULL,
  agent_id uuid,
  department_code text,
  action text NOT NULL,
  input_summary text,
  output_summary text,
  status text NOT NULL CHECK (status IN ('success','failure','skipped','pending_approval')),
  error text,
  model text,
  input_tokens int,
  output_tokens int,
  cost_estimate_inr numeric,
  latency_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE execution_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS execution_log_auth ON execution_log;
CREATE POLICY execution_log_auth ON execution_log FOR SELECT TO authenticated USING (true);
CREATE POLICY execution_log_insert ON execution_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_execution_log_time ON execution_log(created_at DESC);

-- 5. pgvector for the real Knowledge Vault (Prompt 7)
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE brain_knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1024),
  ADD COLUMN IF NOT EXISTS token_count int;
