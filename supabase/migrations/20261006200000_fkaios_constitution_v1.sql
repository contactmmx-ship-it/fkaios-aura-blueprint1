create table if not exists public.fkaios_constitution (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  status text not null default 'active' check (status in ('draft','active','superseded')),
  authority jsonb not null default '{}'::jsonb,
  priorities jsonb not null default '[]'::jsonb,
  principles jsonb not null default '[]'::jsonb,
  quality_rules jsonb not null default '[]'::jsonb,
  risk_rules jsonb not null default '[]'::jsonb,
  authority_matrix jsonb not null default '[]'::jsonb,
  non_negotiables jsonb not null default '[]'::jsonb,
  escalation_rules jsonb not null default '[]'::jsonb,
  machine_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fkaios_constitution enable row level security;

create policy "founder can read constitution"
on public.fkaios_constitution
for select to authenticated
using (true);