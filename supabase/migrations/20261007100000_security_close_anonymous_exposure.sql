-- FKAIOS security hardening (audit 2026-10-07, docs/FKAIOS_AUDIT_2026-10-07.md §Weakness 2).
--
-- Closes what an anonymous visitor holding the public anon key (shipped in the
-- website bundle) could do through PostgREST. Signed-in users and the service
-- role keep exactly the access they had, so the Console and every edge function
-- (all of which call these objects with the service-role key or as a signed-in
-- user) are unaffected. Verified before writing: no caller uses the anon role.
--
-- 1. SECURITY DEFINER functions executable by anon (advisor lint 0028): revoke
--    EXECUTE from PUBLIC and anon, grant it explicitly to authenticated and
--    service_role. Trigger functions keep firing (EXECUTE is checked when a
--    trigger is created, not when it fires).
-- 2. SECURITY DEFINER views (lint 0010) were fully readable AND writable by
--    anon, bypassing RLS: revoke all anon privileges. authenticated keeps SELECT.
-- 3. Tables without RLS (lint 0013): enable RLS; signed-in users may read;
--    anon loses all privileges. Neither table is referenced by any code.
-- 4. Functions with a mutable search_path (lint 0011): pin it to the value the
--    Supabase roles already use ("public, extensions"), so behaviour is unchanged
--    but can no longer be hijacked by a caller-controlled search_path.
--
-- Applied to production on 2026-10-07 as five smaller migrations (the combined
-- statement hit the API timeout): security_close_anonymous_exposure_1_functions,
-- _2_views, _3a_agent_aliases, _3b_model_registry, _4_search_path. This file is
-- their exact union and is idempotent, so re-applying it is a no-op.

-- 1 ─────────────────────────────────────────────────────────────────────────
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

-- 2 ─────────────────────────────────────────────────────────────────────────
revoke all on table
  public.v_agent_trust_dashboard, public.v_meta_governance,
  public.v_constitution_violations, public.v_governance_dashboard_summary,
  public.v_market_intelligence, public.v_enterprise_knowledge,
  public.v_llm_spend_by_objective, public.v_cost_coverage,
  public.v_model_performance
from anon;

-- 3 ─────────────────────────────────────────────────────────────────────────
alter table public.agent_aliases  enable row level security;
alter table public.model_registry enable row level security;
revoke all on table public.agent_aliases, public.model_registry from anon;
drop policy if exists agent_aliases_authenticated_read on public.agent_aliases;
create policy agent_aliases_authenticated_read on public.agent_aliases
  for select to authenticated using (true);
drop policy if exists model_registry_authenticated_read on public.model_registry;
create policy model_registry_authenticated_read on public.model_registry
  for select to authenticated using (true);

-- 4 ─────────────────────────────────────────────────────────────────────────
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
