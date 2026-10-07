-- Applied in production as version 20260707140649 (phase3_proposal_bizmodel_handoff).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 789cd5f2bdd276278a2be89b91dc299c).
-- Record only: do not apply from this folder.

create table if not exists lead_documents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  document_type text not null check (document_type in ('proposal','business_model')),
  content text not null,
  proposed_amount_inr numeric,
  department_code text not null,
  generated_by uuid,
  created_at timestamptz default now()
);
alter table lead_documents enable row level security;
create policy "service role full access" on lead_documents for all using (true) with check (true);
create index if not exists idx_lead_documents_lead on lead_documents(lead_id);
