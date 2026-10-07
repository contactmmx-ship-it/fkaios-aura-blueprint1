-- Applied in production as version 20260709085407 (universal_cognitive_governance_framework).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: a3c646a65851d19a5181855331b39d4f).
-- Record only: do not apply from this folder.

-- UNIVERSAL COGNITIVE GOVERNANCE FRAMEWORK
-- Extends (never replaces) the Engineering Constitution into the Supreme
-- Constitutional Authority governing EVERY autonomous decision in FKAIOS.

-- 1. New constitutional laws (adding is permitted; existing laws stay immutable)
insert into engineering_constitution (law_number, name, description) values
 (12,'Universal Governance','Every autonomous decision in every domain — engineering, strategy, product, sales, marketing, finance, hiring, operations, agent behaviour, workflows, automation, knowledge, memory, self-improvement, prompt evolution, model selection, infrastructure — is a Governed Decision and must pass the constitutional pipeline. Source: Founder directive 2026-07-09.'),
 (13,'Earned Autonomy','Autonomy is earned through demonstrated reliability recorded in agent intelligence profiles, never granted by default. Authority rises only with evidence.'),
 (14,'Outcome Verification','No autonomous action is complete until its real-world outcome is measured against the expected outcome, deviations analysed, lessons extracted into organisational memory, and future decision weights adjusted.'),
 (15,'Governed Self-Evolution','The Governance Framework may improve itself only through its own constitutional pipeline, with versioning, benchmarking, rollback capability and explicit Founder approval. Uncontrolled self-modification is forbidden.')
on conflict (law_number) do nothing;

