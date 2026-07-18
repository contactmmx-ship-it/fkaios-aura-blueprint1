-- SPRINT 2b (M1-S2b) — schedules founder-brain-tick every 15 minutes.
-- Copies the EXACT pattern already proven in production by
-- 20260629_schedule_agent_heartbeat_cron.sql (net.http_post + cron.schedule)
-- rather than inventing a new scheduling mechanism — one execution system,
-- per the Constitution.
--
-- 15 minutes (not 5, like agent-heartbeat) because every tick makes at least
-- one real LLM call (think()) and up to two more (task-decision + optional
-- createTask reasoning isn't separate, but think() + decision = 2 calls
-- minimum) — 5-minute cadence would be ~24 LLM calls/hour of pure
-- self-reflection with no user request behind any of it. Adjust once real
-- cost data exists.
--
-- NOT APPLIED BY THIS SPRINT. This file is a deliverable for the founder to
-- review and push (`supabase db push` / dashboard) when ready — no deploy
-- credentials exist in this environment, and turning on a new recurring
-- LLM-calling job is exactly the kind of standing decision the founder's
-- own Autonomy Rules reserve for founder approval, not silent activation.

SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'fkaios-founder-brain-tick';

SELECT cron.schedule(
  'fkaios-founder-brain-tick',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/founder-brain-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ybHNxc2hranV1d2lvdnRocm5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4ODM2MjUsImV4cCI6MjA5NzQ1OTYyNX0.fSzGBIvUqhWLsaEzKBdX-y5l8mIxjSz9VQ_yXOMRh4g'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
