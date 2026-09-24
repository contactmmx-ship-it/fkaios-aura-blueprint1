-- Requirement #37: "Successful/failed approaches influence future allocation."
-- fkaios_allocate_task currently ranks capability_registry candidates purely
-- by static fields (availability, then declared priority) - real outcome
-- history in orchestration_task_allocations.status (completed/failed/
-- verification_failed, populated by fkaios_complete_task) never feeds back
-- into who gets picked next time. This closes that loop.
--
-- Design choice, consistent with the capacity-band pattern already shipped
-- this session (fkaios_select_worker's demote-not-exclude rule): a
-- capability with a poor recent track record is demoted in ranking, never
-- excluded outright. A single low-sample-size failure should not lock a
-- capability out forever, and if it is genuinely the only candidate it must
-- still be chosen (matches fkaios_allocate_task's existing no_candidate path
-- being reserved for "nothing matches the tags", not "everything matching
-- has failed before").

create or replace function public.fkaios_capability_reliability(p_capability_name text, p_lookback interval default interval '30 days')
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'capability_name', p_capability_name,
    'lookback_days', extract(day from p_lookback),
    'sample_size', count(*) filter (where status in ('completed', 'failed', 'verification_failed')),
    'completed', count(*) filter (where status = 'completed'),
    'failed', count(*) filter (where status in ('failed', 'verification_failed')),
    'success_rate', case
      when count(*) filter (where status in ('completed', 'failed', 'verification_failed')) = 0 then null
      else round(
        count(*) filter (where status = 'completed')::numeric
        / count(*) filter (where status in ('completed', 'failed', 'verification_failed')),
        3
      )
    end,
    'band', case
      when count(*) filter (where status in ('completed', 'failed', 'verification_failed')) < 3 then 'UNPROVEN'
      when count(*) filter (where status = 'completed')::numeric
           / nullif(count(*) filter (where status in ('completed', 'failed', 'verification_failed')), 0) >= 0.8 then 'RELIABLE'
      when count(*) filter (where status = 'completed')::numeric
           / nullif(count(*) filter (where status in ('completed', 'failed', 'verification_failed')), 0) >= 0.5 then 'MIXED'
      else 'UNRELIABLE'
    end
  )
  from public.orchestration_task_allocations
  where capability_name = p_capability_name
    and decided_at >= now() - p_lookback;
$$;
revoke all on function public.fkaios_capability_reliability(text, interval) from public, anon, authenticated;

-- Both existing overloads get the same ordering change so behavior is
-- consistent regardless of which one a caller resolves to. Signatures are
-- untouched - this is a pure ranking/behavior change, no caller needs to
-- change (fkaios-autonomous-controller.ts's existing call with named args
-- {p_task_id, required_capabilities, p_actual_executor: null} keeps working
-- exactly as before, it just gets better-informed results).

create or replace function public.fkaios_allocate_task(p_task_id uuid, required_capabilities text[])
returns jsonb language plpgsql as $$
declare
  t record;
  candidates jsonb;
  chosen jsonb;
  alloc_id uuid;
  gap_id uuid;
  result_status text;
  reason_text text;
begin
  select id, title, status into t from public.orchestration_tasks where id = p_task_id;
  if t.id is null then raise exception 'FKAIOS: task % does not exist', p_task_id; end if;
  if required_capabilities is null or array_length(required_capabilities, 1) is null then
    raise exception 'FKAIOS: required_capabilities must be a non-empty array - this function matches declared capability tags, it does not guess from free-text title/description';
  end if;

  select coalesce(jsonb_agg(m order by
      (m->>'available_now')::boolean desc,
      (m->>'reliability_band' = 'UNRELIABLE') asc,
      (m->>'priority')::numeric asc
    ), '[]'::jsonb) into candidates from (
    select jsonb_build_object(
      'name', cr.name, 'kind', cr.kind, 'purpose', cr.purpose, 'availability', cr.availability,
      'cost_state', cr.cost_state, 'auth_state', cr.auth_state, 'priority', cr.priority, 'limitations', cr.limitations,
      'available_now', (cr.availability = 'available'),
      'reliability', public.fkaios_capability_reliability(cr.name),
      'reliability_band', public.fkaios_capability_reliability(cr.name) ->> 'band'
    ) as m
    from public.capability_registry cr
    where cr.capabilities && required_capabilities
      and cr.availability in ('available', 'degraded')
      and cr.cost_state <> 'paid_exhausted'
  ) s;

  if jsonb_array_length(candidates) = 0 then
    result_status := 'no_candidate';
    reason_text := 'No capability_registry row is both available/degraded and tagged with any of: ' || array_to_string(required_capabilities, ', ');
    select id into gap_id from public.capability_backlog
      where source_agent = 'fkaios_allocate_task' and capability = array_to_string(required_capabilities, '+') and status = 'proposed'
      order by created_at desc limit 1;
    if gap_id is null then
      insert into public.capability_backlog (capability, engine, gap_type, observed_defect, source_agent, status)
      values (
        array_to_string(required_capabilities, '+'), 'Work Allocation Engine', 'missing',
        'fkaios_allocate_task could not find any available capability_registry row tagged with [' || array_to_string(required_capabilities, ', ') ||
          '] for task "' || t.title || '" (' || p_task_id || ') on ' || to_char(now(), 'YYYY-MM-DD') || '.',
        'fkaios_allocate_task', 'proposed'
      )
      returning id into gap_id;
    end if;
    chosen := null;
  else
    chosen := candidates -> 0;
    result_status := 'allocated';
    reason_text := 'Selected ' || (chosen->>'name') || ' (' || (chosen->>'kind') || '): ' || coalesce(chosen->>'purpose', '') ||
      '. Chosen from ' || jsonb_array_length(candidates) || ' available candidate(s) tagged with [' || array_to_string(required_capabilities, ', ') ||
      '], ranked by availability, then reliability history (' || coalesce(chosen->'reliability'->>'band', 'UNPROVEN') ||
      coalesce(', ' || (chosen->'reliability'->>'success_rate') || ' success rate over ' || (chosen->'reliability'->>'sample_size') || ' past run(s)', '') ||
      '), then priority.';
  end if;

  insert into public.orchestration_task_allocations (task_id, required_capabilities, capability_name, reason, alternatives_considered, status)
  values (
    p_task_id, required_capabilities, chosen->>'name', reason_text,
    case when jsonb_array_length(candidates) > 1 then candidates - 0 else '[]'::jsonb end,
    result_status
  )
  returning id into alloc_id;

  if result_status = 'allocated' and t.status = 'pending' then
    update public.orchestration_tasks set status = 'assigned' where id = p_task_id;
  end if;

  return jsonb_build_object(
    'allocation_id', alloc_id, 'task_id', p_task_id, 'status', result_status,
    'capability_name', chosen->>'name', 'reason', reason_text,
    'reliability', chosen->'reliability',
    'candidates_considered', jsonb_array_length(candidates), 'capability_gap_id', gap_id
  );
end $$;
revoke all on function public.fkaios_allocate_task(uuid, text[]) from public, anon, authenticated;

create or replace function public.fkaios_allocate_task(p_task_id uuid, required_capabilities text[], p_actual_executor text default null::text)
returns jsonb language plpgsql as $$
declare
  t record;
  candidates jsonb;
  chosen jsonb;
  top_choice_name text;
  alloc_id uuid;
  gap_id uuid;
  result_status text;
  reason_text text;
  reassigned boolean := false;
begin
  select id, title, status into t from public.orchestration_tasks where id = p_task_id;
  if t.id is null then raise exception 'FKAIOS: task % does not exist', p_task_id; end if;
  if required_capabilities is null or array_length(required_capabilities, 1) is null then
    raise exception 'FKAIOS: required_capabilities must be a non-empty array - this function matches declared capability tags, it does not guess from free-text title/description';
  end if;

  select coalesce(jsonb_agg(m order by
      (m->>'available_now')::boolean desc,
      (m->>'reliability_band' = 'UNRELIABLE') asc,
      (m->>'priority')::numeric asc
    ), '[]'::jsonb) into candidates from (
    select jsonb_build_object(
      'name', cr.name, 'kind', cr.kind, 'purpose', cr.purpose, 'availability', cr.availability,
      'cost_state', cr.cost_state, 'auth_state', cr.auth_state, 'priority', cr.priority, 'limitations', cr.limitations,
      'available_now', (cr.availability = 'available'),
      'reliability', public.fkaios_capability_reliability(cr.name),
      'reliability_band', public.fkaios_capability_reliability(cr.name) ->> 'band'
    ) as m
    from public.capability_registry cr
    where cr.capabilities && required_capabilities
      and cr.availability in ('available', 'degraded')
      and cr.cost_state <> 'paid_exhausted'
  ) s;

  if jsonb_array_length(candidates) = 0 then
    result_status := 'no_candidate';
    reason_text := 'No capability_registry row is both available/degraded and tagged with any of: ' || array_to_string(required_capabilities, ', ');
    select id into gap_id from public.capability_backlog
      where source_agent = 'fkaios_allocate_task' and capability = array_to_string(required_capabilities, '+') and status = 'proposed'
      order by created_at desc limit 1;
    if gap_id is null then
      insert into public.capability_backlog (capability, engine, gap_type, observed_defect, source_agent, status)
      values (
        array_to_string(required_capabilities, '+'), 'Work Allocation Engine', 'missing',
        'fkaios_allocate_task could not find any available capability_registry row tagged with [' || array_to_string(required_capabilities, ', ') ||
          '] for task "' || t.title || '" (' || p_task_id || ') on ' || to_char(now(), 'YYYY-MM-DD') || '.',
        'fkaios_allocate_task', 'proposed'
      )
      returning id into gap_id;
    end if;
    chosen := null;
  else
    top_choice_name := (candidates -> 0) ->> 'name';
    if p_actual_executor is not null and p_actual_executor <> top_choice_name then
      select m into chosen from jsonb_array_elements(candidates) m where m ->> 'name' = p_actual_executor limit 1;
      if chosen is null then
        raise exception 'FKAIOS: actual_executor % is not an eligible candidate for [%] - unregistered, unavailable, or missing this capability tag. Refusing to silently substitute a worker identity that cannot be verified.',
          p_actual_executor, array_to_string(required_capabilities, ', ');
      end if;
      reassigned := true;
      result_status := 'allocated';
      reason_text := 'Reassigned to ' || p_actual_executor || ' (' || (chosen->>'kind') || '): the calling session declared itself the actual available executor, overriding the static top pick ' || top_choice_name ||
        ' (priority ranking alone does not know which worker session is live right now). ' || coalesce(chosen->>'purpose', '');
    else
      chosen := candidates -> 0;
      result_status := 'allocated';
      reason_text := 'Selected ' || (chosen->>'name') || ' (' || (chosen->>'kind') || '): ' || coalesce(chosen->>'purpose', '') ||
        '. Chosen from ' || jsonb_array_length(candidates) || ' available candidate(s) tagged with [' || array_to_string(required_capabilities, ', ') ||
        '], ranked by availability, then reliability history (' || coalesce(chosen->'reliability'->>'band', 'UNPROVEN') ||
        coalesce(', ' || (chosen->'reliability'->>'success_rate') || ' success rate over ' || (chosen->'reliability'->>'sample_size') || ' past run(s)', '') ||
        '), then priority.';
    end if;
  end if;

  insert into public.orchestration_task_allocations (task_id, required_capabilities, capability_name, actual_executor, reason, alternatives_considered, status)
  values (
    p_task_id, required_capabilities, chosen->>'name', chosen->>'name', reason_text,
    case when jsonb_array_length(candidates) > 1 then candidates - 0 else '[]'::jsonb end,
    result_status
  )
  returning id into alloc_id;

  if result_status = 'allocated' and t.status = 'pending' then
    update public.orchestration_tasks set status = 'assigned' where id = p_task_id;
  end if;

  perform public.fkaios_log_event(null, p_task_id, 'TASK_ALLOCATED', jsonb_build_object('allocation_id', alloc_id, 'capability', chosen->>'name', 'status', result_status, 'reliability_band', chosen->'reliability'->>'band'));
  if reassigned then
    perform public.fkaios_log_event(null, p_task_id, 'TASK_REASSIGNED', jsonb_build_object('allocation_id', alloc_id, 'from', top_choice_name, 'to', p_actual_executor));
  end if;

  return jsonb_build_object(
    'allocation_id', alloc_id, 'task_id', p_task_id, 'status', result_status,
    'capability_name', chosen->>'name', 'actual_executor', coalesce(chosen->>'name', null), 'reassigned', reassigned,
    'reason', reason_text, 'reliability', chosen->'reliability',
    'candidates_considered', jsonb_array_length(candidates), 'capability_gap_id', gap_id
  );
end $$;
revoke all on function public.fkaios_allocate_task(uuid, text[], text) from public, anon, authenticated;
