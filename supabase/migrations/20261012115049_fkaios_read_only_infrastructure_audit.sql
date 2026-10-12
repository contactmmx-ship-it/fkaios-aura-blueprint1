-- Read-only evidence for database infrastructure audits. This is deliberately
-- scoped to PostgreSQL catalogs and pg_cron; it does not claim UI or CRM proof.
create or replace function public.fkaios_infrastructure_audit()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_table_checks jsonb;
  v_function_checks jsonb;
  v_cron_checks jsonb;
  v_rls_checks jsonb;
begin
  select jsonb_build_object(
    'scanned_at', now(),
    'method', 'aggregate scan of PostgreSQL catalogs across every public base/partitioned table',
    'total', count(*),
    'rls_enabled', count(*) filter (where c.relrowsecurity),
    'rls_forced', count(*) filter (where c.relforcerowsecurity),
    'rls_disabled_count', count(*) filter (where not c.relrowsecurity),
    'rls_disabled_tables', coalesce(jsonb_agg(c.relname) filter (where not c.relrowsecurity), '[]'::jsonb)
  )
  into v_table_checks
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p');

  select jsonb_build_object(
    'scanned_at', now(),
    'method', 'aggregate scan of all public SQL functions',
    'total', count(*),
    'security_definer_count', count(*) filter (where p.prosecdef),
    'security_definer_without_fixed_search_path_count',
      count(*) filter (where p.prosecdef and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg ilike 'search_path=%'
      )),
    'security_definer_without_fixed_search_path',
      coalesce(jsonb_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')
        filter (where p.prosecdef and not exists (
          select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg ilike 'search_path=%'
        )), '[]'::jsonb),
    'anon_executable_count', count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')),
    'authenticated_executable_count', count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  )
  into v_function_checks
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f';

  select jsonb_agg(jsonb_build_object(
    'jobid', j.jobid, 'jobname', j.jobname, 'schedule', j.schedule, 'active', j.active,
    'last_run_at', r.start_time, 'last_run_status', r.status,
    'last_run_message', left(coalesce(r.return_message,''), 300)
  ) order by j.jobid)
  into v_cron_checks
  from cron.job j
  left join lateral (
    select d.start_time, d.status, d.return_message
    from cron.job_run_details d where d.jobid = j.jobid
    order by d.start_time desc limit 1
  ) r on true;

  select jsonb_build_object(
    'scanned_at', now(),
    'method', 'aggregate scan of pg_policies joined to all public base/partitioned tables',
    'tables_with_rls', count(*) filter (where c.relrowsecurity),
    'tables_with_rls_and_policy', count(distinct (n.nspname, c.relname)) filter (where c.relrowsecurity and pol.tablename is not null),
    'tables_with_rls_but_no_policy_count', count(*) filter (where c.relrowsecurity and coalesce(pol.policy_count,0)=0),
    'tables_with_rls_but_no_policy', coalesce(jsonb_agg(c.relname) filter (where c.relrowsecurity and coalesce(pol.policy_count,0)=0), '[]'::jsonb),
    'policy_count', (select count(*) from pg_policies where schemaname='public')
  )
  into v_rls_checks
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  left join lateral (
    select count(*) as policy_count, min(p.tablename) as tablename
    from pg_policies p where p.schemaname=n.nspname and p.tablename=c.relname
  ) pol on true
  where n.nspname='public' and c.relkind in ('r','p');

  return jsonb_build_object(
    'checked_at', now(),
    'audit_scope_complete', true,
    'scope', 'Database catalog audit only: public tables and RLS flags, public SQL function inventory/security-definer search_path, public RLS policy coverage, and all configured pg_cron jobs with their most recent recorded run. Does not audit every Edge Function implementation, application UI route, external CRM integration, or business outcome.',
    'table_checks', jsonb_build_array(v_table_checks),
    'function_checks', jsonb_build_array(v_function_checks),
    'cron_checks', coalesce(v_cron_checks,'[]'::jsonb),
    'rls_checks', jsonb_build_array(v_rls_checks),
    'counts', jsonb_build_object(
      'public_tables', (v_table_checks->>'total')::integer,
      'public_functions', (v_function_checks->>'total')::integer,
      'cron_jobs', jsonb_array_length(coalesce(v_cron_checks,'[]'::jsonb))
    )
  );
end;
$function$;

revoke all on function public.fkaios_infrastructure_audit() from public;
revoke all on function public.fkaios_infrastructure_audit() from anon;
revoke all on function public.fkaios_infrastructure_audit() from authenticated;
grant execute on function public.fkaios_infrastructure_audit() to service_role;
