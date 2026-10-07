-- Applied in production as version 20260708162419 (rbac_roles_permissions).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: a87baa1b273785e8b0a8f6daeeedbabf).
-- Record only: do not apply from this folder.


create table if not exists public.rbac_roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  created_at timestamptz default now()
);

create table if not exists public.rbac_permissions (
  id uuid primary key default gen_random_uuid(),
  resource text not null,
  action text not null,
  description text,
  unique (resource, action)
);

create table if not exists public.rbac_role_permissions (
  role_id uuid references public.rbac_roles(id) on delete cascade,
  permission_id uuid references public.rbac_permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists public.rbac_user_roles (
  user_id uuid references auth.users(id) on delete cascade,
  role_id uuid references public.rbac_roles(id) on delete cascade,
  granted_by uuid references auth.users(id),
  granted_at timestamptz default now(),
  primary key (user_id, role_id)
);
