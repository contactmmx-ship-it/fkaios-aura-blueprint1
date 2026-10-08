-- FKAIOS governed adoption and rollback (mission 2026-10-08, docs/FKAIOS_AUTONOMY_ARCHITECTURE.md).
-- Routing changes happen only through these two functions, each one atomic,
-- so a task class always has exactly one active policy and every change keeps
-- its reason, evidence, approval and rollback target.

set local lock_timeout = '5s';

-- Adopt: the candidate becomes first for the task class. Requires an
-- approval row that is approved (by the founder, or by a named autonomous
-- policy recorded in decided_by).
create or replace function public.fkaios_adopt_routing(
  p_task_class text, p_resource_ref text, p_proposal_id uuid, p_approval_id uuid,
  p_reason text, p_evidence jsonb, p_monitor_hours integer default 72)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  cur public.fkaios_routing_policies;
  new_id uuid;
  appr_status text;
begin
  select status into appr_status from public.approvals where id = p_approval_id;
  if appr_status is distinct from 'approved' then
    raise exception 'adoption requires an approved approval row (got %)', coalesce(appr_status, 'none');
  end if;
  select * into cur from public.fkaios_routing_policies where task_class = p_task_class and status = 'active' for update;
  if cur.id is not null and cur.resource_refs[1] = p_resource_ref then
    return cur.id; -- already first: idempotent
  end if;
  if cur.id is not null then
    update public.fkaios_routing_policies set status = 'superseded' where id = cur.id;
  end if;
  insert into public.fkaios_routing_policies (task_class, version, resource_refs, status, reason, evidence,
      adoption_proposal_id, approval_id, rollback_to_id, created_by, monitor_until)
  values (p_task_class, coalesce(cur.version, 0) + 1,
      array[p_resource_ref] || coalesce(array_remove(cur.resource_refs, p_resource_ref), array[]::text[]),
      'active', p_reason, coalesce(p_evidence, '{}'::jsonb), p_proposal_id, p_approval_id, cur.id,
      'fkaios_adopt_routing', now() + make_interval(hours => p_monitor_hours))
  returning id into new_id;
  update public.capability_adoption_proposals set recommendation = 'adopted',
      decided_at = coalesce(decided_at, now()),
      decided_by = coalesce(decided_by, (select decided_by from public.approvals where id = p_approval_id)),
      approval_id = p_approval_id
  where id = p_proposal_id;
  update public.model_registry set lifecycle_state = 'adopted', updated_at = now() where resource_ref = p_resource_ref;
  return new_id;
end $$;

-- Roll back: the policy that the active one replaced becomes active again as a
-- new version (history is never rewritten), and the rolled-back resource is
-- marked degraded so it is not adopted again without fresh evidence.
create or replace function public.fkaios_rollback_routing(p_policy_id uuid, p_reason text, p_evidence jsonb)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  cur public.fkaios_routing_policies;
  target public.fkaios_routing_policies;
  new_id uuid;
begin
  select * into cur from public.fkaios_routing_policies where id = p_policy_id and status = 'active' for update;
  if cur.id is null then raise exception 'policy % is not active', p_policy_id; end if;
  if cur.rollback_to_id is null then raise exception 'policy % has no rollback target', p_policy_id; end if;
  select * into target from public.fkaios_routing_policies where id = cur.rollback_to_id;
  update public.fkaios_routing_policies set status = 'rolled_back' where id = cur.id;
  insert into public.fkaios_routing_policies (task_class, version, resource_refs, status, reason, evidence, rollback_to_id, created_by)
  values (cur.task_class, cur.version + 1, target.resource_refs, 'active',
      'Rollback of v' || cur.version || ': ' || p_reason, coalesce(p_evidence, '{}'::jsonb) || jsonb_build_object('rolled_back_policy', cur.id),
      target.rollback_to_id, 'fkaios_rollback_routing')
  returning id into new_id;
  update public.model_registry set lifecycle_state = 'degraded', updated_at = now(),
      metadata = metadata || jsonb_build_object('rolled_back_at', now(), 'rollback_reason', p_reason)
  where resource_ref = cur.resource_refs[1] and not (cur.resource_refs[1] = any(target.resource_refs[1:1]));
  return new_id;
end $$;

revoke execute on function public.fkaios_adopt_routing(text, text, uuid, uuid, text, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.fkaios_rollback_routing(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fkaios_adopt_routing(text, text, uuid, uuid, text, jsonb, integer) to service_role;
grant execute on function public.fkaios_rollback_routing(uuid, text, jsonb) to service_role;
