-- SPRINT 10 (M1-S10) — EXECUTION ENGINE AUDIT FINDING.
-- Not a migration. Nothing here modifies data. Run the SELECT below in the
-- Supabase SQL editor to check the actual state of the execution pipeline.
--
-- WHY THIS MATTERS: migration 20260713005000_opportunity_backlog_and_
-- fabrication_incident.sql documents that on 2026-07-13, cron 23
-- ('job-scheduler-drain') and cron 27 ('ai-engine-run-jobs-5min') were
-- DISABLED after a fabrication incident (ai-engine was faking completed
-- work on LLM failures). The follow-up migration
-- (20260713006000_ai_engine_fabrication_fix_and_reaper.sql) says the fix
-- was "VERIFIED LIVE" — but neither file in this ZIP's migrations folder
-- explicitly re-enables crons 23/27. This sandbox has no Supabase deploy
-- credentials and cannot query cron.job directly, so their CURRENT state
-- is genuinely unknown from here — not assumed either way.
--
-- WHY IT MATTERS FOR WORK ENGINE (Sprint 9) SPECIFICALLY: allocateTask()
-- creates ai_jobs rows for AI Employees to pick up. If cron 27 is still
-- off, nothing ever dequeues those jobs — Work Engine would be assigning
-- work into a queue nobody is draining. Sprint 9's "Work velocity" badge
-- in the Founder Workspace will read 0/24h · 0/7d if this is the case —
-- that's the honest signal to watch for, not a bug in the badge.

-- 1. Check current status of the two crons named in the incident report:
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN ('job-scheduler-drain', 'ai-engine-run-jobs-5min')
   OR jobid IN (23, 27);

-- 2. If `active` is false for either row above, the incident migration's
--    own documented reversal command re-enables them (verbatim from
--    20260713005000_opportunity_backlog_and_fabrication_incident.sql):
--    SELECT cron.alter_job(23, active := true);
--    SELECT cron.alter_job(27, active := true);
--    Only run this after independently confirming the fabrication fix
--    (20260713006000) is deployed and holding — that migration's own
--    "VERIFIED LIVE: 0 new fabrications" note suggests it was tested, but
--    re-verify before flipping a previously-incident-causing cron back on.

-- 3. Separately, confirm the orphan reaper (also from 20260713006000) is
--    still running as intended:
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'ai-jobs-orphan-reaper';
