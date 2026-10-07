-- Applied in production as version 20261007102411 (security_close_anonymous_exposure_3b_model_registry).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: ecc5da6ae72b16d6fd57c4e083d8c8d5).
-- Record only: do not apply from this folder.

set local lock_timeout = '5s';
alter table public.model_registry enable row level security;
revoke all on table public.model_registry from anon;
create policy model_registry_authenticated_read on public.model_registry for select to authenticated using (true);
