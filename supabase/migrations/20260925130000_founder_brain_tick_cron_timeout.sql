-- founder-brain-tick now runs the autonomous controller (LLM classification
-- + ai_model dispatch), so a tick routinely takes longer than pg_net's
-- default 5s. The function kept running server-side, but every cron call
-- was recorded in net._http_response as "Timeout of 5000 ms reached",
-- hiding real failures. Raise the client timeout to 120s. Edits the existing
-- job's command in place so the Authorization header already stored in
-- cron.job is never copied into the repository.
select cron.alter_job(j.jobid, command := replace(j.command,
  'body := ''{}''::jsonb' || E'\n' || '  ) AS request_id',
  'body := ''{}''::jsonb,' || E'\n' || '    timeout_milliseconds := 120000' || E'\n' || '  ) AS request_id'))
from cron.job j
where j.jobname = 'fkaios-founder-brain-tick'
  and j.command not ilike '%timeout_milliseconds%';
