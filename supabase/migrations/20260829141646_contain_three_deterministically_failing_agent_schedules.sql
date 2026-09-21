-- Applied directly to production on 2026-08-29 (version 20260829141646) and
-- imported into the repo during the FKAIOS production-fix pass to close the
-- drift between deployed migration history and this repo.
--
-- CONTAINMENT (not a permanent fix) for 3 agents diagnosed this session as
-- deterministically, permanently failing:
--
-- 1. Meeting Scheduler AI (SCHEDULE_MEETING) — ai-engine's
--    NO_PERSISTENCE_JOB_TYPES rejects this job type before any LLM call.
--    Zero cost, but has failed 100% of the time since 2026-07-27 and cannot
--    succeed until real persistence is built.
-- 2. Sales Executive AI (GENERATE_PROPOSAL) — same NO_PERSISTENCE_JOB_TYPES
--    rejection, same permanent-failure state.
-- 3. Accounts Manager AI (Aura Tech) (GENERATE_INVOICE) — this one DOES call
--    the LLM (real cost) before failing on missing payload.lead_id, because
--    its schedule is a generic "workday reporting" trigger with no lead
--    context. This has been the priority cost leak.
--
-- This migration only sets these 3 agent_schedules rows to is_active=false.
-- No code changed, no data deleted, no other agent affected. Reversible by
-- setting is_active back to true on these same 3 schedule_ids.
--
-- NOTE (production-fix pass, follow-on): GENERATE_PROPOSAL and
-- SCHEDULE_MEETING now have a real capability path (ai-engine calls
-- proposal-engine / meeting-scheduler for jobs that carry a real lead_id),
-- but these 3 schedules specifically feed a generic, lead-less trigger —
-- reactivating them requires a business decision about what payload they
-- should carry, which is outside this pass's scope. Left paused.
UPDATE agent_schedules
SET is_active = false
WHERE id IN (
  'f6aa54fa-660c-47c0-b9e5-950a0ead3d3a', -- Meeting Scheduler AI
  '421ed6f9-f73a-4eec-8f58-0f10561a53a5', -- Sales Executive AI
  '84edd49e-9a3e-4065-902b-d62e05cf4728'  -- Accounts Manager AI (Aura Tech)
);
