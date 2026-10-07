-- Applied in production as version 20260924133942 (fkaios_master_controller_cron).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: ce23833d5dabc294d6790cfbd8382b9b).
-- Record only: do not apply from this folder.

-- Schedules fkaios_master_controller_tick() directly via pg_cron, every 15
-- minutes (matching founder-brain-tick's own cadence). Pure in-database SQL
-- call - no HTTP hop, no edge function redeploy, no Deno runtime dependency,
-- so this cannot fail from an Edge Function cold-start/timeout/auth issue.
-- Same pg_cron mechanism the codebase already trusts for
-- 'fkaios-founder-brain-tick' (cron.job jobid 39) and 'ai-jobs-orphan-reaper'
-- - reused, not a new scheduling mechanism.
select cron.schedule(
  'fkaios-master-controller-tick',
  '*/15 * * * *',
  $$select public.fkaios_master_controller_tick();$$
);
