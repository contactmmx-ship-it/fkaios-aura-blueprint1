-- Background capability tests: only RECENT active objectives take priority (48 h), matching
-- ACTIVE_OBJECTIVE_MAX_AGE_HOURS in _shared/capability-evaluation.ts (PR #207).
-- Why: PR #207 fixed the TypeScript gate, but this database function kept the old rule
-- ("any objective in a processing state blocks every test"). A request abandoned in
-- 'processing' since 24 Sep 2026 therefore still blocked all background tests.
-- Stale requests are left for the objective loop to retire; they just no longer starve evaluation.
create or replace function public.fkaios_claim_background_eval_budget(p_daily_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  v_units integer;
begin
  if p_daily_limit < 1 or p_daily_limit > 10 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_daily_limit');
  end if;

  if exists (
    select 1 from public.orchestrator_requests r
    where r.status in ('submitted', 'processing', 'queued', 'running', 'in_progress')
      and r.created_at >= now() - interval '48 hours'
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'objective_priority');
  end if;

  insert into public.fkaios_background_eval_budget (budget_date, claimed_units)
  values (current_date, 1)
  on conflict (budget_date) do update
    set claimed_units = public.fkaios_background_eval_budget.claimed_units + 1,
        updated_at = now()
    where public.fkaios_background_eval_budget.claimed_units < p_daily_limit
  returning claimed_units into v_units;

  if v_units is null then
    return jsonb_build_object('allowed', false, 'reason', 'daily_background_eval_cap', 'daily_limit', p_daily_limit);
  end if;

  return jsonb_build_object('allowed', true, 'claimed_units', v_units, 'daily_limit', p_daily_limit);
end;
$function$;

revoke all on function public.fkaios_claim_background_eval_budget(integer) from public, anon, authenticated;
grant execute on function public.fkaios_claim_background_eval_budget(integer) to service_role;
