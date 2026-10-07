-- Applied in production as version 20260708162504 (audit_governance_upgrade).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: a90c437f9c36775cc52f54d28e7ab2d9).
-- Record only: do not apply from this folder.


alter table public.audit_logs
  add column if not exists actor_type text default 'agent',
  add column if not exists agent_id uuid references public.ai_agents(id),
  add column if not exists autonomy_level int,
  add column if not exists principle_ids uuid[],
  add column if not exists decision_reasoning text,
  add column if not exists requires_human_review boolean default false,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

create index if not exists audit_logs_review_idx on public.audit_logs (requires_human_review) where requires_human_review = true;
create index if not exists audit_logs_agent_idx on public.audit_logs (agent_id);
