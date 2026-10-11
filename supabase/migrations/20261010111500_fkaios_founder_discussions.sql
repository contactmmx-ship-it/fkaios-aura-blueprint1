-- Persistent Founder ↔ AI CEO discussions.
-- Each row belongs to one authenticated founder; all turn history and a proposed
-- execution plan stay together so a discussion can resume across sessions.
-- Direct browser table access is intentionally denied. The authenticated
-- founder-objective Edge Function verifies the user and applies owner filters.
create table if not exists public.founder_discussions (
  id uuid primary key default gen_random_uuid(),
  founder_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New CEO discussion',
  status text not null default 'discussing'
    check (status in ('discussing','thinking','plan_ready','submitting','submitted','closed')),
  messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array'),
  proposed_plan jsonb,
  submitted_objective_id uuid references public.orchestrator_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint founder_discussions_messages_limit check (jsonb_array_length(messages) <= 80)
);

create index if not exists founder_discussions_owner_updated_idx
  on public.founder_discussions (founder_user_id, updated_at desc);

create unique index if not exists founder_discussions_submitted_objective_uidx
  on public.founder_discussions (submitted_objective_id)
  where submitted_objective_id is not null;

alter table public.founder_discussions enable row level security;
revoke all on table public.founder_discussions from anon, authenticated;
grant all on table public.founder_discussions to service_role;

drop policy if exists founder_discussions_service_role_only on public.founder_discussions;
create policy founder_discussions_service_role_only
  on public.founder_discussions for all to service_role
  using (true) with check (true);

comment on table public.founder_discussions is
  'Private, persistent founder/AI-CEO discussion threads and approval-ready execution plans. Access only through the authenticated founder-objective Edge Function.';
