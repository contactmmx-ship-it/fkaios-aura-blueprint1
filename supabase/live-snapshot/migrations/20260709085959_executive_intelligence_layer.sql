-- Applied in production as version 20260709085959 (executive_intelligence_layer).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 247dc3c37f490e6d8d528278d29853a4).
-- Record only: do not apply from this folder.

-- EXECUTIVE INTELLIGENCE LAYER (EIL)
-- Sits above Governance, below the Founder. Thinks, plans, predicts,
-- coordinates and allocates continuously WITHOUT waiting for instructions —
-- but acts only through constitutional channels: it PROPOSES (governed
-- decisions), DELEGATES (task delegations), STAGES capital (approvals),
-- and BRIEFS the founder. It never executes money and never bypasses review.

create table if not exists executive_cycles (
  id uuid primary key default gen_random_uuid(),
  cycle_number bigserial,
  observed_state jsonb not null,
  situation_assessment text not null,
  opportunities jsonb,
  risks jsonb,
  capital_allocation jsonb,
  directives_issued jsonb,
  predictions_made integer not null default 0,
  founder_briefing text not null,
  model_used text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

-- Law 14 machinery: every prediction is a measurable claim with a due date.
create table if not exists executive_predictions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid references executive_cycles(id),
  metric text not null,
  expected_value text not null,
  basis text,
  measure_by date not null,
  actual_value text,
  was_correct boolean,
  measured_at timestamptz,
  created_at timestamptz not null default now()
);

alter table executive_cycles enable row level security;
alter table executive_predictions enable row level security;
create policy "founder read cycles" on executive_cycles for select
  using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name='founder'));
create policy "founder all predictions" on executive_predictions for all
  using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name='founder'));
create index if not exists idx_exec_pred_due on executive_predictions(measure_by) where actual_value is null;

-- The EIL is an agent like any other: it starts at probation and EARNS trust (Law 13).
insert into agent_intelligence_profiles (agent_name, role, trust_level, knowledge_scope, governance_score)
values ('executive-intelligence',
        'Executive Intelligence Layer — continuous strategic cognition: observe, assess, predict, plan, coordinate departments, stage capital allocation. Proposes and delegates only; never executes money; constitutionally bound.',
        'probation',
        'full business state (read), governed_decisions (propose), agent_task_delegations (issue), approvals (stage), executive briefings (publish)',
        0.5)
on conflict (agent_name) do nothing;

-- Extend KPI computation with prediction_accuracy (real measurements only)
create or replace function compute_governance_kpis() returns void language plpgsql as $$
declare n bigint; v numeric;
begin
  select count(*), avg(case when success then 1.0 else 0 end)*100 into n, v from agent_performance_metrics;
  if n > 0 then insert into governance_kpis(kpi, value, evidence) values ('autonomous_success_rate', round(v,2), jsonb_build_object('sample_size', n, 'source', 'agent_performance_metrics')); end if;

  select count(*), avg(case when review_verdict='approved' then 1.0 else 0 end)*100 into n, v from (
    select review_verdict from engineering_change_proposals where review_verdict is not null
    union all select review_verdict from governed_decisions where review_verdict is not null) x;
  if n > 0 then insert into governance_kpis(kpi, value, evidence) values ('decision_approval_rate', round(v,2), jsonb_build_object('reviewed_decisions', n)); end if;

  select count(*), avg(case when status='completed' then 1.0 else 0 end)*100 into n, v from (
    select status from engineering_change_proposals where status in ('completed','rolled_back')
    union all select status from governed_decisions where status in ('completed','rolled_back')) x;
  if n > 0 then insert into governance_kpis(kpi, value, evidence) values ('execution_accuracy', round(v,2), jsonb_build_object('finished_decisions', n)); end if;

  select count(*), avg(governance_score)*100 into n, v from agent_intelligence_profiles where total_decisions > 0;
  if n > 0 then insert into governance_kpis(kpi, value, evidence) values ('founder_alignment_score', round(v,2), jsonb_build_object('agents_with_history', n)); end if;

  select count(*), avg(case when lessons is not null then 1.0 else 0 end)*100 into n, v from governed_decisions where status='completed';
  if n > 0 then insert into governance_kpis(kpi, value, evidence) values ('learning_effectiveness', round(v,2), jsonb_build_object('completed_decisions', n)); end if;

  select count(*), avg(case when was_correct then 1.0 else 0 end)*100 into n, v from executive_predictions where was_correct is not null;
  if n > 0 then insert into governance_kpis(kpi, value, evidence) values ('prediction_accuracy', round(v,2), jsonb_build_object('measured_predictions', n, 'source','executive_predictions')); end if;
end; $$;

-- Daily executive cognition cycle at 02:00 UTC (07:30 IST), same invocation
-- pattern as the existing autonomous fleet (heartbeat/workday engines).
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'executive-intelligence-daily') then
    perform cron.schedule('executive-intelligence-daily', '0 2 * * *',
      $cmd$SELECT net.http_post(url := 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/executive-intelligence?secret=<REDACTED>', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"trigger":"cron"}'::jsonb, timeout_milliseconds := 120000)$cmd$);
  end if;
end $$;
