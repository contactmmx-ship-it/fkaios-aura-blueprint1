-- Applied in production as version 20260710010138 (enterprise_org_structure_phase1).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 3aef3f5418d60d3e3c350dc6cf554df9).
-- Record only: do not apply from this folder.

-- ARTIFICIAL ENTERPRISE PHASE 1 (retry: respects existing company_leadership
-- role constraint ceo/coo/cfo_advisory/cto/department_head — Preservation Law).
create table if not exists board_of_directors (
  id uuid primary key default gen_random_uuid(),
  seat text not null unique,
  holder_type text not null check (holder_type in ('human','ai_system')),
  holder_name text not null,
  authority text not null,
  accountability text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into board_of_directors (seat, holder_type, holder_name, authority, accountability) values
 ('Chairman & Managing Director','human','Rajeev','Final authority: vision, constitution, capital, irreversible actions, external client relationships. Approves; does not operate.','Defines mission and boundaries; reviews founder briefings; answers to no one inside the system.'),
 ('Constitutional Authority','ai_system','governance-engine','Independent review of every governed decision in all domains; can reject any proposal; scores agent intelligence profiles.','Every verdict logged with per-law reasoning in audit trail; its own evolution requires Founder approval (Law 15).'),
 ('Chief Executive Intelligence','ai_system','executive-intelligence','Continuous enterprise cognition: observe, assess, predict, coordinate departments, stage capital (never execute money).','Daily cycles logged with observed state; predictions measured against reality (Law 14); trust earned from prediction accuracy.'),
 ('Founder Proxy & Voice','ai_system','founder-avatar','Interactive second brain: answers as the founder would, delegates tasks, files approvals, reads all business data.','Every turn logged to performance metrics; operates under Founder Intelligence Layer identity; cannot move money.')
on conflict (seat) do nothing;

create table if not exists executive_committee (
  id uuid primary key default gen_random_uuid(),
  role text not null unique,
  holder_agent text not null,
  scope text not null,
  measurable_objective text not null,
  reports_to text not null default 'executive-intelligence',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into executive_committee (role, holder_agent, scope, measurable_objective) values
 ('Chief Sales Officer','sales-engine','Group-wide pipeline: lead qualification, proposals, closing across all subsidiaries.','Move leads out of ''new'' stage; measured by stage-distribution shift in leads table.'),
 ('Chief Financial Officer','finance-engine','Invoicing, receivables, payment tracking. NO autonomous money movement — founder gate absolute.','Invoice cycle time and delivery status; measured from company_invoices.'),
 ('Chief Information Officer','mis-engine','Reporting, data quality, cross-department information flow.','Data-quality issues found and fixed; measured via audit_logs and directive completions.'),
 ('Chief Research Officer','research-engine','Market, competitor and opportunity research feeding the cognition loop.','Research deliverables completed per directive; measured in agent_task_delegations.'),
 ('Chief Communications Officer','pr-engine','External communications, PR campaigns, brand presence.','Campaigns produced per directive; measured in agent_task_delegations.'),
 ('Chief Engineering Officer','builder-engine','Software capability under Engineering Constitution; files proposals before acting.','Zero un-governed changes; measured by engineering_change_proposals compliance.')
on conflict (role) do nothing;

create table if not exists org_units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  unit_name text not null,
  unit_type text not null default 'department' check (unit_type in ('board','executive','department','team')),
  mission text,
  parent_unit_id uuid references org_units(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id, unit_name)
);

insert into org_units (company_id, unit_name, unit_type, mission)
select distinct a.company_id, coalesce(a.department, a.dept), 'department',
  'Department derived from live agent registry; mission to be set by Executive Intelligence directive.'
from ai_agents a
where a.company_id is not null and coalesce(a.department, a.dept) is not null
on conflict (company_id, unit_name) do nothing;

-- company_leadership under EXISTING constraint: ceo/coo/cto at holding level,
-- held by the AI systems as declared functions (agent_id null = system-level).
insert into company_leadership (company_id, agent_id, role, mandate, active)
select 'f6e4e460-ce80-4d9c-a7ba-987682cde600'::uuid, null, x.role, x.mandate, true
from (values
 ('ceo','Group executive function held by executive-intelligence (AI): daily enterprise cognition loop, department coordination, capital staging. Chairman (Rajeev, human) retains all final authority — see board_of_directors.'),
 ('coo','Operations coordination held by agent-scheduler + workday engines (AI): task dispatch, agent workday orchestration across subsidiaries.'),
 ('cto','Engineering function held by builder-engine (AI) under Engineering Constitution: no ungoverned changes.')
) as x(role, mandate)
where not exists (select 1 from company_leadership where company_id='f6e4e460-ce80-4d9c-a7ba-987682cde600');

alter table board_of_directors enable row level security;
alter table executive_committee enable row level security;
alter table org_units enable row level security;
create policy "read board" on board_of_directors for select using (true);
create policy "read exec" on executive_committee for select using (true);
create policy "read org" on org_units for select using (true);
