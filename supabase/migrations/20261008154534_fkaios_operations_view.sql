-- FKAIOS operations views (mission 2026-10-08, docs/FKAIOS_AUTONOMY_ARCHITECTURE.md).
-- "What is FKAIOS doing right now?" in one place, built only from tables of
-- record. No prompts, outputs or secrets: identities, states, counts, timings.

set local lock_timeout = '5s';

create or replace view public.v_fkaios_operations with (security_invoker = true) as
select
  now() as as_of,
  (select coalesce(jsonb_agg(jsonb_build_object('objective_id', s.objective_id, 'phase', s.phase, 'version', s.state_version,
      'remaining', jsonb_array_length(s.remaining_work), 'completed', jsonb_array_length(s.completed_work),
      'rectification_round', s.rectification_round, 'replans', s.replan_count, 'next_action', s.next_action,
      'verification', s.verification->'passed', 'updated_at', s.updated_at) order by s.updated_at desc), '[]'::jsonb)
   from public.fkaios_objective_state s where s.phase not in ('completed','failed') or s.updated_at > now() - interval '24 hours') as objectives,
  (select jsonb_object_agg(status, n) from (select status, count(*) n from public.ai_jobs where status in ('pending','running','retry') group by status) j) as job_queue,
  (select coalesce(jsonb_agg(jsonb_build_object('resource', resource_ref, 'kind', step_kind, 'outcome', outcome, 'failure', failure_category,
      'switched_from', switched_from_ref, 'task_class', task_class, 'at', created_at) order by created_at desc), '[]'::jsonb)
   from (select * from public.fkaios_execution_steps where created_at > now() - interval '1 hour' order by created_at desc limit 25) e) as recent_steps,
  (select jsonb_build_object('attempts', count(*), 'failed', count(*) filter (where outcome = 'failed'),
      'resource_switches', count(*) filter (where switched_from_ref is not null),
      'verified', count(*) filter (where verification_status = 'verified'), 'rejected', count(*) filter (where verification_status = 'rejected'),
      'tokens_in', sum(input_tokens), 'tokens_out', sum(output_tokens), 'cost_usd', round(coalesce(sum(cost_usd), 0)::numeric, 4),
      'avg_latency_ms', round(avg(duration_ms) filter (where outcome = 'completed')))
   from public.fkaios_execution_steps where created_at > now() - interval '24 hours') as last_24h,
  (select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'status', status, 'until', unavailable_until, 'reason', failure_category)), '[]'::jsonb)
   from public.provider_health_state) as providers,
  (select coalesce(jsonb_agg(jsonb_build_object('resource', resource_ref, 'health', health_status, 'until', unavailable_until, 'failure', last_failure_category)), '[]'::jsonb)
   from public.model_registry where unavailable_until > now()) as resources_cooling_down,
  (select jsonb_object_agg(lifecycle_state, n) from (select lifecycle_state, count(*) n from public.model_registry group by lifecycle_state) r) as registry_lifecycle,
  (select coalesce(jsonb_agg(jsonb_build_object('test', q.id, 'candidate', c.resource_key, 'status', q.status, 'attempt', q.attempt,
      'lease_until', q.lease_expires_at, 'error', q.last_error, 'result', q.evidence->'result') order by q.requested_at desc), '[]'::jsonb)
   from (select * from public.capability_test_queue order by requested_at desc limit 10) q
   left join public.capability_discovery_candidates c on c.id = q.candidate_id) as evaluation_queue,
  (select coalesce(jsonb_agg(jsonb_build_object('task_class', task_class, 'version', version, 'top', resource_refs[1], 'by', created_by,
      'monitor_until', monitor_until, 'effective_at', effective_at) order by task_class), '[]'::jsonb)
   from public.fkaios_routing_policies where status = 'active') as routing,
  (select coalesce(jsonb_agg(jsonb_build_object('task_class', p.task_class, 'version', p.version, 'status', p.status, 'reason', left(p.reason, 200), 'at', p.created_at) order by p.created_at desc), '[]'::jsonb)
   from (select * from public.fkaios_routing_policies where version > 1 order by created_at desc limit 10) p) as routing_changes,
  (select coalesce(jsonb_agg(jsonb_build_object('proposal', id, 'candidate', candidate_resource_key, 'incumbent', incumbent_resource_key,
      'recommendation', recommendation, 'candidate_score', candidate_score, 'incumbent_score', incumbent_score, 'decided_by', decided_by) order by created_at desc), '[]'::jsonb)
   from (select * from public.capability_adoption_proposals order by created_at desc limit 10) a) as adoption,
  (select jsonb_build_object('at', created_at, 'outcome', outcome, 'summary', selection - 'new_models') from public.fkaios_execution_steps
   where step_kind = 'discovery' order by created_at desc limit 1) as last_discovery;

grant select on public.v_fkaios_operations to authenticated, service_role;
revoke all on public.v_fkaios_operations from anon;
