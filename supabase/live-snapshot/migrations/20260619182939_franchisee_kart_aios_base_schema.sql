-- Applied in production as version 20260619182939 (franchisee_kart_aios_base_schema).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: bb4540f48c44fef97eec9a3ebf3aecbf).
-- Record only: do not apply from this folder.


-- Base schema for FK AIOS (Franchisee Kart AI Operating System)
-- Includes: brands, consultants, leads, activities, meetings, documents, invoices, payments
-- AI agents, jobs, workflows, memory, objectives, activity logs, conversations

-- ============================================================
-- BRANDS
-- ============================================================
CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  vertical text CHECK (vertical IN ('QSR', 'Distribution', 'Furniture', 'Preschool', 'EdTech', 'Other')),
  logo_url text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CONSULTANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS consultants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text DEFAULT 'RM' CHECK (role IN ('Founder', 'OpsHead', 'BrandManager', 'RM', 'Accounts', 'Trainer')),
  phone text,
  department text,
  profile_picture_url text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE consultants ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CONSULTANT <-> BRAND MAPPING
-- ============================================================
CREATE TABLE IF NOT EXISTS consultant_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid REFERENCES consultants(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (consultant_id, brand_id)
);

ALTER TABLE consultant_brands ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- LEADS
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES consultants(id) ON DELETE SET NULL,
  company_name text NOT NULL,
  contact_name text,
  contact_email text,
  contact_phone text,
  location text,
  lead_source text,
  stage text DEFAULT 'new' CHECK (stage IN ('new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'closed', 'lost')),
  lead_score integer DEFAULT 0,
  investment_capacity text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- LEAD ACTIVITIES
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  activity_type text CHECK (activity_type IN ('call', 'email', 'meeting', 'note', 'follow_up')),
  description text,
  next_follow_up timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- MEETINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  consultant_id uuid REFERENCES consultants(id) ON DELETE CASCADE,
  title text,
  description text,
  meeting_date timestamptz,
  duration_minutes integer,
  meeting_link text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  document_type text,
  file_name text,
  file_url text,
  uploaded_by uuid REFERENCES consultants(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- INVOICES
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  invoice_number text UNIQUE,
  amount numeric(12,2),
  currency text DEFAULT 'INR',
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  issue_date timestamptz DEFAULT now(),
  due_date timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  amount numeric(12,2),
  payment_method text,
  transaction_id text UNIQUE,
  payment_date timestamptz,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AI AGENTS (25-agent template)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  department text,
  task text,
  prompt text,
  total_tasks_completed integer DEFAULT 0,
  success_rate numeric(5,2) DEFAULT 0,
  last_active_at timestamptz,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'paused')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AI JOBS (task queue)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES ai_agents(id) ON DELETE SET NULL,
  type text,
  payload jsonb,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result jsonb,
  error text,
  retry_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AI OUTCOMES (per-job results)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES ai_jobs(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES ai_agents(id),
  outcome_type text,
  result jsonb,
  metrics jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ai_outcomes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AI EVOLUTION (agent learning/improvement log)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_evolution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES ai_agents(id) ON DELETE CASCADE,
  change_type text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ai_evolution ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AGENT MEMORY (persistent context)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES ai_agents(id) ON DELETE CASCADE,
  memory_type text,
  content jsonb,
  relevance_score numeric(5,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AGENT WORKFLOWS (task definitions)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES ai_agents(id) ON DELETE CASCADE,
  workflow_name text,
  steps jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE agent_workflows ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AGENT OBJECTIVES (goals)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES ai_agents(id) ON DELETE CASCADE,
  objective_text text,
  target_metric text,
  target_value numeric,
  current_value numeric,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE agent_objectives ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AGENT ACTIVITY LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES ai_agents(id) ON DELETE CASCADE,
  job_id uuid REFERENCES ai_jobs(id) ON DELETE SET NULL,
  activity_type text,
  title text,
  description text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agent_activity_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AGENT CONVERSATIONS (chat history)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES ai_agents(id) ON DELETE CASCADE,
  message text,
  response text,
  context jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SETTINGS (app configuration)
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_leads_brand ON leads(brand_id);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_meetings_lead ON meetings(lead_id);
CREATE INDEX IF NOT EXISTS idx_meetings_consultant ON meetings(consultant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_lead ON invoices(lead_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_agent ON ai_jobs(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status);
CREATE INDEX IF NOT EXISTS idx_agent_activity_agent ON agent_activity_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_consultant_brands_consultant ON consultant_brands(consultant_id);
CREATE INDEX IF NOT EXISTS idx_consultant_brands_brand ON consultant_brands(brand_id);
CREATE INDEX IF NOT EXISTS idx_consultants_auth_user ON consultants(auth_user_id);
