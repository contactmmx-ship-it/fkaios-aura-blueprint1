-- Applied in production as version 20260710001505 (constitution_violations_and_dashboard_views).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 9a2893aa03c1150a2e5be3a340d128fb).
-- Record only: do not apply from this folder.

-- Missing backend object #1 (audit: NOT IMPLEMENTED): constitution violations.
-- Postgres reality: when an enforcement trigger RAISEs, the whole transaction
-- rolls back — including any log row written inside it. Therefore violations
-- are persisted at the APPLICATION layer: any engine/function that catches a
-- 'GOVERNANCE:' DB rejection records it here in a fresh transaction.
create table if not exists constitution_violations (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  attempted_action text not null,
  violation_message text not null,
  law_reference text,
  source_table text,
  severity text not null default 'blocked' check (severity in ('blocked','flagged')),
  metadata jsonb,
  created_at timestamptz not null default now()
);
alter table constitution_violations enable row level security;
create policy "founder read violations" on constitution_violations for select
  using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name='founder'));

-- Unified violations feed: app-logged blocks + constitutional rejections that
-- DO persist (rejected review verdicts, rejection audit events).
create or replace view v_constitution_violations as
select id, created_at, actor, attempted_action, violation_message, 'app_layer_block' as kind
from constitution_violations
union all
select id, updated_at, proposing_agent, 'governed_decision: '||title, coalesce(left(review_reasoning, 300), 'rejected by independent review'), 'review_rejection'
from governed_decisions where review_verdict = 'rejected'
union all
select id, updated_at, proposing_agent, 'engineering: '||target_module, coalesce(left(review_reasoning, 300), 'rejected by independent review'), 'review_rejection'
from engineering_change_proposals where review_verdict = 'rejected'
union all
select id, created_at, coalesce(actor_type,'agent'), action, coalesce(left(decision_reasoning,300),''), 'audit_event'
from audit_logs where action like '%rejected%' or action like '%violation%';

-- Helper view: one-row-per-widget dashboard aggregates (traceable queries)
create or replace view v_governance_dashboard_summary as
select
  (select count(*) from engineering_constitution where active) as active_laws,
  (select max(law_number) from engineering_constitution where active) as constitution_version,
  (select count(*) from governed_decisions) as governed_total,
  (select count(*) from governed_decisions where status='review') as pending_reviews,
  (select count(*) from governed_decisions where status='approved') as approved,
  (select count(*) from governed_decisions where review_verdict='rejected') as rejected,
  (select count(*) from governed_decisions where status='executing') as executing,
  (select count(*) from governed_decisions where status='completed') as completed,
  (select count(*) from v_constitution_violations) as violations,
  (select count(*) from executive_cycles) as exec_cycles_total,
  (select count(*) from executive_cycles where created_at::date = current_date) as exec_cycles_today,
  (select max(created_at) from executive_cycles) as last_exec_cycle,
  (select count(*) from approvals where status='pending') as approval_queue,
  (select count(*) from governed_decisions where status='rolled_back')
   + (select count(*) from engineering_change_proposals where status='rolled_back') as rollbacks;
