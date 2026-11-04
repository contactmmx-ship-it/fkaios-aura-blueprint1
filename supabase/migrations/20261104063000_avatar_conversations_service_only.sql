-- 4 Nov 2026: close the avatar_conversations RLS hole (Knowledge Pack §13 step 2).
--
-- Live policy "avatar_conv_authenticated_full" let ANY signed-in user read and
-- write every row (qual: auth.role() = 'authenticated'). The table holds the
-- founder's voice-avatar transcripts and has no user/owner column. Its only
-- reader and writer is the avatar-orchestrator edge function, which uses the
-- service role (supabase/functions/avatar-orchestrator/index.ts lines 164, 285);
-- no frontend code queries it. So access becomes service-role only.
-- Rollback: re-create the dropped policy (definition below).
--   create policy avatar_conv_authenticated_full on public.avatar_conversations
--     for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists avatar_conv_authenticated_full on public.avatar_conversations;
alter table public.avatar_conversations enable row level security;
