-- Applied in production as version 20260629021843 (remove_anon_public_access_policies).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 9cf7c1d444b90d1821db621bf8830a20).
-- Record only: do not apply from this folder.


-- These policies had role "-" (i.e. PUBLIC / unauthenticated anon key),
-- meaning anyone on the internet with just the anon key could read/write
-- company AI agent configs, sessions, knowledge base, and project hub
-- with zero login. Replacing with authenticated-only access.

DROP POLICY IF EXISTS "all_agents" ON public.ai_agents;
CREATE POLICY "authenticated_all_agents" ON public.ai_agents
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "all_sessions" ON public.brain_sessions;
CREATE POLICY "authenticated_all_sessions" ON public.brain_sessions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "all_knowledge" ON public.knowledge_documents;
CREATE POLICY "authenticated_all_knowledge" ON public.knowledge_documents
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "all_projects" ON public.project_hub;
CREATE POLICY "authenticated_all_projects" ON public.project_hub
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_insert" ON public.brain_agent_executions;
-- auth_insert_execs (authenticated) policy already covers legitimate writes