-- 2. Universal governed decisions (all domains; engineering table preserved as domain implementation #1)
create table if not exists governed_decisions (
  id uuid primary key default gen_random_uuid(),
  domain text not null check (domain in ('engineering','business_strategy','product','sales','marketing','finance','hiring','operations','agent_behavior','workflow','automation','knowledge','memory_evolution','self_improvement','self_learning','prompt_evolution','model_selection','infrastructure','governance_evolution')),
  proposing_agent text not null,
  title text not null,
  change_type text not null default 'create' check (change_type in ('enhance','integrate','extend','fix','replace','create','adjust')),
  status text not null default 'draft' check (status in ('draft','understanding','preservation_analysis','validation','review','approved','rejected','executing','verifying','completed','rolled_back')),
  why_required text,
  understanding_report text,
  preservation_analysis jsonb,
  constitution_validation jsonb,
  simulation_notes text,
  business_justification text,
  vision_alignment text,
  expected_outcome text,
  reviewer_agent text,
  review_verdict text check (review_verdict in ('approved','rejected','needs_redesign')),
  review_reasoning text,
  verification_results jsonb,
  actual_outcome text,
  deviation_analysis text,
  lessons text,
  decision_weight_adjustment text,
  rollback_strategy text,
  risks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function enforce_governed_pipeline() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'GOVERNANCE: decisions must begin at draft; the cycle cannot be entered mid-way.'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'GOVERNANCE: the decision record is permanent. Reject or roll back, never erase.'; end if;
  if new.status = old.status then new.updated_at = now(); return new; end if;
  if not (
    (old.status='draft' and new.status='understanding') or
    (old.status='understanding' and new.status='preservation_analysis') or
    (old.status='preservation_analysis' and new.status='validation') or
    (old.status='validation' and new.status='review') or
    (old.status='review' and new.status in ('approved','rejected')) or
    (old.status='approved' and new.status='executing') or
    (old.status='executing' and new.status='verifying') or
    (old.status='verifying' and new.status in ('completed','rolled_back')) or
    (old.status='rejected' and new.status='draft') or
    (old.status='completed' and new.status='rolled_back')
  ) then
    raise exception 'GOVERNANCE: illegal transition % -> %. Understand -> Preserve -> Govern -> Validate -> Simulate -> Execute -> Verify -> Learn -> Improve -> Evolve: no stage may be skipped.', old.status, new.status;
  end if;
  if new.status='preservation_analysis' and (new.understanding_report is null or length(new.understanding_report) < 80) then
    raise exception 'GOVERNANCE: substantive Understanding Report required first.';
  end if;
  if new.status='validation' and new.preservation_analysis is null then
    raise exception 'GOVERNANCE: Preservation Analysis required before validation.';
  end if;
  if new.status='validation' and new.change_type='replace' and coalesce(new.preservation_analysis->>'replacement_evidence','')='' then
    raise exception 'GOVERNANCE: Law 1 — replacement requires architectural evidence.';
  end if;
  if new.status='review' and (new.constitution_validation is null or new.rollback_strategy is null or new.why_required is null
      or coalesce(length(new.business_justification),0) < 50 or coalesce(length(new.vision_alignment),0) < 50 or new.expected_outcome is null) then
    raise exception 'GOVERNANCE: review requires constitution self-validation, rollback strategy, why_required, Business Justification (>=50 chars), Vision Alignment (>=50 chars) and expected_outcome.';
  end if;
  if new.status='approved' then
    if new.review_verdict is distinct from 'approved' or new.reviewer_agent is null then
      raise exception 'GOVERNANCE: approval requires an independent reviewer verdict.';
    end if;
    if new.reviewer_agent = new.proposing_agent then
      raise exception 'GOVERNANCE: no agent may approve its own decision.';
    end if;
  end if;
  if new.status='completed' and (new.verification_results is null or new.actual_outcome is null or new.deviation_analysis is null or new.lessons is null) then
    raise exception 'GOVERNANCE: Law 14 — completion requires verification_results, actual_outcome, deviation_analysis and lessons.';
  end if;
  new.updated_at = now();
  return new;
end; $$;
create trigger trg_enforce_governed_pipeline before insert or update or delete on governed_decisions
  for each row execute function enforce_governed_pipeline();

-- 3. Agent Intelligence Profiles — autonomy is earned
create table if not exists agent_intelligence_profiles (
  agent_name text primary key,
  role text,
  authority_level integer not null default 0,
  knowledge_scope text,
  available_tools text[],
  total_decisions integer not null default 0,
  successful_decisions integer not null default 0,
  failed_decisions integer not null default 0,
  success_rate numeric,
  confidence_history jsonb not null default '[]',
  failure_history jsonb not null default '[]',
  learning_progress text,
  collaboration_quality numeric,
  governance_score numeric not null default 0.5,
  trust_level text not null default 'probation' check (trust_level in ('probation','trusted','veteran','constitutional')),
  updated_at timestamptz not null default now()
);

insert into agent_intelligence_profiles (agent_name, role, knowledge_scope)
select name, coalesce(department, dept, 'unassigned'), 'inherited from ai_agents registry; reliability unproven — starts at probation'
from ai_agents on conflict (agent_name) do nothing;

insert into agent_intelligence_profiles (agent_name, role, trust_level, knowledge_scope, governance_score)
values
 ('founder-avatar','Founder second brain','trusted','full business DB (read-only), web search, fleet memory, delegation, approvals, WhatsApp', 0.7),
 ('governance-engine','Supreme Constitutional Authority — independent reviewer','constitutional','constitution, founder principles, all governed decisions', 0.9)
on conflict (agent_name) do update set role = excluded.role, trust_level = excluded.trust_level, knowledge_scope = excluded.knowledge_scope;

create or replace function enforce_earned_autonomy() returns trigger language plpgsql as $$
declare t text; allowed integer;
begin
  if new.autonomy_level is distinct from old.autonomy_level and coalesce(new.autonomy_level,0) > coalesce(old.autonomy_level,0) then
    select trust_level into t from agent_intelligence_profiles where agent_name = new.name;
    if t is null then
      raise exception 'GOVERNANCE Law 13: autonomy is earned. Agent "%" has no intelligence profile — demonstrate reliability first.', new.name;
    end if;
    allowed := case t when 'probation' then 2 when 'trusted' then 3 when 'veteran' then 4 when 'constitutional' then 5 else 0 end;
    if new.autonomy_level > allowed then
      raise exception 'GOVERNANCE Law 13: autonomy is earned, not granted. Agent "%" trust level "%" permits max autonomy %, requested %.', new.name, t, allowed, new.autonomy_level;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_earned_autonomy on ai_agents;
create trigger trg_earned_autonomy before update on ai_agents
  for each row execute function enforce_earned_autonomy();

-- 4. Governance KPIs — historical, computed ONLY from real data (no fake numbers)
create table if not exists governance_kpis (
  id uuid primary key default gen_random_uuid(),
  kpi text not null,
  value numeric not null,
  evidence jsonb,
  measured_at timestamptz not null default now()
);

create or replace function compute_governance_kpis() returns void language plpgsql as $$
declare n bigint; v numeric;
begin
  select count(*), avg(case when success then 1.0 else 0 end)*100 into n, v from agent_performance_metrics;
  if n > 0 then insert into governance_kpis(kpi, value, evidence) values ('autonomous_success_rate', round(v,2), jsonb_build_object('sample_size', n, 'source', 'agent_performance_metrics')); end if;

  select count(*), avg(case when review_verdict='approved' then 1.0 else 0 end)*100 into n, v from (
    select review_verdict from engineering_change_proposals where review_verdict is not null
    union all
    select review_verdict from governed_decisions where review_verdict is not null) x;
  if n > 0 then insert into governance_kpis(kpi, value, evidence) values ('decision_approval_rate', round(v,2), jsonb_build_object('reviewed_decisions', n)); end if;

  select count(*), avg(case when status='completed' then 1.0 else 0 end)*100 into n, v from (
    select status from engineering_change_proposals where status in ('completed','rolled_back')
    union all
    select status from governed_decisions where status in ('completed','rolled_back')) x;
  if n > 0 then insert into governance_kpis(kpi, value, evidence) values ('execution_accuracy', round(v,2), jsonb_build_object('finished_decisions', n)); end if;

  select count(*), avg(governance_score)*100 into n, v from agent_intelligence_profiles where total_decisions > 0;
  if n > 0 then insert into governance_kpis(kpi, value, evidence) values ('founder_alignment_score', round(v,2), jsonb_build_object('agents_with_history', n)); end if;

  select count(*), avg(case when lessons is not null then 1.0 else 0 end)*100 into n, v from governed_decisions where status='completed';
  if n > 0 then insert into governance_kpis(kpi, value, evidence) values ('learning_effectiveness', round(v,2), jsonb_build_object('completed_decisions', n)); end if;
end; $$;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'governance-kpi-daily') then
    perform cron.schedule('governance-kpi-daily', '30 1 * * *', 'select compute_governance_kpis()');
  end if;
end $$;

-- 5. Meta-Governance Layer — one continuous watchtower over every layer
create or replace view v_meta_governance as
select 'pending_decisions' as metric, domain as dimension, count(*)::numeric as value from governed_decisions where status not in ('completed','rejected','rolled_back') group by domain
union all
select 'engineering_pipeline', status, count(*)::numeric from engineering_change_proposals group by status
union all
select 'agent_trust', trust_level, count(*)::numeric from agent_intelligence_profiles group by trust_level
union all
select 'kpi_latest:'||kpi, null, value from (select distinct on (kpi) kpi, value from governance_kpis order by kpi, measured_at desc) latest
union all
select 'audit_awaiting_human_review', null, count(*)::numeric from audit_logs where requires_human_review = true and reviewed_by is null;

alter table governed_decisions enable row level security;
alter table agent_intelligence_profiles enable row level security;
alter table governance_kpis enable row level security;
create policy "founder all governed_decisions" on governed_decisions for all
  using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name='founder'));
