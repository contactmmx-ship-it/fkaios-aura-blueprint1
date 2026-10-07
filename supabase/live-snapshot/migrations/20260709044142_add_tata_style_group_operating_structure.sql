-- Applied in production as version 20260709044142 (add_tata_style_group_operating_structure).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 7b3600c470539496e24de9c995dfbea5).
-- Record only: do not apply from this folder.

-- Tata-style group operating model:
-- Bhavishya Associates = holding (Tata Sons role); each company = group company
-- with its own AI CEO and departments; client projects run a TCS-style
-- delivery lifecycle (lead -> proposal -> SOW -> execution phases with teams
-- and deadlines -> QA -> management review -> delivered), with the MD (Rajeev)
-- observing and approving at review gates, not executing.

create table if not exists company_leadership (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  agent_id uuid references ai_agents(id),
  role text not null check (role in ('ceo','coo','cfo_advisory','cto','department_head')),
  mandate text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists client_projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  lead_id uuid references leads(id),
  client_name text not null,
  title text not null,
  scope text,
  contract_value_inr numeric,
  status text not null default 'lead' check (status in (
    'lead','proposal','negotiation','sow_signed','execution','qa','management_review','delivered','closed','lost'
  )),
  deadline date,
  owning_department text,
  md_review_notes text,
  md_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references client_projects(id) on delete cascade,
  phase_number integer not null,
  name text not null,
  owner_agent text,
  due_date date,
  status text not null default 'planned' check (status in ('planned','in_progress','blocked','done','skipped')),
  deliverable text,
  result_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_team_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references client_projects(id) on delete cascade,
  agent_name text not null,
  project_role text not null,
  assigned_at timestamptz not null default now()
);

alter table company_leadership enable row level security;
alter table client_projects enable row level security;
alter table project_phases enable row level security;
alter table project_team_assignments enable row level security;
create policy "founder all company_leadership" on company_leadership for all
  using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name = 'founder'));
create policy "founder all client_projects" on client_projects for all
  using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name = 'founder'));
create policy "founder all project_phases" on project_phases for all
  using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name = 'founder'));
create policy "founder all project_team" on project_team_assignments for all
  using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name = 'founder'));
create index if not exists idx_client_projects_status on client_projects(status, deadline);
create index if not exists idx_project_phases_project on project_phases(project_id, phase_number);
