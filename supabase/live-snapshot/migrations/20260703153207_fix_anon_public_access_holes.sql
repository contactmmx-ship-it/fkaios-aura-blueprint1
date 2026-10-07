-- Applied in production as version 20260703153207 (fix_anon_public_access_holes).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 80134cd1de7ddbaf85c260ed39bc7b87).
-- Record only: do not apply from this folder.

DROP POLICY IF EXISTS anon_read_brain_agents ON public.brain_agents;
DROP POLICY IF EXISTS anon_read_brain_brands ON public.brain_brands;
