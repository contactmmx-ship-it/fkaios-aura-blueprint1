-- Applied in production as version 20261007102144 (security_close_anonymous_exposure_1_functions).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: fcbc8cbeb64c936b76716d17cb6db075).
-- Record only: do not apply from this folder.

set local lock_timeout = '5s';
do $$
declare
  fn record;
  exposed text[] := array[
    'auto_followup_stage_change','auto_generate_proposal','auto_invoice_onboarding',
    'auto_qualify_new_lead','auto_schedule_meeting','brain_chat_rpc',
    'compute_brain_arbitration','compute_cost_coverage','compute_enterprise_economics',
    'compute_factory_next_action','compute_factory_plan','compute_mission_progress',
    'compute_model_choice','compute_money_chain','compute_next_capability',
    'compute_opportunity_backlog','compute_product_library','compute_revenue_blockers',
    'compute_software_factory','compute_workforce_truth','detect_silences',
    'get_my_consultant_id','get_my_role','handle_new_auth_user','is_admin',
    'log_llm_cost','my_brand_ids','prevent_duplicate_active_orchestration_project',
    'reap_orphaned_ai_jobs','record_enterprise_memory','search_knowledge_documents'
  ];
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proname = any(exposed)
  loop
    execute format('revoke execute on function %s from public, anon', fn.sig);
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
  end loop;
end $$;
