-- FKAIOS: evaluation evidence without an objective, and production self-tests
-- (mission 2026-10-08, docs/FKAIOS_AUTONOMY_ARCHITECTURE.md).
--
-- 1. Golden-evaluation and self-test evidence belongs to a capability test, not
--    to an objective. objective_id stays mandatory for every other evidence row.
-- 2. fkaios_self_tests: a request row makes the next founder-brain tick run the
--    production self-test scenarios (real model calls through the real code
--    paths) and record the results. No objective is created and no approval
--    gate is touched.

set local lock_timeout = '5s';

alter table public.fkaios_verification_evidence alter column objective_id drop not null;
alter table public.fkaios_verification_evidence drop constraint if exists fkaios_verification_evidence_objective_required;
alter table public.fkaios_verification_evidence add constraint fkaios_verification_evidence_objective_required
  check (objective_id is not null or requirement_key ~ '^(eval|self_test):');

create table if not exists public.fkaios_self_tests (
  id uuid primary key default gen_random_uuid(),
  requested_by text not null,
  status text not null default 'requested' check (status in ('requested','running','passed','failed')),
  results jsonb not null default '[]'::jsonb,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
alter table public.fkaios_self_tests enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fkaios_self_tests' and policyname = 'fkaios_self_tests_read') then
    create policy fkaios_self_tests_read on public.fkaios_self_tests for select to authenticated using (true);
  end if;
end $p$;
