-- Applied in production as version 20260620025424 (phase3_negotiation_tracking).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: a4c38187cde8894dfcf3916d9e29b75f).
-- Record only: do not apply from this folder.


-- Phase 3 Migration: Negotiation tracking, objections log, deal closure tracking

-- Add negotiation state machine to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS negotiation_status text DEFAULT 'not_started' CHECK (
  negotiation_status IN ('not_started', 'objection_raised', 'objection_handling', 'terms_adjusted', 'agreement_ready', 'signed', 'closed')
);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_objection text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS objections_count integer DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS negotiated_terms jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deal_closure_date timestamptz;

-- Create objections log table
CREATE TABLE IF NOT EXISTS lead_objections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  objection_type text,
  objection_text text,
  ai_handler_response text,
  outcome text CHECK (outcome IN ('resolved', 'escalated', 'pending')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE lead_objections ENABLE ROW LEVEL SECURITY;

-- Negotiation history
CREATE TABLE IF NOT EXISTS negotiation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  change_type text,
  field_name text,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES consultants(id),
  change_reason text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE negotiation_history ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
CREATE POLICY "select_lead_objections" ON lead_objections FOR SELECT TO authenticated USING (
  is_admin() OR lead_id IN (
    SELECT id FROM leads WHERE assigned_to = get_my_consultant_id() OR brand_id = ANY(my_brand_ids())
  )
);

CREATE POLICY "insert_lead_objections" ON lead_objections FOR INSERT TO authenticated WITH CHECK (
  is_admin() OR lead_id IN (
    SELECT id FROM leads WHERE assigned_to = get_my_consultant_id() OR brand_id = ANY(my_brand_ids())
  )
);

CREATE POLICY "select_negotiation_history" ON negotiation_history FOR SELECT TO authenticated USING (
  is_admin() OR lead_id IN (
    SELECT id FROM leads WHERE assigned_to = get_my_consultant_id() OR brand_id = ANY(my_brand_ids())
  )
);

CREATE POLICY "insert_negotiation_history" ON negotiation_history FOR INSERT TO authenticated WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leads_negotiation_status ON leads(negotiation_status);
CREATE INDEX IF NOT EXISTS idx_lead_objections_outcome ON lead_objections(outcome);
CREATE INDEX IF NOT EXISTS idx_negotiation_history_lead ON negotiation_history(lead_id);
