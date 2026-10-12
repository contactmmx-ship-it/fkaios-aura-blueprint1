-- Allow an explicitly evidence-audited reopen of a falsely completed project.
-- Normal terminal behavior remains: complete projects cannot be reopened unless
-- the update includes a clear audit marker in error_message.
create or replace function public.trg_fkaios_project_terminal_guard()
returns trigger
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if OLD.status = 'complete' and NEW.status <> 'complete' then
    if NEW.status = 'working'
       and NEW.error_message ilike 'Evidence audit reopened this project:%' then
      return NEW;
    end if;
    NEW.status := 'complete';
  end if;
  return NEW;
end;
$function$;
