-- FKAIOS Phase 0, Task 1: Database truth migration.
-- fleet_memory, founder_identity, founder_principles, engineering_constitution
-- have existed live in prod since early sessions but were never committed as
-- migrations (schema is DB-only). This migration creates the same shapes so
-- `supabase migration up` against an empty project reproduces the founder
-- brain foundation's structure. Schema-only — no seed data: the real content
-- (1 identity row, 13 principles, 15 constitution laws) lives only in the
-- live production database and must be exported/supplied separately before
-- this migration's acceptance criterion (row-for-row match with prod) is met.
-- See FKAIOS_PHASE_0-3_EXECUTION_CONTROL.md §2 Task 1.

-- 1. FLEET_MEMORY — append-only memory log (founder-brain.ts, executive-planner.ts,
--    decision-intelligence.ts, curiosity.ts, avatar-orchestrator, governance-dashboard;
--    also read directly by FounderCockpit.tsx / FounderBrainBrief.tsx as `authenticated`)
CREATE TABLE IF NOT EXISTS fleet_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_department text NOT NULL,
  memory_type text NOT NULL,
  title text NOT NULL,
  content text,
  structured_content jsonb,
  confidence numeric,
  visible_to_departments text[] NOT NULL DEFAULT '{"*"}',
  visible_to_agents text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fleet_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY fleet_memory_auth ON fleet_memory FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_fleet_memory_dept_time ON fleet_memory(source_department, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_memory_dept_type_time ON fleet_memory(source_department, memory_type, created_at DESC);

-- 2. FOUNDER_IDENTITY — versioned, single-active-row identity document
CREATE TABLE IF NOT EXISTS founder_identity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  version int NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE founder_identity ENABLE ROW LEVEL SECURITY;
CREATE POLICY founder_identity_auth ON founder_identity FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_founder_identity_active_version ON founder_identity(active, version DESC);

-- 3. FOUNDER_PRINCIPLES — weighted, injected into every ai-engine LLM call
CREATE TABLE IF NOT EXISTS founder_principles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principle text NOT NULL,
  weight numeric NOT NULL,
  applies_to text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE founder_principles ENABLE ROW LEVEL SECURITY;
CREATE POLICY founder_principles_auth ON founder_principles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_founder_principles_active_weight ON founder_principles(active, weight DESC);

-- 4. ENGINEERING_CONSTITUTION — numbered laws referenced by governance-engine,
--    v_constitution_violations
CREATE TABLE IF NOT EXISTS engineering_constitution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  law_number int NOT NULL,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE engineering_constitution ENABLE ROW LEVEL SECURITY;
CREATE POLICY engineering_constitution_auth ON engineering_constitution FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_engineering_constitution_active_law ON engineering_constitution(active, law_number);

-- Rollback (repo convention is forward-only, no down-migrations):
-- DROP TABLE IF EXISTS fleet_memory, founder_identity, founder_principles, engineering_constitution;
