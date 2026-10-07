-- Applied in production as version 20260712130959 (silence_monitor_v2).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 2de21cdc703cd2d808cf5f0d1dd91f08).
-- Record only: do not apply from this folder.

-- SILENCE MONITOR v2 (Blueprint: "Silence Equals Failure"; Datadog no-data +
-- IBM Watson AIOps incident-grouping principles).
-- v1 caught 5 classes. v2 adds the 4 classes that could still hide a failure:
--   6. BROKEN AUTOMATION  — an edge function whose recent runs are majority errors
--   7. ZERO CONVERSION    — the pipeline processes leads but converts none (stage stuck)
--   8. AGING APPROVAL     — a decision has waited on the Founder > 48h (ServiceNow SLA)
--   9. DEAD PIPELINE STAGE— a stage that should emit a successor object and never does
-- Reuses founder_notifications. Idempotent (1 alert / condition / 12h). No new tables.
create or replace function public.detect_silences()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alerts int := 0;
  v_rec record;
  v_qualify_runs int; v_qualify_scored int;
  v_enrich_runs int;  v_enrich_yield int;
  v_stale_leads int;  v_metric_age interval;
  v_scored int; v_advanced int;
  v_aging_approvals int;
begin
  -- helper as inline guard: raise only if same title not fired in 12h
  ---------------------------------------------------------------- 1. DEAD CRON
  for v_rec in
    select j.jobid, j.jobname, j.schedule,
           (select max(rd.end_time) from cron.job_run_details rd
             where rd.jobid = j.jobid and rd.status = 'succeeded') as last_ok
    from cron.job j where j.active
  loop
    if v_rec.last_ok is null or v_rec.last_ok < now() - interval '24 hours' then
      if not exists (select 1 from founder_notifications where type='silence'
                     and title = 'Cron silent: ' || coalesce(v_rec.jobname, v_rec.jobid::text)
                     and created_at > now() - interval '12 hours') then
        insert into founder_notifications(type, title, detail, department_code)
        values ('silence', 'Cron silent: ' || coalesce(v_rec.jobname, v_rec.jobid::text),
                format('Job %s (%s) has not succeeded in 24h. Last success: %s. Expected effect not produced.',
                       coalesce(v_rec.jobname, v_rec.jobid::text), v_rec.schedule, coalesce(v_rec.last_ok::text,'never')),
                'OPS');
        v_alerts := v_alerts + 1;
      end if;
    end if;
  end loop;

  ------------------------------------------------------- 2. QUALIFIER SILENT
  select count(*), count(*) filter (where status='completed' and coalesce(output_data->>'summary','') ilike '%score%')
    into v_qualify_runs, v_qualify_scored
  from agent_dispatch_log where action='qualify_leads' and created_at > now() - interval '24 hours';
  if v_qualify_runs >= 3 and v_qualify_scored = 0 then
    if not exists (select 1 from founder_notifications where type='silence' and title='Qualifier producing nothing' and created_at > now() - interval '12 hours') then
      insert into founder_notifications(type,title,detail,department_code)
      values ('silence','Qualifier producing nothing',
        format('Lead qualifier ran %s times in 24h and scored 0 leads. This is the signature of the historical 251/251 silent failure.', v_qualify_runs),'SALES');
      v_alerts := v_alerts + 1;
    end if;
  end if;

  ------------------------------------------------------ 3. ENRICHMENT SILENT
  select count(*) into v_enrich_runs from execution_log
   where function_name='enrichment' and created_at > now() - interval '24 hours';
  select count(*) into v_enrich_yield from leads
   where contact_phone is not null and updated_at > now() - interval '24 hours';
  if v_enrich_runs >= 3 and v_enrich_yield = 0 then
    if not exists (select 1 from founder_notifications where type='silence' and title='Enrichment yielding zero contacts' and created_at > now() - interval '12 hours') then
      insert into founder_notifications(type,title,detail,department_code)
      values ('silence','Enrichment yielding zero contacts',
        format('Enrichment ran %s times in 24h and captured 0 phone numbers. The free OpenStreetMap source has no coverage for these businesses — a paid contact-data source is required. Leads cannot qualify without contacts.', v_enrich_runs),'SALES');
      v_alerts := v_alerts + 1;
    end if;
  end if;

  --------------------------------------------------------- 4. STALLED LEADS
  select count(*) into v_stale_leads from leads
   where stage='new' and is_active=true and created_at < now() - interval '48 hours';
  if v_stale_leads > 0 then
    if not exists (select 1 from founder_notifications where type='silence' and title='Leads stalled in New' and created_at > now() - interval '12 hours') then
      insert into founder_notifications(type,title,detail,department_code)
      values ('silence','Leads stalled in New',
        format('%s leads have sat in stage=new for more than 48h. Nothing is advancing them to revenue.', v_stale_leads),'SALES');
      v_alerts := v_alerts + 1;
    end if;
  end if;

  --------------------------------------------------------- 5. METRICS STALE
  select now() - max(last_active_at) into v_metric_age from ai_agents where last_active_at is not null;
  if v_metric_age is null or v_metric_age > interval '24 hours' then
    if not exists (select 1 from founder_notifications where type='silence' and title='Agent metrics stale' and created_at > now() - interval '12 hours') then
      insert into founder_notifications(type,title,detail,department_code)
      values ('silence','Agent metrics stale',
        'No agent has recorded activity in over 24h (or rollups are not being written). The workforce may be idle or reconciliation may have stopped.','MIS');
      v_alerts := v_alerts + 1;
    end if;
  end if;

  ------------------------------------------------ 6. BROKEN AUTOMATION (NEW)
  -- An engine whose recent runs are majority failures is broken but not silent-
  -- looking; surface it before it rots. (Datadog: alert on symptom, not cause.)
  for v_rec in
    select function_name,
           count(*) as runs,
           count(*) filter (where status in ('error','failed')) as errs
    from execution_log
    where created_at > now() - interval '24 hours'
    group by function_name
    having count(*) >= 3
       and count(*) filter (where status in ('error','failed')) * 2 > count(*)
  loop
    if not exists (select 1 from founder_notifications where type='silence'
                   and title = 'Automation failing: ' || v_rec.function_name
                   and created_at > now() - interval '12 hours') then
      insert into founder_notifications(type,title,detail,department_code)
      values ('silence','Automation failing: ' || v_rec.function_name,
        format('%s of %s runs failed in the last 24h. This automation is broken, not merely idle.', v_rec.errs, v_rec.runs),'OPS');
      v_alerts := v_alerts + 1;
    end if;
  end loop;

  ------------------------------------------------- 7. ZERO CONVERSION (NEW)
  -- The pipeline is scoring leads but converting none. Salesforce principle:
  -- leads that never convert are not a pipeline, and that must be loud.
  select count(*) filter (where lead_score is not null),
         count(*) filter (where stage <> 'new')
    into v_scored, v_advanced
  from leads where is_active = true;
  if v_scored >= 10 and v_advanced = 0 then
    if not exists (select 1 from founder_notifications where type='silence' and title='Zero conversion' and created_at > now() - interval '12 hours') then
      insert into founder_notifications(type,title,detail,department_code)
      values ('silence','Zero conversion',
        format('%s leads have been scored and NONE has advanced beyond stage=new. The qualification bar is never met — the lead source is producing unqualifiable material.', v_scored),'SALES');
      v_alerts := v_alerts + 1;
    end if;
  end if;

  ----------------------------------------------- 8. AGING APPROVAL (NEW)
  -- ServiceNow SLA principle: a decision waiting on a human past its deadline
  -- is a breach that must escalate, not sit quietly in a queue.
  select count(*) into v_aging_approvals from approvals
   where status='pending' and created_at < now() - interval '48 hours';
  if v_aging_approvals > 0 then
    if not exists (select 1 from founder_notifications where type='silence' and title='Approvals aging' and created_at > now() - interval '12 hours') then
      insert into founder_notifications(type,title,detail,department_code)
      values ('silence','Approvals aging',
        format('%s decision(s) have waited on the Founder for more than 48h. The enterprise is blocked on you.', v_aging_approvals),'EXECUTIVE');
      v_alerts := v_alerts + 1;
    end if;
  end if;

  ------------------------------------------ 9. DEAD COMMERCIAL STAGE (NEW)
  -- Successor law: a stage that holds objects but has never emitted its
  -- successor object is a dead end. Invoices with zero payments, etc.
  if (select count(*) from company_invoices) > 0
     and (select count(*) from company_invoices where coalesce(amount_received_inr,0) > 0) = 0 then
    if not exists (select 1 from founder_notifications where type='silence' and title='Invoices never paid' and created_at > now() - interval '12 hours') then
      insert into founder_notifications(type,title,detail,department_code)
      values ('silence','Invoices never paid',
        'Invoices exist but not one payment has ever been received. The commercial chain terminates before revenue.','FINANCE');
      v_alerts := v_alerts + 1;
    end if;
  end if;

  return jsonb_build_object('checked_at', now(), 'alerts_raised', v_alerts, 'version', 2);
end;
$$;
