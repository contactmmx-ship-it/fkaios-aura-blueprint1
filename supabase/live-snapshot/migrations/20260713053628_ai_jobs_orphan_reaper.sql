-- Applied in production as version 20260713053628 (ai_jobs_orphan_reaper).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: bb341f9a6f16eaf4e6ba854039264187).
-- Record only: do not apply from this folder.

-- ORPHAN REAPER for ai_jobs.
-- Exposed the moment fabrication was removed: 4,010 jobs sit in status='running',
-- the oldest since 2026-07-06 — a full WEEK. ai-engine marks a job 'running', then
-- the edge function hits its wall-clock limit mid-loop and dies. Nothing ever moves
-- the job again. It is neither done nor failed, so NOTHING REPORTS IT. A job that
-- can hang forever without anyone noticing is the same silent-failure class as a
-- fabricated completion: the enterprise believes work is in progress that is dead.
--
-- The reaper marks any job stuck 'running' beyond 15 minutes as failed, with its
-- real cause. Retries are allowed twice; after that it stays failed and is visible.
CREATE OR REPLACE FUNCTION public.reap_orphaned_ai_jobs()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reaped int; v_requeued int;
BEGIN
  -- Under the retry ceiling: put it back in the queue honestly.
  WITH r AS (
    UPDATE ai_jobs SET status = 'pending', retry_count = COALESCE(retry_count,0) + 1,
           error = 'Reaped: job was stuck in running (worker died or timed out). Requeued.',
           updated_at = now()
    WHERE status = 'running' AND updated_at < now() - interval '15 minutes'
      AND COALESCE(retry_count, 0) < 2
    RETURNING 1
  ) SELECT count(*) INTO v_requeued FROM r;

  -- Over the ceiling: it FAILS. It does not linger pretending to work.
  WITH f AS (
    UPDATE ai_jobs SET status = 'failed',
           error = 'Reaped: stuck in running past the retry ceiling. The worker died or timed out repeatedly. This job did NOT complete.',
           updated_at = now()
    WHERE status = 'running' AND updated_at < now() - interval '15 minutes'
      AND COALESCE(retry_count, 0) >= 2
    RETURNING 1
  ) SELECT count(*) INTO v_reaped FROM f;

  RETURN jsonb_build_object('requeued', v_requeued, 'failed', v_reaped, 'reaped_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.reap_orphaned_ai_jobs() FROM public;
GRANT EXECUTE ON FUNCTION public.reap_orphaned_ai_jobs() TO service_role, authenticated;

-- Run every 10 minutes. No secret, no HTTP — pure SQL, so it cannot fail the way
-- the fabricating HTTP path did.
SELECT cron.schedule('ai-jobs-orphan-reaper', '*/10 * * * *', $cron$SELECT public.reap_orphaned_ai_jobs();$cron$);
