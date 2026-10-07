-- Applied in production as version 20261007102429 (security_close_anonymous_exposure_4_search_path).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 41a0ab357214d91db14d74b4be3194c2).
-- Record only: do not apply from this folder.

set local lock_timeout = '5s';
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and (p.proconfig is null or not exists (
            select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
      and p.proname in (
        'get_my_consultant_id','get_my_role','is_admin','my_brand_ids',
        'auto_qualify_new_lead','auto_followup_stage_change','auto_schedule_meeting',
        'auto_generate_proposal','auto_invoice_onboarding','search_knowledge_documents',
        'brain_chat_rpc','match_knowledge_chunks','protect_constitution',
        'enforce_engineering_pipeline','enforce_governed_pipeline','enforce_earned_autonomy',
        'compute_governance_kpis','record_enterprise_memory','reconcile_agent_metrics',
        'fkaios_reject_secrets','fkaios_select_worker','fkaios_worker_step',
        'fkaios_brain_context','fkaios_ingest_knowledge','fkaios_find_capability',
        'fkaios_create_milestones','fkaios_objective_graph','fkaios_allocate_task',
        'fkaios_log_event','fkaios_dispatch_task','fkaios_complete_task',
        'fkaios_acceptance_summary','fkaios_capacity_band',
        'fkaios_generate_continuation_instruction','fkaios_reap_stale_dispatch',
        'fkaios_capability_reliability','fkaios_master_controller_tick',
        'fkaios_recover_worker_run','fkaios_report_worker_limit','fkaios_worker_checkin',
        'fkaios_reconcile_terminal_objective','trg_fkaios_project_terminal_guard',
        'trg_fkaios_task_terminal_guard')
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', fn.sig);
  end loop;
end $$;
