-- FKAIOS Phase 0, Task 1: Database truth migration (schema-only, prod-parity).
--
-- Pulled directly from live DDL on project nrlsqshkjuuwiovthrnb ("FK AIOS
-- Phase 0") via information_schema / pg_catalog introspection on 2026-07-29,
-- after a production safety check found all four tables already exist live
-- with real data (fleet_memory: 87 rows, founder_identity: 1,
-- founder_principles: 13, engineering_constitution: 15) and a richer,
-- RBAC-scoped RLS model than an earlier code-archaeology draft assumed.
--
-- Schema-only: no seed data. The real identity/principles/constitution
-- CONTENT still lives prod-only; a separate data-export step is needed to
-- satisfy Task 1's full acceptance criterion. This file is NOT applied to
-- any live project by this commit — intended for fresh/empty environment
-- bootstrap only.
--
-- Known dependency gaps (not fixed here, flagged for follow-up):
-- 1. founder_identity / engineering_constitution policies reference
--    rbac_user_roles / rbac_roles for a 'founder' role check. Those two
--    tables also have no migration file in this repo — a fresh project
--    needs them created first for these two policies to apply cleanly.
-- 2. fleet_memory's foreign keys to ai_agents/leads/brands assume those
--    tables already exist via earlier migrations.
-- 3. founder_principles' live policy "service role full access" is,
--    despite its name, USING (true) WITH CHECK (true) for role `public` —
--    not actually service-role-restricted. Reproduced faithfully below
--    rather than silently tightened; flagging as a possible pre-existing
--    over-broad grant, separate from this migration's scope.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS founder_identity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL,
  name text NOT NULL DEFAULT 'Founder Intelligence Layer',
  content text NOT NULL,
  change_reason text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE founder_identity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "founder full access to identity" ON founder_identity
  FOR ALL TO public
  USING (auth.uid() IN (
    SELECT ur.user_id FROM rbac_user_roles ur
    JOIN rbac_roles r ON r.id = ur.role_id
    WHERE r.name = 'founder'
  ));

CREATE TABLE IF NOT EXISTS founder_principles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principle text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  applies_to text[] NOT NULL DEFAULT ARRAY['*'::text],
  source text NOT NULL DEFAULT 'seeded',
  weight int NOT NULL DEFAULT 5,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE founder_principles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON founder_principles
  FOR ALL TO public
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS engineering_constitution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  law_number int NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  immutable boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engineering_constitution_law_number_key UNIQUE (law_number)
);
ALTER TABLE engineering_constitution ENABLE ROW LEVEL SECURITY;
CREATE POLICY "founder read constitution" ON engineering_constitution
  FOR SELECT TO public
  USING (auth.uid() IN (
    SELECT ur.user_id FROM rbac_user_roles ur
    JOIN rbac_roles r ON r.id = ur.role_id
    WHERE r.name = 'founder'
  ));

CREATE TABLE IF NOT EXISTS fleet_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_agent_id uuid REFERENCES ai_agents(id) ON DELETE SET NULL,
  source_department text,
  memory_type text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  structured_content jsonb,
  visible_to_departments text[] DEFAULT ARRAY['*'::text],
  visible_to_agents uuid[] DEFAULT '{}'::uuid[],
  confidence numeric DEFAULT 0.7,
  embedding vector(384),
  related_lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  related_brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE fleet_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY fleet_memory_authenticated_read ON fleet_memory
  FOR SELECT TO public
  USING (auth.role() = 'authenticated');
CREATE POLICY fleet_memory_service_role_full ON fleet_memory
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS fleet_memory_type_idx ON fleet_memory USING btree (memory_type);
CREATE INDEX IF NOT EXISTS fleet_memory_dept_idx ON fleet_memory USING gin (visible_to_departments);
CREATE INDEX IF NOT EXISTS fleet_memory_embedding_idx ON fleet_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists='10');

-- Rollback (repo convention is forward-only, no down-migrations):
-- DROP TABLE IF EXISTS fleet_memory, founder_identity, founder_principles, engineering_constitution;
