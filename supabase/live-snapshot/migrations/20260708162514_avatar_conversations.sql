-- Applied in production as version 20260708162514 (avatar_conversations).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 8f9f69e73771a1f3a4d846e4d1f9a55b).
-- Record only: do not apply from this folder.


create table if not exists public.avatar_conversations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  turn_number int not null,
  input_mode text not null default 'voice',
  transcript text not null,
  intent text,
  routed_to text,
  action_taken jsonb,
  response_text text,
  audio_generated boolean default false,
  latency_ms int,
  created_at timestamptz default now()
);

create index if not exists avatar_conversations_session_idx on public.avatar_conversations (session_id, turn_number);

alter table public.avatar_conversations enable row level security;
drop policy if exists "avatar_conv_service_role_full" on public.avatar_conversations;
create policy "avatar_conv_service_role_full" on public.avatar_conversations for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "avatar_conv_authenticated_full" on public.avatar_conversations;
create policy "avatar_conv_authenticated_full" on public.avatar_conversations for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
