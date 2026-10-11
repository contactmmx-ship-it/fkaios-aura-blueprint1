# Outbound Local Inference Bridge

Status: implementation plan; not deployed and not yet end-to-end verified.

## Why this exists

FKAIOS now ranks a configured self-hosted model ahead of cloud-only routing policies. That does not make a Windows-hosted Ollama instance reachable from a Supabase Edge Function: `127.0.0.1` in the hosted function points to the hosted runtime, not Rajeev's PC. Production execution telemetry currently contains no `self_hosted` provider attempts. Local-first ranking is therefore a code capability, not proof of zero-key production execution.

The production database already has `ai_jobs`, `worker_runs`, `worker_handoffs`, `provider_handoffs`, worker-selection/check-in/recovery RPCs, and execution evidence. The worker tables/RPCs currently model delegated coding workers and objective continuation. They are not a durable inference request/response queue and should not be repurposed in a way that confuses model inference with repository-editing work.

## Required topology

```text
FKAIOS Edge Function / LLM router
  | enqueue inference request (server-side service-role access only)
  v
Dedicated durable local-inference queue + atomic lease/claim RPC
  ^  poll/claim + heartbeat + submit result
  | outbound HTTPS initiated by the Windows worker
Windows local worker
  | localhost only
  v
Ollama API (127.0.0.1:11434)
```

The Windows machine opens outbound HTTPS connections only. Ollama remains bound to loopback. No public port forwarding, public Ollama endpoint, paid tunnel, or inbound connection to the PC is part of the design.

## Security boundaries

- Keep the worker credential separate from Supabase service-role credentials. Never ship `SUPABASE_SERVICE_ROLE_KEY` to the PC.
- Worker authentication must be a dedicated high-entropy secret, stored in Windows environment/secret storage and Supabase Edge Function secrets. Support rotation/revocation.
- The worker credential may only claim work assigned to the local-inference queue, heartbeat its own lease, and complete/fail a job it currently owns. It must not read arbitrary FKAIOS tables or create objectives.
- The server creates requests; the worker cannot enqueue arbitrary work using its worker-only credential.
- Claim must be atomic (`FOR UPDATE SKIP LOCKED` or equivalent) and issue a lease token. Completion must match job ID, worker identity, lease token, and active lease.
- Enforce payload/output size limits, model allowlisting, bounded timeouts, maximum attempts, and idempotency keys. Never trust a worker's self-reported completion as objective verification.
- Do not log full prompts, secrets, or model output by default. Store minimal metadata and evidence references.
- Keep high-risk actions and founder approvals on the existing governance path. A local model does not gain additional authority.

## Implementation sequence

1. **Queue contract and migration** — dedicated table, restrictive RLS/grants, atomic claim/heartbeat/complete functions, expiry/requeue rules, indexes, and migration tests. Do not change production schema until reviewed and CI passes.
2. **Worker gateway** — authenticated Edge Function with worker-only actions (claim, heartbeat, complete, fail); fail closed on missing/invalid credentials; rate and payload limits.
3. **Windows worker** — minimal Python standard-library HTTP client or similarly dependency-light service; poll gateway; call local Ollama; return result/evidence; backoff while offline; never auto-download models; never expose port 11434.
4. **Router integration** — for `self_hosted` requests, enqueue through the durable bridge and wait only within a bounded deadline. If worker is offline or times out, record the exact blocker and use the already-approved fallback policy; never fabricate success.
5. **Verification** — mocked contract tests; lease/duplicate/expiry/auth tests; worker smoke test; end-to-end inference on Windows; then a production test with cloud provider keys unavailable to the tested path. Verify `fkaios_execution_steps` records the actual `self_hosted` provider/model and successful evidence.
6. **Operational proof** — show worker heartbeat, queue depth, completed/failed counts, latency, and last verified local inference in the Console. A configured URL alone is not a healthy worker.

## Acceptance criteria

- A job can be claimed by at most one live lease holder.
- Invalid credentials cannot claim, inspect, or complete work.
- Duplicate completion is idempotent or explicitly rejected without corrupting state.
- Expired leases are safely retried within a bounded attempt count.
- Offline worker state is visible and never represented as completed.
- The worker has no service-role credential and Ollama is loopback-only.
- Router integration is tested without paid API calls using mocks.
- Real Windows-to-production inference returns a traceable model/result/evidence record while cloud providers are disabled for the test.
- No zero-key or end-to-end-complete claim is made until the last criterion is met.

## Current observed blockers

- Production has no registered local/Ollama capability entry.
- Existing `worker_runs` history has 7 completed, 1 failed, 3 handed-off, 1 limit-reached, and 7 stalled runs; latest heartbeat in that table is from 2026-10-06. This is separate coding-worker infrastructure, not proof of a live local inference worker.
- Provider health currently records Anthropic credit exhaustion and OpenAI credit exhaustion; Gemini is the only one marked available in the observed snapshot.
- Local-first ranking changes have been deployed, but there are still no production `self_hosted` inference attempts in the telemetry snapshot used for this assessment.

## Safety / deployment policy

This document alone changes no production data, secrets, model routing policy, approval, or deployment. Queue schema, gateway, and router integration should be delivered in separately testable changes and must not be auto-merged or described as deployed until verified.
