-- Applied in production as version 20260708162435 (rbac_rls_and_seed).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: d04ef7abfc3eaa4f5345afe30452a8d9).
-- Record only: do not apply from this folder.


alter table public.rbac_roles enable row level security;
alter table public.rbac_permissions enable row level security;
alter table public.rbac_role_permissions enable row level security;
alter table public.rbac_user_roles enable row level security;

drop policy if exists "rbac_roles_service_role_full" on public.rbac_roles;
create policy "rbac_roles_service_role_full" on public.rbac_roles for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "rbac_roles_authenticated_read" on public.rbac_roles;
create policy "rbac_roles_authenticated_read" on public.rbac_roles for select using (auth.role() = 'authenticated');

drop policy if exists "rbac_permissions_service_role_full" on public.rbac_permissions;
create policy "rbac_permissions_service_role_full" on public.rbac_permissions for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "rbac_permissions_authenticated_read" on public.rbac_permissions;
create policy "rbac_permissions_authenticated_read" on public.rbac_permissions for select using (auth.role() = 'authenticated');

drop policy if exists "rbac_role_permissions_service_role_full" on public.rbac_role_permissions;
create policy "rbac_role_permissions_service_role_full" on public.rbac_role_permissions for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "rbac_role_permissions_authenticated_read" on public.rbac_role_permissions;
create policy "rbac_role_permissions_authenticated_read" on public.rbac_role_permissions for select using (auth.role() = 'authenticated');

drop policy if exists "rbac_user_roles_service_role_full" on public.rbac_user_roles;
create policy "rbac_user_roles_service_role_full" on public.rbac_user_roles for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "rbac_user_roles_self_read" on public.rbac_user_roles;
create policy "rbac_user_roles_self_read" on public.rbac_user_roles for select using (auth.uid() = user_id);

insert into public.rbac_roles (name, description) values
  ('founder', 'Unrestricted access — Rajeev only. All departments, all actions, all approvals.'),
  ('finance_viewer', 'Read-only access to finance and accounting data. No approve/execute.'),
  ('sales_ops', 'Read/write on leads, meetings, proposals. No finance or legal access.'),
  ('ops_admin', 'Read/write on operations, MIS, training. No finance approvals.')
on conflict (name) do nothing;

insert into public.rbac_permissions (resource, action, description) values
  ('finance', 'read', 'View finance dashboards and reports'),
  ('finance', 'approve', 'Approve financial transactions — founder only per standing rule'),
  ('legal', 'read', 'View legal review outputs'),
  ('legal', 'approve', 'Approve legal decisions — founder only per standing rule'),
  ('leads', 'read', 'View lead records'),
  ('leads', 'write', 'Create/update lead records'),
  ('sales', 'execute', 'Trigger sales agent actions'),
  ('marketing', 'execute', 'Trigger marketing/PR agent actions'),
  ('ops', 'read', 'View operations dashboards'),
  ('founder_avatar', 'execute', 'Use the voice avatar to trigger any app action')
on conflict (resource, action) do nothing;
