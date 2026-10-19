-- FKAIOS staged cron auth cutover.
--
-- SAFETY GATE: rotate HEARTBEAT_SECRET for all target Edge Functions. Also set
-- CRON_SECRET to that same new value on executive-intelligence because its live
-- handler resolves CRON_SECRET before HEARTBEAT_SECRET. Store the same NEW value
-- in Vault as fkaios_cron_secret. The secret value is never embedded in this
-- migration or in a cron command. All ten target handlers were verified to
-- accept x-heartbeat-secret before preparing this cutover.
--
-- This migration updates commands only. It preserves job IDs, schedules,
-- HTTP methods, payloads, and timeouts. All changes are transactional; any
-- failed precondition aborts the entire migration before changing a job.

CREATE OR REPLACE FUNCTION public.fkaios_cron_call(
  p_path text,
  p_method text DEFAULT 'POST',
  p_body jsonb DEFAULT '{}'::jsonb,
  p_timeout_ms integer DEFAULT 5000
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_secret text;
  v_secret_count integer;
  v_headers jsonb;
  v_url text;
BEGIN
  IF p_path IS NULL OR p_path NOT IN (
    'agent-scheduler/tick',
    'auto-agents-engine',
    'auto-pilot',
    'opportunity-engine',
    'enrichment',
    'evolution-engine',
    'executive-brain',
    'executive-intelligence',
    'proposal-engine',
    'workday-engine'
  ) THEN
    RAISE EXCEPTION 'Unsupported FKAIOS cron route';
  END IF;

  IF p_method IS NULL OR p_method NOT IN ('GET', 'POST') THEN
    RAISE EXCEPTION 'Unsupported FKAIOS cron method';
  END IF;

  IF p_timeout_ms IS NULL OR p_timeout_ms < 1000 OR p_timeout_ms > 240000 THEN
    RAISE EXCEPTION 'FKAIOS cron timeout is outside the permitted range';
  END IF;

  SELECT count(*)
    INTO v_secret_count
    FROM vault.decrypted_secrets
   WHERE name = 'fkaios_cron_secret'
     AND decrypted_secret IS NOT NULL
     AND decrypted_secret <> '';

  IF v_secret_count <> 1 THEN
    RAISE EXCEPTION 'Vault secret fkaios_cron_secret must exist exactly once and be non-empty';
  END IF;

  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'fkaios_cron_secret';

  v_url := 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/' || p_path;
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-heartbeat-secret', v_secret
  );

  IF p_method = 'GET' THEN
    RETURN net.http_get(
      url := v_url,
      headers := v_headers,
      timeout_milliseconds := p_timeout_ms
    );
  END IF;

  RETURN net.http_post(
    url := v_url,
    headers := v_headers,
    body := COALESCE(p_body, '{}'::jsonb),
    timeout_milliseconds := p_timeout_ms
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fkaios_cron_call(text, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fkaios_cron_call(text, text, jsonb, integer)
  TO postgres;

DO $migration$
DECLARE
  v_expected integer := 16;
  v_found integer;
  v_query_secret_jobs integer;
  v_vault_secret_count integer;
  v_spec record;
  v_job_id bigint;
  v_command text;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE command ~ '\?secret=')
    INTO v_found, v_query_secret_jobs
    FROM cron.job
   WHERE active = true
     AND jobname = ANY (ARRAY[
       'agent-scheduler-5min',
       'auto-agents-daily-report',
       'auto-agents-hunt-leads-at',
       'auto-agents-hunt-leads-fk',
       'auto-agents-qualify',
       'auto-pilot-5min',
       'ceo-think-daily',
       'enrich-new-leads',
       'enterprise-evolution-daily',
       'executive-brain-daily',
       'executive-intelligence-daily',
       'proposal-engine-hourly',
       'workday-ceo',
       'workday-evening',
       'workday-midday',
       'workday-morning'
     ]);

  IF v_found <> v_expected OR v_query_secret_jobs <> v_expected THEN
    RAISE EXCEPTION
      'FKAIOS cron cutover aborted: expected % active query-secret jobs; found % jobs, % still using query secrets',
      v_expected, v_found, v_query_secret_jobs;
  END IF;

  SELECT count(*)
    INTO v_vault_secret_count
    FROM vault.decrypted_secrets
   WHERE name = 'fkaios_cron_secret'
     AND decrypted_secret IS NOT NULL
     AND decrypted_secret <> '';

  IF v_vault_secret_count <> 1 THEN
    RAISE EXCEPTION
      'FKAIOS cron cutover aborted: rotate Edge Function secrets and create exactly one non-empty Vault secret fkaios_cron_secret first';
  END IF;

  FOR v_spec IN
    SELECT *
      FROM (VALUES
        ('agent-scheduler-5min',       'agent-scheduler/tick',       'POST', '{}'::jsonb, 5000),
        ('auto-agents-daily-report',   'auto-agents-engine',         'POST', '{"phase":"daily-report"}'::jsonb, 60000),
        ('auto-agents-hunt-leads-at',  'auto-agents-engine',         'POST', '{"phase":"hunt-leads","company":"aura-tech"}'::jsonb, 60000),
        ('auto-agents-hunt-leads-fk',  'auto-agents-engine',         'POST', '{"phase":"hunt-leads","company":"franchise-kart"}'::jsonb, 60000),
        ('auto-agents-qualify',        'auto-agents-engine',         'POST', '{"phase":"qualify"}'::jsonb, 60000),
        ('auto-pilot-5min',            'auto-pilot',                 'GET',  '{}'::jsonb, 5000),
        ('ceo-think-daily',            'opportunity-engine',         'POST', '{}'::jsonb, 150000),
        ('enrich-new-leads',           'enrichment',                'POST', '{"action":"enrich_new","limit":10}'::jsonb, 90000),
        ('enterprise-evolution-daily', 'evolution-engine',           'POST', '{}'::jsonb, 150000),
        ('executive-brain-daily',      'executive-brain',            'POST', '{}'::jsonb, 150000),
        ('executive-intelligence-daily','executive-intelligence',    'POST', '{"trigger":"cron"}'::jsonb, 240000),
        ('proposal-engine-hourly',     'proposal-engine',            'POST', '{}'::jsonb, 120000),
        ('workday-ceo',                'workday-engine',             'POST', '{"phase":"ceo"}'::jsonb, 120000),
        ('workday-evening',            'workday-engine',             'POST', '{"phase":"evening"}'::jsonb, 120000),
        ('workday-midday',             'workday-engine',             'POST', '{"phase":"midday"}'::jsonb, 120000),
        ('workday-morning',            'workday-engine',             'POST', '{"phase":"morning"}'::jsonb, 120000)
      ) AS spec(job_name, route_path, http_method, body, timeout_ms)
  LOOP
    SELECT jobid
      INTO v_job_id
      FROM cron.job
     WHERE jobname = v_spec.job_name
       AND active = true
     FOR UPDATE;

    IF v_job_id IS NULL THEN
      RAISE EXCEPTION 'FKAIOS cron cutover aborted: active job % disappeared', v_spec.job_name;
    END IF;

    v_command := format(
      'SELECT public.fkaios_cron_call(%L, %L, %L::jsonb, %s);',
      v_spec.route_path,
      v_spec.http_method,
      v_spec.body::text,
      v_spec.timeout_ms
    );

    PERFORM cron.alter_job(v_job_id, command := v_command);
  END LOOP;
END;
$migration$;
