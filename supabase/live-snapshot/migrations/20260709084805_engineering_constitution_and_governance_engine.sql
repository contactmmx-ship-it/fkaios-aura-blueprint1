-- Applied in production as version 20260709084805 (engineering_constitution_and_governance_engine).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 10379bd5178c0724a037f199762c8553).
-- Record only: do not apply from this folder.

-- ENGINEERING CONSTITUTION & GOVERNANCE ENGINE
-- Hard enforcement layer: the mandatory pipeline is a DB state machine.
-- Agents cannot skip stages, self-approve, replace without evidence, or
-- delete audit history — Postgres rejects the transaction itself.

-- 1. The immutable constitution
create table if not exists engineering_constitution (
  id uuid primary key default gen_random_uuid(),
  law_number integer not null unique,
  name text not null,
  description text not null,
  immutable boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function protect_constitution() returns trigger language plpgsql as $$
begin
  if old.immutable then
    raise exception 'ENGINEERING CONSTITUTION: law #% (%) is immutable and cannot be modified or deleted. New laws may only be added.', old.law_number, old.name;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
create trigger trg_protect_constitution before update or delete on engineering_constitution
  for each row execute function protect_constitution();

insert into engineering_constitution (law_number, name, description) values
 (1,'Preserve before Replace','Existing functionality, architecture, workflows, integrations, UI/UX, business logic and UX are business assets. Default: Preserve -> Enhance -> Integrate -> Extend. Replacement only with architectural evidence proving it unavoidable.'),
 (2,'Backward Compatibility','No change may break existing consumers, APIs, schemas, or user workflows without an explicit migration path.'),
 (3,'Architectural Consistency','Changes must fit the established architecture and patterns of the platform, not fork them.'),
 (4,'Security','No change may weaken authentication, authorization, RLS, secret handling, or data protection.'),
 (5,'Scalability','Changes must not introduce bottlenecks that block growth of agents, users, or data.'),
 (6,'Performance','Changes must not materially degrade latency or cost without documented justification.'),
 (7,'Maintainability','Code must remain understandable, documented, and modifiable by future agents and humans.'),
 (8,'Founder Vision Alignment','Every change must serve the Autonomous Self-Evolving Business Operating System vision and founder principles.'),
 (9,'Knowledge Preservation','Institutional knowledge must be captured; learnings written back to organisational memory.'),
 (10,'Business Value','Every change must state its business impact; engineering for its own sake is rejected.'),
 (11,'Regression Prevention','Existing behaviour must be verified unbroken after implementation; regressions block completion.')
on conflict (law_number) do nothing;

-- 2. The pipeline state machine (permanent audit trail)
create table if not exists engineering_change_proposals (
  id uuid primary key default gen_random_uuid(),
  proposing_agent text not null,
  target_module text not null,
  change_type text not null check (change_type in ('enhance','integrate','extend','fix','replace')),
  status text not null default 'draft' check (status in ('draft','understanding','preservation_analysis','validation','review','approved','rejected','executing','verifying','completed','rolled_back')),
  why_required text,
  understanding_report text,
  preservation_analysis jsonb,
  constitution_validation jsonb,
  simulation_notes text,
  reviewer_agent text,
  review_verdict text check (review_verdict in ('approved','rejected','needs_redesign')),
  review_reasoning text,
  verification_results jsonb,
  rollback_strategy text,
  business_impact text,
  risks text,
  learned text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function enforce_engineering_pipeline() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'ENGINEERING CONSTITUTION: proposals must begin at draft. The cognitive cycle cannot be entered mid-way.';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'ENGINEERING CONSTITUTION: the audit trail is permanent. Proposals can be rejected or rolled back, never deleted.';
  end if;
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
    raise exception 'ENGINEERING CONSTITUTION: illegal stage transition % -> %. Understand -> Preserve -> Analyse -> Validate -> Review -> Implement -> Verify -> Learn: no stage may be skipped.', old.status, new.status;
  end if;

  if new.status='preservation_analysis' and (new.understanding_report is null or length(new.understanding_report) < 80) then
    raise exception 'ENGINEERING CONSTITUTION: Understanding Phase incomplete — a substantive Current Understanding Report is required first.';
  end if;
  if new.status='validation' and new.preservation_analysis is null then
    raise exception 'ENGINEERING CONSTITUTION: Preservation Analysis (exists/unchanged/enhanced/integrated/extended/replaced) required before validation.';
  end if;
  if new.status='validation' and new.change_type='replace' and coalesce(new.preservation_analysis->>'replacement_evidence','') = '' then
    raise exception 'ENGINEERING CONSTITUTION: Law 1 — replacement requires architectural evidence in preservation_analysis.replacement_evidence.';
  end if;
  if new.status='review' and (new.constitution_validation is null or new.rollback_strategy is null or new.why_required is null) then
    raise exception 'ENGINEERING CONSTITUTION: constitution self-validation, rollback strategy, and why_required must be documented before independent review.';
  end if;
  if new.status='approved' then
    if new.review_verdict is distinct from 'approved' or new.reviewer_agent is null then
      raise exception 'ENGINEERING CONSTITUTION: approval requires an independent reviewer verdict.';
    end if;
    if new.reviewer_agent = new.proposing_agent then
      raise exception 'ENGINEERING CONSTITUTION: no agent may approve its own work.';
    end if;
  end if;
  if new.status='completed' and (new.verification_results is null or new.learned is null) then
    raise exception 'ENGINEERING CONSTITUTION: Verify and Learn stages are mandatory — verification_results and learned entry required before completion.';
  end if;
  new.updated_at = now();
  return new;
end; $$;
create trigger trg_enforce_pipeline before insert or update or delete on engineering_change_proposals
  for each row execute function enforce_engineering_pipeline();

alter table engineering_constitution enable row level security;
alter table engineering_change_proposals enable row level security;
create policy "founder read constitution" on engineering_constitution for select
  using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name='founder'));
create policy "founder all proposals" on engineering_change_proposals for all
  using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name='founder'));
create index if not exists idx_ecp_status on engineering_change_proposals(status, created_at desc);

-- 3. Make the pipeline known to every agent via runtime principle injection
insert into founder_principles (principle, category, applies_to, source, weight, active)
select 'ENGINEERING GOVERNANCE PIPELINE (mandatory): no agent may generate or modify code directly. Every change goes through engineering_change_proposals: draft -> understanding -> preservation_analysis -> validation -> review (independent governance-engine, never self-approval) -> approved -> executing -> verifying -> completed, with rollback strategy, verification results and a learning entry. The database enforces this; attempts to skip stages are rejected.', 'engineering_governance', array['*'], 'Founder directive 2026-07-09: Engineering Constitution', 10, true
where not exists (select 1 from founder_principles where principle like 'ENGINEERING GOVERNANCE PIPELINE%');
