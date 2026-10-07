-- Applied in production as version 20261006163657 (prevent_duplicate_active_orchestration_projects).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 5915e249e67f7d6131a47548fc43a1fe).
-- Record only: do not apply from this folder.

create or replace function public.prevent_duplicate_active_orchestration_project()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  normalized_request text;
  existing_id uuid;
begin
  if coalesce(new.status, '') not in ('pending','working','running','assigned') then return new; end if;
  normalized_request := lower(regexp_replace(trim(coalesce(new.request, '')), '\s+', ' ', 'g'));
  if normalized_request = '' then return new; end if;
  perform pg_advisory_xact_lock(hashtext(normalized_request));
  select p.id into existing_id
  from public.orchestration_projects p
  where p.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and p.status in ('pending','working','running','assigned')
    and lower(regexp_replace(trim(coalesce(p.request, '')), '\s+', ' ', 'g')) = normalized_request
  order by p.created_at desc limit 1;
  if existing_id is not null then
    raise exception using errcode = '23505',
      message = format('DUPLICATE_ACTIVE_ORCHESTRATION_PROJECT: active project %s already exists for the same request', existing_id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_prevent_duplicate_active_orchestration_project on public.orchestration_projects;
create trigger trg_prevent_duplicate_active_orchestration_project
before insert or update of request, status on public.orchestration_projects
for each row execute function public.prevent_duplicate_active_orchestration_project();
