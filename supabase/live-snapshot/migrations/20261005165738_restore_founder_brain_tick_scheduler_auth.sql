-- Applied in production as version 20261005165738 (restore_founder_brain_tick_scheduler_auth).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 3edff859d6022c11ffb48280e4276d4c).
-- Record only: do not apply from this folder.

do $$
declare
  scheduler_secret text;
begin
  select substring(command from 'secret=([^'' )]+)') into scheduler_secret
  from cron.job
  where jobid = 13
  limit 1;
  if scheduler_secret is null or scheduler_secret = '' then
    raise exception 'Could not recover FKAIOS scheduler secret from existing heartbeat cron job';
  end if;
  perform cron.alter_job(
    39,
    command := format(
      $cmd$SELECT net.http_post(
        url := 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/founder-brain-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-heartbeat-secret', '%s'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );$cmd$,
      scheduler_secret
    )
  );
end $$;
