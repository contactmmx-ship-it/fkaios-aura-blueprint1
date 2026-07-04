-- PHASE 1: Org structure (Prompts 4/5) + Governance (Prompts 11/28) + Autonomy (Prompt 3) + Real Vault (Prompt 7)
-- Applied live to project nrlsqshkjuuwiovthrnb on 2026-07-04. Committed here for repo/prod parity.

-- 1. DEPARTMENTS
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
CREATE POLICY departments_auth ON departments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. AGENT GOVERNANCE COLUMNS (autonomy levels 0-5, permissions, budget, escalation)
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id),
  ADD COLUMN IF NOT EXISTS autonomy_level int NOT NULL DEFAULT 1 CHECK (autonomy_level BETWEEN 0 AND 5),
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '["read"]',
  ADD COLUMN IF NOT EXISTS monthly_token_budget_inr numeric DEFAULT 500,
  ADD COLUMN IF NOT EXISTS escalation_rule text DEFAULT 'escalate_to_founder_on_low_confidence';

-- 3. APPROVALS (MD finance boundary — AI prepares, human executes)
CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by_agent uuid REFERENCES ai_agents(id),
  department_code text,
  action_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
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
CREATE POLICY approvals_auth ON approvals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(status) WHERE status='pending';

-- 4. UNIFIED EXECUTION LOG (Prompt 24 observability)
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
CREATE POLICY execution_log_auth ON execution_log FOR SELECT TO authenticated USING (true);
CREATE POLICY execution_log_insert ON execution_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_execution_log_time ON execution_log(created_at DESC);

-- 5. REAL KNOWLEDGE VAULT: pgvector embeddings + semantic search (Prompt 7)
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE brain_knowledge_chunks ADD COLUMN IF NOT EXISTS embedding vector(384);
ALTER TABLE brain_knowledge_chunks ADD COLUMN IF NOT EXISTS token_count int;
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON brain_knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding vector(384),
  match_count int DEFAULT 5,
  filter_brand_id uuid DEFAULT NULL
) RETURNS TABLE (id uuid, document_id uuid, chunk_text text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.document_id, c.text AS chunk_text,
         1 - (c.embedding <=> query_embedding) AS similarity
  FROM brain_knowledge_chunks c
  WHERE c.embedding IS NOT NULL
    AND (filter_brand_id IS NULL OR c.brand_id = filter_brand_id)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 6. Seed 9 departments per Prompt 5
INSERT INTO departments (code, name, mission, executive_agent, kpis, automation_level) VALUES
 ('EXECUTIVE','Executive Council','Strategy, coordination, founder briefings','CEO','["briefings_delivered","decisions_scored","department_health"]', 3),
 ('SALES','Sales','Generate predictable franchise-distribution revenue','CRO','["qualified_leads","pipeline_value_inr","conversion_rate","revenue_inr"]', 3),
 ('MARKETING','Marketing','Acquire leads efficiently across Instagram, Facebook, YouTube, WhatsApp','CMO','["leads_generated","cost_per_lead_inr","roas"]', 2),
 ('HR_TRAINING','HR & Training','Manage AI workforce: targets, reviews, morning/evening rhythm','CHRO','["agent_success_rate","reports_on_time","targets_met"]', 3),
 ('ACCOUNTS','Accounts','Financial visibility: 70:30 splits, royalty, FOCO, subscriptions. Report-only — MD executes','CFO','["invoices_raised","collections_inr","forecast_accuracy"]', 2),
 ('RND','R&D','Research markets, competitors, technologies; feed the vault','CRO_RESEARCH','["research_briefs","vault_documents_added"]', 3),
 ('SOFTWARE_FACTORY','Software Factory','Build client apps/CRMs/websites: one-time fee + subscription','CTO','["projects_delivered","subscription_mrr_inr","client_satisfaction"]', 2),
 ('OPERATIONS','Operations','Onboarding, documentation, compliance, logistics','COO','["onboarding_days","docs_completed","compliance_score"]', 3),
 ('SUPPORT','Customer Support','World-class experience for franchisees, investors, software clients','CCO','["first_response_mins","resolution_hours","csat"]', 3)
ON CONFLICT (code) DO NOTHING;
