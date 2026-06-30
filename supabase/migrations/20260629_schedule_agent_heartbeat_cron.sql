-- Wires a real heartbeat: agent-scheduler/tick fires every 5 minutes,
-- so scheduled agents actually run automatically instead of sitting idle.
-- The Authorization header uses the project's anon key (public, same one
-- already embedded in src/lib/supabase.ts) purely to pass Supabase's
-- gateway JWT check; the function itself uses its own service-role
-- access internally for any privileged writes.

SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'fkaios-agent-heartbeat';

SELECT cron.schedule(
  'fkaios-agent-heartbeat',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/agent-scheduler/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ybHNxc2hranV1d2lvdnRocm5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4ODM2MjUsImV4cCI6MjA5NzQ1OTYyNX0.fSzGBIvUqhWLsaEzKBdX-y5l8mIxjSz9VQ_yXOMRh4g'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
