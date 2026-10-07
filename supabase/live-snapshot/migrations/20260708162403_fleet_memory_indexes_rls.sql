-- Applied in production as version 20260708162403 (fleet_memory_indexes_rls).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 6f7a45ab5247bd4ebef5f995d3be861f).
-- Record only: do not apply from this folder.


create index if not exists fleet_memory_type_idx on public.fleet_memory (memory_type);
create index if not exists fleet_memory_dept_idx on public.fleet_memory using gin (visible_to_departments);

alter table public.fleet_memory enable row level security;

drop policy if exists "fleet_memory_service_role_full" on public.fleet_memory;
create policy "fleet_memory_service_role_full" on public.fleet_memory
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "fleet_memory_authenticated_read" on public.fleet_memory;
create policy "fleet_memory_authenticated_read" on public.fleet_memory
  for select using (auth.role() = 'authenticated');
