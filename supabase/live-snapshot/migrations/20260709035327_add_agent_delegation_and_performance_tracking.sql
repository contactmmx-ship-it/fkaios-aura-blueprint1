-- Applied in production as version 20260709035327 (add_agent_delegation_and_performance_tracking).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 30d89dde08d66fdd5bac9f7ea43b8118).
-- Record only: do not apply from this folder.

-- Agent-to-Agent task delegation registry
-- Inspired by Microsoft Copilot Studio's A2A protocol: lets one agent hand a
-- sub-task to another agent with a tracked status, instead of agents working
-- in isolated silos.
create table if not exists agent_task_delegations (
  id uuid primary key default gen_random_uuid(),
  from_agent text not null,
  to_agent text not null,
  task_description text not null,
  context jsonb,
  status text not null default 'pending' check (status in ('pending','accepted','in_progress','completed','failed','rejected')),
  result text,
  requires_founder_approval boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table agent_task_delegations enable row level security;
create policy "founder full access to delegations" on agent_task_delegations
  for all using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name = 'founder'));
create index if not exists idx_delegations_status on agent_task_delegations(status);

-- Agent performance / observability metrics
-- Inspired by Copilot Studio's analytics dashboard tracking cost, latency, accuracy.
create table if not exists agent_performance_metrics (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  task_type text not null,
  latency_ms integer,
  estimated_cost_usd numeric(10,4),
  input_tokens integer,
  output_tokens integer,
  success boolean not null default true,
  error_message text,
  created_at timestamptz not null default now()
);
alter table agent_performance_metrics enable row level security;
create policy "founder full access to performance metrics" on agent_performance_metrics
  for all using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name = 'founder'));
create index if not exists idx_perf_agent_task on agent_performance_metrics(agent_id, task_type, created_at desc);

-- Trust dashboard view — governance summary per agent, in the spirit of
-- SAP's "audit-ready agents" and Microsoft's "control tower" concept.
create or replace view v_agent_trust_dashboard as
select
  action,
  actor_type,
  count(*) as total_actions,
  count(*) filter (where requires_human_review) as flagged_for_review,
  count(*) filter (where reviewed_by is not null) as reviewed_count,
  max(created_at) as last_action_at
from audit_logs
where actor_type is not null
group by action, actor_type
order by last_action_at desc;
