-- Applied in production as version 20260708045902 (project_review_uploads).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 5bfc134c626da5b3240ef08345db26ea).
-- Record only: do not apply from this folder.

-- Real file storage bucket for actual project deliverables (zips, code, PDFs) —
-- separate from Knowledge Vault, which is text-only for semantic search.
insert into storage.buckets (id, name, public) values ('project-submissions', 'project-submissions', false)
on conflict (id) do nothing;

create table if not exists project_submissions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  submission_type text check (submission_type in ('crm','app','website','document','other')) default 'other',
  file_path text not null,
  file_name text not null,
  file_size_bytes bigint,
  ai_review_status text default 'pending' check (ai_review_status in ('pending','reviewing','reviewed','failed')),
  ai_review_summary text,
  ai_review_findings jsonb,
  founder_decision text check (founder_decision in ('approved','rejected','needs_changes')),
  founder_notes text,
  submitted_by uuid,
  created_at timestamptz default now(),
  reviewed_at timestamptz,
  decided_at timestamptz
);
alter table project_submissions enable row level security;
create policy "authenticated users full access" on project_submissions for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated storage access" on storage.objects for all
  using (bucket_id = 'project-submissions' and auth.role() = 'authenticated')
  with check (bucket_id = 'project-submissions' and auth.role() = 'authenticated');
