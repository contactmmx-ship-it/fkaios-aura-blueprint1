-- Applied in production as version 20260629021749 (schedule_agent_heartbeat_cron).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 69833b1133656864bb02d38b758e0dd8).
-- Record only: do not apply from this folder.


SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'fkaios-agent-heartbeat';

SELECT cron.schedule(
  'fkaios-agent-heartbeat',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/agent-scheduler/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || '<REDACTED_JWT>'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
