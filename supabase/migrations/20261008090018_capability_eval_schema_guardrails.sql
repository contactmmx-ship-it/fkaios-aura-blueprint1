-- FKAIOS capability-evaluation schema guardrails (re-audit 2026-10-08, docs/FKAIOS_REAUDIT_2026-10-08.md).
--
-- capability_benchmarking_v1 and capability_discovery_v1 were applied to production out of band from
-- unmerged PRs #45/#46 (recorded verbatim in supabase/live-snapshot/migrations). This migration does not
-- adopt those PRs' design. It only closes the schema-level defects the audit found, so nothing written
-- to these tables later can claim more than the evidence supports. No code reads or writes these tables
-- yet (0 benchmark rows, 0 proposals, 3 queued tests), so routing and execution are unaffected.
--
-- 1. capability_test_queue: unique(candidate_id, benchmark_suite, status) allowed only one passed and one
--    failed row per candidate ever, so a candidate could never be re-tested. Replace it with "at most one
--    active (queued or running) test per candidate and suite".
-- 2. capability_benchmarks: a row may be verified=true only if it points at the
--    fkaios_verification_evidence row that verified it. Self-reported "verified" is impossible.
-- 3. capability_adoption_proposals: approve/adopted/rejected require who decided and when, and
--    approve/adopted additionally require the founder approval (approvals row) that authorised it.
-- 4. fkaios_rank_benchmarked_resources: pin search_path; execute for service_role only (it was
--    executable by anon and authenticated).

set local lock_timeout = '5s';

-- 1 ─────────────────────────────────────────────────────────────────────────
alter table public.capability_test_queue
  drop constraint if exists capability_test_queue_candidate_id_benchmark_suite_status_key;
create unique index if not exists capability_test_queue_one_active
  on public.capability_test_queue (candidate_id, benchmark_suite)
  where status in ('queued', 'running');

-- 2 ─────────────────────────────────────────────────────────────────────────
alter table public.capability_benchmarks
  add column if not exists verification_evidence_id uuid
    references public.fkaios_verification_evidence(id) on delete restrict;
alter table public.capability_benchmarks
  drop constraint if exists capability_benchmarks_verified_needs_evidence;
alter table public.capability_benchmarks
  add constraint capability_benchmarks_verified_needs_evidence
    check (not verified or verification_evidence_id is not null);

-- 3 ─────────────────────────────────────────────────────────────────────────
alter table public.capability_adoption_proposals
  add column if not exists approval_id uuid references public.approvals(id) on delete restrict;
alter table public.capability_adoption_proposals
  drop constraint if exists capability_adoption_proposals_decision_recorded;
alter table public.capability_adoption_proposals
  add constraint capability_adoption_proposals_decision_recorded
    check (recommendation not in ('approve', 'adopted', 'rejected')
           or (decided_at is not null and decided_by is not null));
alter table public.capability_adoption_proposals
  drop constraint if exists capability_adoption_proposals_adoption_approved;
alter table public.capability_adoption_proposals
  add constraint capability_adoption_proposals_adoption_approved
    check (recommendation not in ('approve', 'adopted') or approval_id is not null);

-- 4 ─────────────────────────────────────────────────────────────────────────
alter function public.fkaios_rank_benchmarked_resources(uuid, text, text)
  set search_path = public, extensions, pg_temp;
revoke execute on function public.fkaios_rank_benchmarked_resources(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fkaios_rank_benchmarked_resources(uuid, text, text) to service_role;
