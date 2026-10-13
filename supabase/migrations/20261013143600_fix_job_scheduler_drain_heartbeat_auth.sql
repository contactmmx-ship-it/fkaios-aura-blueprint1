-- Keep the job-scheduler drain authenticated with the current Vault secret.
-- The old cron URL embedded a copied secret that no longer matched Vault,
-- causing every scheduled drain to return 401 while pg_cron itself reported
-- success (it only reports that the HTTP request was queued).
DO $migration$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'job-scheduler-drain'
  ORDER BY jobid
  LIMIT 1;

  IF v_job_id IS NULL THEN
    RAISE NOTICE 'job-scheduler-drain is not installed; skipping cron command update';
    RETURN;
  END IF;

  PERFORM cron.alter_job(
    v_job_id,
    command := $command$
      SELECT net.http_post(
        url := 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/job-scheduler',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-heartbeat-secret',
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'heartbeat_secret')
        ),
        body := '{"action":"process_pending"}'::jsonb,
        timeout_milliseconds := 60000
      );
    $command$
  );
END
$migration$;
