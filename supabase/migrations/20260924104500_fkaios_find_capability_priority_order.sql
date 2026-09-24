-- Fix: order fkaios_find_capability matches by numeric priority (was text, so "100" sorted before "20").
create or replace function public.fkaios_find_capability(need text)
returns jsonb language plpgsql as $$
declare
  matches jsonb;
  gap_id uuid;
begin
  select coalesce(jsonb_agg(m order by (m->>'priority')::int), '[]'::jsonb) into matches from (
    select jsonb_build_object(
      'name', cr.name, 'kind', cr.kind, 'provider', cr.provider, 'purpose', cr.purpose,
      'capabilities', cr.capabilities, 'availability', cr.availability, 'auth_state', cr.auth_state,
      'cost_state', cr.cost_state, 'limitations', cr.limitations, 'priority', cr.priority
    ) as m
    from public.capability_registry cr
    where cr.name ilike '%' || need || '%'
       or cr.purpose ilike '%' || need || '%'
       or array_to_string(cr.capabilities, ' ') ilike '%' || need || '%'
    order by cr.priority asc
    limit 20
  ) s;

  if jsonb_array_length(matches) = 0 then
    select id into gap_id from public.capability_backlog
      where source_agent = 'fkaios_find_capability' and capability = need and status = 'proposed'
      order by created_at desc limit 1;
    if gap_id is null then
      insert into public.capability_backlog (capability, engine, gap_type, observed_defect, source_agent, status)
      values (
        need, 'FKAIOS_BRAIN', 'missing',
        'fkaios_find_capability(''' || replace(need, '''', '''''') || ''') matched zero of the ' ||
          (select count(*) from public.capability_registry) ||
          ' capability_registry rows on ' || to_char(now(), 'YYYY-MM-DD') ||
          '; no AI, tool, repository or connector currently advertises this capability.',
        'fkaios_find_capability', 'proposed'
      )
      returning id into gap_id;
    end if;
  end if;

  return jsonb_build_object('need', need, 'matches', matches, 'gap_id', gap_id);
end $$;

revoke all on function public.fkaios_find_capability(text) from public, anon, authenticated;
