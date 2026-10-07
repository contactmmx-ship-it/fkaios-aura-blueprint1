-- Applied in production as version 20260704141548 (phase2_research_tables).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 87213dd21e9e731dc9a6da7750b9328a).
-- Record only: do not apply from this folder.

-- Research engine: real Apify-backed lead/market research (Prompt 15/18 subset)
CREATE TABLE IF NOT EXISTS research_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  actor_used text,
  requested_by text DEFAULT 'founder',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  apify_run_id text,
  result_count int DEFAULT 0,
  results jsonb DEFAULT '[]',
  cost_estimate_usd numeric,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_runs_auth ON research_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_research_runs_time ON research_runs(created_at DESC);
