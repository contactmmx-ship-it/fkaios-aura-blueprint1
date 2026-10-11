-- Durable queue for local model inference. This is deliberately separate from
-- ai_jobs (business/task execution) and worker_handoffs (coding-worker transfer).
create table if not exists public.fkaios_local_inference_jobs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  request_payload jsonb not null,
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'completed', 'failed')),
  worker_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  result_payload jsonb,
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint fkaios_local_inference_result_state check (
    (status = 'completed' and result_payload is not null and completed_at is not null)
    or status <> 'completed'
  )
);

create index if not exists fkaios_local_inference_queue_idx
  on public.fkaios_local_inference_jobs (created_at)
  where status = 'queued';

create index if not exists fkaios_local_inference_lease_idx
  on public.fkaios_local_inference_jobs (lease_expires_at)
  where status = 'claimed';

alter table public.fkaios_local_inference_jobs enable row level security;
revoke all on public.fkaios_local_inference_jobs from anon, authenticated;
grant select, insert, update on public.fkaios_local_inference_jobs to service_role;

-- Claim is atomic: concurrent workers cannot receive the same unexpired lease.
create or replace function public.fkaios_claim_local_inference_jobs(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 90
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  claimed jsonb;
begin
  if p_worker_id is null or length(trim(p_worker_id)) < 3 or length(p_worker_id) > 120 then
    raise exception 'invalid worker id';
  end if;
  if p_limit < 1 or p_limit > 3 then raise exception 'claim limit must be 1..3'; end if;
  if p_lease_seconds < 15 or p_lease_seconds > 300 then raise exception 'lease must be 15..300 seconds'; end if;

  update public.fkaios_local_inference_jobs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         worker_id = null, lease_token = null, lease_expires_at = null,
         error_code = case when attempts >= max_attempts then 'lease_expired_max_attempts' else error_code end,
         error_detail = case when attempts >= max_attempts then 'Lease expired; maximum attempts reached' else error_detail end,
         completed_at = case when attempts >= max_attempts then now() else completed_at end,
         updated_at = now()
   where status = 'claimed' and lease_expires_at < now();

  with candidates as (
    select id
      from public.fkaios_local_inference_jobs
     where status = 'queued' and attempts < max_attempts
     order by created_at
     for update skip locked
     limit p_limit
  ), updated as (
    update public.fkaios_local_inference_jobs j
       set status = 'claimed',
           worker_id = p_worker_id,
           lease_token = gen_random_uuid(),
           lease_expires_at = now() + make_interval(secs => p_lease_seconds),
           attempts = j.attempts + 1,
           result_payload = null,
           error_code = null,
           error_detail = null,
           completed_at = null,
           updated_at = now()
      from candidates c
     where j.id = c.id
     returning j.id, j.idempotency_key, j.request_payload, j.worker_id,
               j.lease_token, j.lease_expires_at, j.attempts, j.max_attempts
  )
  select coalesce(jsonb_agg(to_jsonb(updated) order by updated.id), '[]'::jsonb)
    into claimed from updated;

  return claimed;
end;
$$;

create or replace function public.fkaios_heartbeat_local_inference_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_lease_seconds integer default 90
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  expiry timestamptz;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 300 then raise exception 'lease must be 15..300 seconds'; end if;
  update public.fkaios_local_inference_jobs
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where id = p_job_id and status = 'claimed' and worker_id = p_worker_id
     and lease_token = p_lease_token and lease_expires_at > now()
   returning lease_expires_at into expiry;
  if expiry is null then return jsonb_build_object('ok', false, 'reason', 'lease_not_owned_or_expired'); end if;
  return jsonb_build_object('ok', true, 'lease_expires_at', expiry);
end;
$$;

create or replace function public.fkaios_complete_local_inference_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_result_payload jsonb default null,
  p_error_code text default null,
  p_error_detail text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  j public.fkaios_local_inference_jobs;
begin
  select * into j from public.fkaios_local_inference_jobs where id = p_job_id for update;
  if j.id is null then return jsonb_build_object('ok', false, 'reason', 'job_not_found'); end if;

  -- Repeated completion from the same lease is idempotent.
  if j.status = 'completed' and j.worker_id = p_worker_id and j.lease_token = p_lease_token then
    return jsonb_build_object('ok', true, 'status', 'completed', 'idempotent', true);
  end if;
  if j.status <> 'claimed' or j.worker_id <> p_worker_id or j.lease_token <> p_lease_token
     or j.lease_expires_at is null or j.lease_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'lease_not_owned_or_expired');
  end if;

  if p_result_payload is not null then
    if octet_length(p_result_payload::text) > 1000000 then raise exception 'result payload exceeds 1 MB'; end if;
    update public.fkaios_local_inference_jobs
       set status = 'completed', result_payload = p_result_payload,
           error_code = null, error_detail = null, completed_at = now(), updated_at = now()
     where id = p_job_id;
    return jsonb_build_object('ok', true, 'status', 'completed');
  end if;

  update public.fkaios_local_inference_jobs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         error_code = left(coalesce(p_error_code, 'worker_error'), 120),
         error_detail = left(coalesce(p_error_detail, 'Worker returned no result'), 2000),
         worker_id = null, lease_token = null, lease_expires_at = null,
         completed_at = case when attempts >= max_attempts then now() else null end,
         updated_at = now()
   where id = p_job_id
   returning * into j;
  return jsonb_build_object('ok', true, 'status', j.status, 'attempts', j.attempts);
end;
$$;

revoke all on function public.fkaios_claim_local_inference_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.fkaios_heartbeat_local_inference_job(uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.fkaios_complete_local_inference_job(uuid, text, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.fkaios_claim_local_inference_jobs(text, integer, integer) to service_role;
grant execute on function public.fkaios_heartbeat_local_inference_job(uuid, text, uuid, integer) to service_role;
grant execute on function public.fkaios_complete_local_inference_job(uuid, text, uuid, jsonb, text, text) to service_role;
