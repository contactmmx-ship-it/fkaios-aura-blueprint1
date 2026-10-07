-- Applied in production as version 20261006045655 (objective_contracts_v1).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: e1723ba8d7511f1f98ee9a3d59f9586b).
-- Record only: do not apply from this folder.

create table if not exists public.objective_contracts (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null unique references public.orchestrator_requests(id) on delete cascade,
  objective_type text not null,
  intent jsonb not null default '{}'::jsonb,
  requirements jsonb not null default '[]'::jsonb,
  acceptance_criteria jsonb not null default '[]'::jsonb,
  quality_benchmark jsonb not null default '{}'::jsonb,
  discovery jsonb not null default '{}'::jsonb,
  solution_plan jsonb not null default '{}'::jsonb,
  continuity jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','ready','executing','verified','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists objective_contracts_status_idx on public.objective_contracts(status);
alter table public.objective_contracts enable row level security;
