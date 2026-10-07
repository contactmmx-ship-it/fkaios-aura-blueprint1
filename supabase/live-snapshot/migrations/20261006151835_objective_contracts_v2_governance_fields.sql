-- Applied in production as version 20261006151835 (objective_contracts_v2_governance_fields).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 64a5a90e5e19df62257daa667f1fa490).
-- Record only: do not apply from this folder.

alter table public.objective_contracts add column if not exists risk_level text; alter table public.objective_contracts add column if not exists constraints jsonb not null default '[]'::jsonb; alter table public.objective_contracts add column if not exists deliverables jsonb not null default '[]'::jsonb; alter table public.objective_contracts add column if not exists evidence_requirements jsonb not null default '[]'::jsonb; alter table public.objective_contracts add column if not exists founder_approval_required boolean not null default false; alter table public.objective_contracts add column if not exists version integer not null default 1;
