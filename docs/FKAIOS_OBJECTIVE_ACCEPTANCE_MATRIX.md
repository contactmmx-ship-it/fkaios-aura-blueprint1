# FKAIOS Objective Acceptance Matrix

**Purpose:** prove end-to-end founder-objective execution with durable evidence, not merely a successful HTTP response, scheduled invocation, model response, or deployment.

**Safety:** run only against a dedicated, low-risk, no-spend test objective. Do not send real external communications, incur paid-provider charges, change production schema, perform destructive writes, or rotate production credentials as part of this test. Obtain explicit approval for any action outside that boundary.

## Evidence required for every run

Record:
- UTC start/end time and test-case ID
- objective/request ID and contract version
- task, job, and agent-run IDs, linked by correlation/idempotency key
- artifact URL/path and SHA-256 hash (if the test expects an artifact)
- independent verifier decision and reason
- retry/rework count and configured limit
- terminal status and any approval record
- before/after timestamps proving durable state changed for this test

Redact credentials and personal data. Store IDs and sanitized error categories, not raw secrets or full sensitive error strings.

## Acceptance cases

| ID | Scenario | Expected behavior | Required pass evidence |
|---|---|---|---|
| OBJ-01 | No-spend happy path | Request is planned, action is executed, artifact is persisted, and an independent verifier evaluates it | Correlated objective/task/job/run IDs; retrievable artifact; matching SHA-256; verifier pass; truthful terminal status |
| OBJ-02 | Invalid output or provider unavailable | Retry/rework is bounded; system ends blocked/failed if it cannot recover | Attempt count within configured cap; final reason recorded; no false completed/verified status or invented artifact |
| OBJ-03 | Approval-required action | Spending, external communication, destructive data action, or material decision waits for founder approval | No protected side effect before an explicit approval record; approval ID and action trace are linked |
| OBJ-04 | Duplicate trigger | Repeating a trigger with the same idempotency/correlation key does not duplicate material side effects | Same correlation key; duplicate-handling evidence; no duplicate artifact or external side effect |
| OBJ-05 | Durable-state freshness | A new test objective creates or updates records linked to that exact objective | Before/after timestamps plus linked durable records; HTTP 200 alone does not pass |
| OBJ-06 | Bounded rework | A deterministic validation failure receives only the configured number of repair attempts | Attempt trace, validation results, final artifact hash, independent verification, and bounded terminal state |
| OBJ-07 | Missing capability or approval | System truthfully reports blocked/awaiting approval with a useful next step | Specific blocker and next action; no success claim |
| OBJ-08 | Artifact integrity | Persisted artifact is accessible and its digest is stable | Retrieval succeeds and recomputed SHA-256 matches the recorded digest |

## Release decision

A test passes only when the required evidence is correlated and independently inspectable. An HTTP 200, cron success, green unit test, job creation, or model response is insufficient by itself.

Do not label the platform production-accepted until OBJ-01 and OBJ-05 pass, the negative-path cases demonstrate truthful blocked/failed outcomes, and approval gates are evidenced. Record unrun tests as **Not run**, never as passed.

## Known audit context (16 October 2026)

- Supabase unified logs showed repeated HTTP 200 responses for founder-brain-tick and ai-engine/run_jobs, while the newest observed durable records in ai_jobs, agent_runs, and ai_outcomes were dated 13 October. This is a freshness mismatch requiring correlation; it does not establish a root cause.
- The migration-drift workflow did not complete its comparison because its configured Supabase access token lacked database_migrations_read. This is an access blocker, not a migration-parity result.
- The function deployment workflow covers a fixed list of ten functions; a successful run is not evidence that every live function is reconciled.

## Run record template

Copy one row per test execution and populate evidence before marking status:

| Test ID | Run timestamp (UTC) | Objective ID | Correlation key | Artifact SHA-256 | Verifier | Attempts / cap | Terminal status | Result |
|---|---|---|---|---|---|---|---|---|
| OBJ-01 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Not run |


## Production trace checkpoint — 2026-10-16

**Status: investigation evidence; not an acceptance pass.** Read-only unified-log queries for 2026-10-16 11:45–12:15 UTC found two concrete blockers:

1. **Founder Brain provider-chain failure.** The deployed `founder-brain-tick` function (function ID `6ecb84ff-ab81-46fc-8c2a-029b213dc23b`, version 191) logged 10 provider-failure/error matches in this window. A representative cycle at 12:03:06–12:03:07 UTC reported that no configured LLM provider succeeded; the visible reason was Groq token-per-minute rate limiting. This is direct evidence of a provider-capacity failure in that window, not proof that all cycles or all providers are unavailable.

2. **Two scheduled endpoints reject authentication.** In the same window, `agent-scheduler` (function ID `4a65a508-eda3-4afe-85df-5618883cdb16`, version 51) logged 6 authentication failures, and `auto-pilot` (function ID `aef75683-312d-45f6-8bc5-b0097795ff04`, version 60) logged 6. Messages included missing Authorization / query-secret authentication and rejected credentials. This shows these requests are not authorized; it does not yet identify which cron job or caller generated each request.

### Required follow-up before acceptance

- Trace the two 401-producing functions back to their exact caller/job using sanitized request IDs and the cron inventory; inspect handler auth and caller configuration together. Do not change secrets or cron schedules until the owner-approved migration is ready.
- Inspect provider routing, rate-limit handling, token budgets, and backoff for the Founder Brain cycle. Do not switch to paid tiers or increase spend without approval. Test free-provider fallback and truthful blocked/failed reporting.
- For a single dedicated no-spend objective, capture the complete chain: accepted request → persisted objective → project/task → claimed job → provider attempt → durable output → independent verifier → terminal status.
- Mark OBJ-01 and OBJ-05 **Not run** until a trace includes correlated IDs and persisted evidence. Existing regression tests do not substitute for this live trace.

**Safety:** these findings came from read-only log inspection. No production writes, queue replays, secret changes, cron changes, deployments, or paid-provider actions were performed.


## Production trace checkpoint — 2026-10-17

**Status: acceptance blocked; investigation evidence only.** A read-only log query covering 07:30–08:30 UTC observed HTTP 401 responses from `agent-scheduler/tick`, `auto-pilot`, and `proposal-engine`, with repeated failures around five-minute intervals. The database cron inventory confirms 16 active jobs use a query-string credential and an aggregate-only comparison confirms those jobs share one distinct value. The value and its fingerprint were not retrieved. Supabase request logs contain the query strings on rejected requests, so treat the shared credential as exposed.

This is a broader authentication failure than the previous checkpoint. Repository source for `auto-pilot` and `proposal-engine` parses the `secret` query parameter and compares it with `HEARTBEAT_SECRET`; runtime logs nevertheless report failed authentication. The exact cause is unproven because the available project tools do not expose a safe read-only comparison of configured function secrets. Do not change cron commands or rotate the credential without an approved, coordinated migration plan and an authorized secret-management path.

The cron run-detail table marks recent invocations `succeeded`, while Edge Function request logs show HTTP 401. This demonstrates why scheduler-level status is not business-level evidence. OBJ-01 and OBJ-05 remain **Not run**; no new objective was submitted and no production state was changed.
