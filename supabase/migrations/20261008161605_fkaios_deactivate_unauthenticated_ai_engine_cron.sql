-- ai-engine-run-jobs-5min posts to ai-engine without any auth header and has
-- failed with HTTP 401 every 5 minutes. founder-brain-tick already drains the
-- ai-engine queue every minute with auth, so this job only produces failures.
-- Deactivated (not deleted): re-enable with
--   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'ai-engine-run-jobs-5min'), active := true);
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'ai-engine-run-jobs-5min'), active := false);
