-- FKAIOS CAPABILITY GRAPH V1
-- Extends the existing capability_registry/model_registry rather than creating
-- a second registry. Edges describe how capabilities/resources relate.

create table if not exists public.fkaios_capability_graph_edges (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('capability','model','worker','tool','provider','connector','repository','resource')),
  source_ref text not null,
  relation text not null check (relation in (
    'provides','requires','depends_on','alternative_to','supersedes',
    'compatible_with','incompatible_with','tested_by','used_by'
  )),
  target_type text not null check (target_type in ('capability','model','worker','tool','provider','connector','repository','resource')),
  target_ref text not null,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','proposed','deprecated','rejected')),
  created_by text not null default 'fkaios',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_type, source_ref, relation, target_type, target_ref)
);

create index if not exists idx_cap_graph_source
  on public.fkaios_capability_graph_edges(source_type, source_ref, status);
create index if not exists idx_cap_graph_target
  on public.fkaios_capability_graph_edges(target_type, target_ref, status);
create index if not exists idx_cap_graph_relation
  on public.fkaios_capability_graph_edges(relation, status);

alter table public.fkaios_capability_graph_edges enable row level security;

drop policy if exists fkaios_capability_graph_read on public.fkaios_capability_graph_edges;
create policy fkaios_capability_graph_read
  on public.fkaios_capability_graph_edges for select
  to authenticated using (true);

drop policy if exists fkaios_capability_graph_admin_write on public.fkaios_capability_graph_edges;
create policy fkaios_capability_graph_admin_write
  on public.fkaios_capability_graph_edges for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- Read-only graph traversal helper. It deliberately returns registry metadata
-- plus explicit edges; it does not invent relationships.
create or replace function public.fkaios_get_capability_graph(p_capability text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'capability', p_capability,
    'registry', coalesce((
      select jsonb_agg(to_jsonb(r))
      from public.capability_registry r
      where p_capability = any(r.capabilities)
         or r.name = p_capability
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at)
      from public.fkaios_capability_graph_edges e
      where e.status = 'active'
        and ((e.source_type = 'capability' and e.source_ref = p_capability)
          or (e.target_type = 'capability' and e.target_ref = p_capability))
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.fkaios_get_capability_graph(text) from public, anon;
grant execute on function public.fkaios_get_capability_graph(text) to authenticated;

comment on table public.fkaios_capability_graph_edges is
'Relationship layer over the existing FKAIOS capability/model/worker/tool registries. No duplicate resource registry.';
