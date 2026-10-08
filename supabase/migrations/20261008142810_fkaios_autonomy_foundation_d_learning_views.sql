-- FKAIOS autonomy foundation, part D (mission 2026-10-08). See part A and docs/FKAIOS_AUTONOMY_ARCHITECTURE.md.

set local lock_timeout = '5s';

-- 8. Learning: verified performance per resource and task class ────────────
-- Only verified or rejected outcomes count (unverified claims never train
-- routing). sample_size lets callers apply a minimum before trusting a score.
create or replace view public.v_fkaios_resource_performance with (security_invoker = true) as
select resource_ref, task_class,
       count(*) filter (where verification_status in ('verified','rejected','partially_verified')) as sample_size,
       count(*) filter (where verification_status = 'verified') as verified_count,
       count(*) filter (where verification_status = 'rejected') as rejected_count,
       avg(quality_score) filter (where verification_status in ('verified','rejected','partially_verified')) as avg_quality,
       count(*) filter (where outcome = 'failed') as failed_attempts,
       count(*) as total_attempts,
       avg(duration_ms) filter (where outcome = 'completed') as avg_latency_ms,
       avg(cost_usd) filter (where outcome = 'completed') as avg_cost_usd,
       max(created_at) as last_seen_at
from public.fkaios_execution_steps
where resource_ref like 'model:%' and created_at > now() - interval '30 days'
group by resource_ref, task_class;

-- 9. Capability graph (derived from tables of record, never hand-maintained) ─
create or replace view public.v_fkaios_capability_graph with (security_invoker = true) as
select 'capability:llm:' || p.task_class as source_ref, 'routed_to' as relation, r as target_ref,
       jsonb_build_object('policy_version', p.version, 'rank', array_position(p.resource_refs, r)) as attributes
from public.fkaios_routing_policies p, unnest(p.resource_refs) r where p.status = 'active'
union all
select m.resource_ref, 'provided_by', 'provider:' || m.provider,
       jsonb_build_object('lifecycle', m.lifecycle_state, 'access', m.access_state, 'health', m.health_status,
                          'context_window', m.context_window, 'cost_in_per_mtok', m.cost_in_per_mtok, 'free_tier', m.free_tier)
from public.model_registry m
union all
select 'capability:llm:' || v.task_class, 'performed_by', v.resource_ref,
       jsonb_build_object('sample_size', v.sample_size, 'verified', v.verified_count, 'avg_quality', v.avg_quality)
from public.v_fkaios_resource_performance v where v.task_class is not null;

grant select on public.v_fkaios_resource_performance, public.v_fkaios_capability_graph to authenticated, service_role;
revoke all on public.v_fkaios_resource_performance, public.v_fkaios_capability_graph from anon;
