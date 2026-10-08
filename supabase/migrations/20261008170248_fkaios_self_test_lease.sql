-- Self-tests run one scenario per founder-brain tick so a run never exceeds the
-- edge runtime's background time limit (a 7-scenario run was killed after
-- ~145 s on 8 Oct 2026). lease_until keeps overlapping ticks from running the
-- same scenario; an expired lease means the previous worker died and the next
-- tick resumes from the first scenario without a result.
set local lock_timeout = '5s';
alter table public.fkaios_self_tests add column if not exists lease_until timestamptz;
