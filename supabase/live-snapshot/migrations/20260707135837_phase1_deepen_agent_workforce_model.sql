-- Applied in production as version 20260707135837 (phase1_deepen_agent_workforce_model).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 07a8851957c3ad16c34069bd1e0885b5).
-- Record only: do not apply from this folder.

-- Extend agent_role_charter with SOP reference, escalation, and approval authority
alter table agent_role_charter add column if not exists sop_reference text;
alter table agent_role_charter add column if not exists escalation_to uuid references agent_role_charter(agent_id);
alter table agent_role_charter add column if not exists approval_limit_inr numeric default 0;

-- Multi-KPI support: one agent can now have 3-5 KPIs with daily/weekly/monthly tiers,
-- instead of the single flat kpi_target the charter table allows.
create table if not exists agent_kpi_targets (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references ai_agents(id) on delete cascade,
  kpi_name text not null,
  kpi_unit text,
  daily_target numeric,
  weekly_target numeric,
  monthly_target numeric,
  weight int default 5,
  created_at timestamptz default now()
);
alter table agent_kpi_targets enable row level security;
create policy "service role full access" on agent_kpi_targets for all using (true) with check (true);
create index if not exists idx_agent_kpi_targets_agent on agent_kpi_targets(agent_id);
