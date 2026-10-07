-- Applied in production as version 20260922103554 (schedule_founder_brain_tick_cron).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 003d80930120d5a2b48caa95217886de).
-- Record only: do not apply from this folder.

SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'fkaios-founder-brain-tick';

SELECT cron.schedule(
  'fkaios-founder-brain-tick',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/founder-brain-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || '<REDACTED_JWT>'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
