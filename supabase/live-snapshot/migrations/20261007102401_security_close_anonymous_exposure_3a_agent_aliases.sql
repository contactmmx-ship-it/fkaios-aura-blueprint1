-- Applied in production as version 20261007102401 (security_close_anonymous_exposure_3a_agent_aliases).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: cc1e23f1b4bddf07524973c1a9692dbd).
-- Record only: do not apply from this folder.

set local lock_timeout = '5s';
alter table public.agent_aliases enable row level security;
revoke all on table public.agent_aliases from anon;
create policy agent_aliases_authenticated_read on public.agent_aliases for select to authenticated using (true);
