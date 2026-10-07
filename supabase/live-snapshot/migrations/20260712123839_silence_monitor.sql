-- Applied in production as version 20260712123839 (silence_monitor).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: cb2e4e0b609584bbfefc460f1903951e).
-- Record only: do not apply from this folder.

-- SILENCE MONITOR (Blueprint P0.3 / Datadog no-data principle).
-- Every one of FKAIOS's four catastrophic failures was a SILENCE, not an error:
--   the scheduler that never fired (38/41 agents), the qualifier that returned
--   "none found" 251/251 times, enrichment that wrote 0 rows for weeks, and
--   metrics that were never reconciled. None of them raised an error; they
--   simply produced nothing. This function asserts EXPECTED EFFECT and raises
--   an alert when the effect is absent. Reuses founder_notifications (existing
--   table, already surfaced in the UI). No new infrastructure. Idempotent:
--   re-alerts at most once per 12h per condition, so it never spams.
create or replace function public.detect_silences()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alerts int := 0;
  v_rec record;
  v_qualify_runs int;
  v_qualify_scored int;
  v_enrich_runs int;
  v_enrich_yield int;
  v_stale_leads int;
  v_metric_age interval;
begin
  -- helper: only insert if the same title has not fired in the last 12h
  -- (implemented inline per check below)

  ---------------------------------------------------------------------------
  -- 1. DEAD CRON: a pg_cron job that has not succeeded in 24h.
  ---------------------------------------------------------------------------
  for v_rec in
    select j.jobid, j.jobname, j.schedule,
           (select max(rd.end_time) from cron.job_run_details rd
             where rd.jobid = j.jobid and rd.status = 'succeeded') as last_ok
    from cron.job j
    where j.active
  loop
    if v_rec.last_ok is null or v_rec.last_ok < now() - interval '24 hours' then
      if not exists (select 1 from founder_notifications
                     where type = 'silence' and title = 'Cron silent: ' || coalesce(v_rec.jobname, v_rec.jobid::text)
                       and created_at > now() - interval '12 hours') then
        insert into founder_notifications(type, title, detail, department_code)
        values ('silence',
                'Cron silent: ' || coalesce(v_rec.jobname, v_rec.jobid::text),
                format('Job %s (%s) has not succeeded in 24h. Last success: %s. Expected effect not produced.',
                       coalesce(v_rec.jobname, v_rec.jobid::text), v_rec.schedule,
                       coalesce(v_rec.last_ok::text, 'never')),
                'OPS');
        v_alerts := v_alerts + 1;
      end if;
    end if;
  end loop;

  ---------------------------------------------------------------------------
  -- 2. QUALIFIER RAN BUT SCORED NOTHING (the 251/251 failure mode).
  --    Ran >=3 times in 24h yet produced zero completed scoring outcomes.
  ---------------------------------------------------------------------------
  select count(*) filter (where true),
         count(*) filter (where status = 'completed' and coalesce(output_data->>'summary','') ilike '%score%')
    into v_qualify_runs, v_qualify_scored
  from agent_dispatch_log
  where action = 'qualify_leads' and created_at > now() - interval '24 hours';

  if v_qualify_runs >= 3 and v_qualify_scored = 0 then
    if not exists (select 1 from founder_notifications
                   where type='silence' and title='Qualifier producing nothing'
                     and created_at > now() - interval '12 hours') then
      insert into founder_notifications(type, title, detail, department_code)
      values ('silence', 'Qualifier producing nothing',
              format('Lead qualifier ran %s times in 24h and scored 0 leads. This is the exact signature of the historical 251/251 silent failure.', v_qualify_runs),
              'SALES');
      v_alerts := v_alerts + 1;
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 3. ENRICHMENT RAN BUT CAPTURED NO CONTACTS (the 0-rows failure mode).
  ---------------------------------------------------------------------------
  select count(*) into v_enrich_runs
  from execution_log
  where function_name = 'enrichment' and created_at > now() - interval '24 hours';

  select count(*) into v_enrich_yield
  from leads
  where contact_phone is not null and updated_at > now() - interval '24 hours';

  if v_enrich_runs >= 3 and v_enrich_yield = 0 then
    if not exists (select 1 from founder_notifications
                   where type='silence' and title='Enrichment yielding zero contacts'
                     and created_at > now() - interval '12 hours') then
      insert into founder_notifications(type, title, detail, department_code)
      values ('silence', 'Enrichment yielding zero contacts',
              format('Enrichment ran %s times in 24h and captured 0 phone numbers. The free OpenStreetMap source has no coverage for these businesses — a paid contact-data source is required. Leads cannot qualify without contacts.', v_enrich_runs),
              'SALES');
      v_alerts := v_alerts + 1;
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 4. STALLED PIPELINE (ServiceNow SLA principle): leads stuck in 'new' >48h.
  ---------------------------------------------------------------------------
  select count(*) into v_stale_leads
  from leads
  where stage = 'new' and is_active = true and created_at < now() - interval '48 hours';

  if v_stale_leads > 0 then
    if not exists (select 1 from founder_notifications
                   where type='silence' and title='Leads stalled in New'
                     and created_at > now() - interval '12 hours') then
      insert into founder_notifications(type, title, detail, department_code)
      values ('silence', 'Leads stalled in New',
              format('%s leads have sat in stage=new for more than 48h. Nothing is advancing them to revenue.', v_stale_leads),
              'SALES');
      v_alerts := v_alerts + 1;
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 5. METRICS RECONCILIATION STALE (the never-written-rollups failure mode).
  ---------------------------------------------------------------------------
  select now() - max(last_active_at) into v_metric_age from ai_agents where last_active_at is not null;
  if v_metric_age is null or v_metric_age > interval '24 hours' then
    if not exists (select 1 from founder_notifications
                   where type='silence' and title='Agent metrics stale'
                     and created_at > now() - interval '12 hours') then
      insert into founder_notifications(type, title, detail, department_code)
      values ('silence', 'Agent metrics stale',
              'No agent has recorded activity in over 24h (or rollups are not being written). The workforce may be idle or reconciliation may have stopped.',
              'MIS');
      v_alerts := v_alerts + 1;
    end if;
  end if;

  return jsonb_build_object('checked_at', now(), 'alerts_raised', v_alerts);
end;
$$;
