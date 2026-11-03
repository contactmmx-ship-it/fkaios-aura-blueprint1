-- 3 Nov 2026: a high/critical-risk objective the founder APPROVED can complete.
--
-- Why: fkaios_objective_completion_allowed returned false for every contract with
-- risk_level high/critical and founder_approval_required = true, and nothing ever
-- clears that flag after the founder approves. Live: no high/critical objective
-- has ever completed (all are awaiting_approval, failed or processing). GoMax
-- objective 520f871e: approval 6c9c1322 approved at 13:21 UTC; independent
-- verifier passed 12/12 at 14:19 UTC; sources + verification evidence passed;
-- the terminal arbiter still blocked it with
-- "contract_or_deterministic_evidence_gate_failed".
--
-- Change: the risk gate is satisfied when the objective's linked approval
-- (orchestrator_requests.approval_id) has status 'approved' with a decision time.
-- Every other check is unchanged. Rollback: re-create the previous body (the
-- same function without the "and not exists (...)" clause).

create or replace function public.fkaios_objective_completion_allowed(p_objective_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c record;
begin
  select status,acceptance_criteria,evidence_requirements,risk_level,founder_approval_required
    into c
  from public.objective_contracts
  where objective_id=p_objective_id
  order by version desc
  limit 1;

  if not found then return false; end if;
  if c.status <> 'verified' then return false; end if;
  if coalesce(jsonb_array_length(c.acceptance_criteria),0)=0 then return false; end if;
  if coalesce(jsonb_array_length(c.evidence_requirements),0)=0 then return false; end if;
  if not public.fkaios_objective_verification_ready(p_objective_id) then return false; end if;
  if c.risk_level in ('high','critical') and coalesce(c.founder_approval_required,true)
     and not exists (
       select 1
       from public.orchestrator_requests r
       join public.approvals a on a.id = r.approval_id
       where r.id = p_objective_id
         and a.status = 'approved'
         and a.decided_at is not null
     ) then
    return false;
  end if;
  return true;
end;
$function$;
