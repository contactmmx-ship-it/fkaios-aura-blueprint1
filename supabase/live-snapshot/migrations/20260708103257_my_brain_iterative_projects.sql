-- Applied in production as version 20260708103257 (my_brain_iterative_projects).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 0eaff2b278201b13f0f29925c68bc0d8).
-- Record only: do not apply from this folder.

create table if not exists brain_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client_name text,
  deliverable_type text check (deliverable_type in ('video_brief','app_spec','image','document','website','other')) default 'other',
  reference_type text check (reference_type in ('youtube','instagram','doc_upload','text_description','url','none')) default 'none',
  reference_url text,
  reference_text text,
  brief text,
  status text default 'planning' check (status in ('planning','making','reviewing','chief_review','founder_review','approved','rejected','needs_founder_input')),
  current_iteration int default 0,
  max_iterations int default 4,
  final_output text,
  chief_summary text,
  founder_decision text check (founder_decision in ('approved','rejected','needs_changes')),
  founder_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table brain_projects enable row level security;
create policy "authenticated full access" on brain_projects for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists brain_project_iterations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references brain_projects(id) on delete cascade,
  iteration_number int not null,
  maker_output text not null,
  critic_feedback text,
  critic_approved boolean default false,
  created_at timestamptz default now()
);
alter table brain_project_iterations enable row level security;
create policy "authenticated full access" on brain_project_iterations for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