create policy "founder all agent_profiles" on agent_intelligence_profiles for all
  using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name='founder'));
create policy "founder read kpis" on governance_kpis for select
  using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name='founder'));
create index if not exists idx_gd_status on governed_decisions(status, domain, created_at desc);
create index if not exists idx_gkpi on governance_kpis(kpi, measured_at desc);

-- 6. The permanent override principle, injected into every agent at runtime
insert into founder_principles (principle, category, applies_to, source, weight, active)
select 'SUPREME CONSTITUTIONAL AUTHORITY: FKAIOS is not building autonomous software — it is building an autonomous organisation. Every autonomous decision in every domain is a Governed Decision passing the constitutional pipeline with Business Justification and Vision Alignment toward the Autonomous Self-Evolving Business OS and Zero AI Company. Autonomy is earned via intelligence profiles, never granted. No action is complete until actual outcome is verified against expected. The permanent cycle: Understand -> Preserve -> Govern -> Validate -> Simulate -> Execute -> Verify -> Learn -> Improve -> Evolve. Never bypass it. Governance itself evolves only through this same pipeline with Founder approval.', 'constitutional_authority', array['*'], 'Founder directive 2026-07-09: Universal Cognitive Governance', 10, true
where not exists (select 1 from founder_principles where category = 'constitutional_authority');
