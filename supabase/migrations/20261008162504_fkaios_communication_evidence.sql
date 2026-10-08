-- Provider acknowledgements for approved communications are evidence that may
-- not belong to an objective (e.g. a founder-requested message).
set local lock_timeout = '5s';
alter table public.fkaios_verification_evidence drop constraint if exists fkaios_verification_evidence_objective_required;
alter table public.fkaios_verification_evidence add constraint fkaios_verification_evidence_objective_required
  check (objective_id is not null or requirement_key ~ '^(eval|self_test|communication):');
