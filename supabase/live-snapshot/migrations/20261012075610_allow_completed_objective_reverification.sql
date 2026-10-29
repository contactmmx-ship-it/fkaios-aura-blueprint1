-- Applied in production as version 20261012075610 (allow_completed_objective_reverification).
-- Verbatim record exported read-only from supabase_migrations.schema_migrations on 29 Oct 2026. Do not apply from here.

create or replace function public.fkaios_phase_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public, extensions, pg_temp
as $function$
  select p_from = p_to or case p_from
    when 'understanding' then p_to in ('planning','executing','blocked','failed')
    when 'planning'      then p_to in ('executing','blocked','failed')
    when 'executing'     then p_to in ('planning','verifying','blocked','failed')
    when 'verifying'     then p_to in ('rectifying','planning','executing','completed','blocked','failed')
    when 'rectifying'    then p_to in ('executing','verifying','planning','blocked','failed')
    when 'blocked'       then p_to in ('planning','executing','verifying','failed')
    when 'completed'     then p_to = 'verifying'
    else false
  end;
$function$;
