# FKAIOS Scheduled-Job Credential Migration Register

Snapshot date: 16 October 2026. Read-only inventory of cron jobs whose configured command contains a credential in a URL query string. No credential values are included in this register.

## Scope and safe migration order

The following 16 active jobs were observed using a `?secret=` query parameter. Query-string credentials can be exposed through logs, telemetry, diagnostics, or copied URLs. Treat the credential as potentially exposed and rotate it under authorized change control.

| Cron job | Function route (secret redacted) | Snapshot pattern | Migration state |
|---|---|---|---|
| agent-scheduler-5min | `/functions/v1/agent-scheduler/tick?secret=[REDACTED]` | Query-string secret | Not migrated |
| auto-agents-daily-report | `/functions/v1/auto-agents-engine?secret=[REDACTED]` | Query-string secret | Not migrated |
| auto-agents-hunt-leads-at | `/functions/v1/auto-agents-engine?secret=[REDACTED]` | Query-string secret | Not migrated |
| auto-agents-hunt-leads-fk | `/functions/v1/auto-agents-engine?secret=[REDACTED]` | Query-string secret | Not migrated |
| auto-agents-qualify | `/functions/v1/auto-agents-engine?secret=[REDACTED]` | Query-string secret | Not migrated |
| auto-pilot-5min | `/functions/v1/auto-pilot?secret=[REDACTED]` | Query-string secret | Not migrated |
| ceo-think-daily | `/functions/v1/opportunity-engine?secret=[REDACTED]` | Query-string secret | Not migrated |
| enrich-new-leads | `/functions/v1/enrichment?secret=[REDACTED]` | Query-string secret | Not migrated |
| enterprise-evolution-daily | `/functions/v1/evolution-engine?secret=[REDACTED]` | Query-string secret | Not migrated |
| executive-brain-daily | `/functions/v1/executive-brain?secret=[REDACTED]` | Query-string secret | Not migrated |
| executive-intelligence-daily | `/functions/v1/executive-intelligence?secret=[REDACTED]` | Query-string secret | Not migrated |
| proposal-engine-hourly | `/functions/v1/proposal-engine?secret=[REDACTED]` | Query-string secret | Not migrated |
| workday-ceo | `/functions/v1/workday-engine?secret=[REDACTED]` | Query-string secret | Not migrated |
| workday-evening | `/functions/v1/workday-engine?secret=[REDACTED]` | Query-string secret | Not migrated |
| workday-midday | `/functions/v1/workday-engine?secret=[REDACTED]` | Query-string secret | Not migrated |
| workday-morning | `/functions/v1/workday-engine?secret=[REDACTED]` | Query-string secret | Not migrated |

## New finding: authentication mismatch must be diagnosed before migration

A read-only log aggregation for 16 October 2026 reported five POST requests to `agent-scheduler/tick`, five GET requests to `auto-pilot`, and one POST request to `auto-agents-engine`; all 11 requests had a query-secret parameter and returned HTTP 401. The caller was `pg_net/0.20.3`. This is historical evidence from that log window, not a claim that every later invocation still fails.

The inspected deployed handlers for these three functions accept either `x-heartbeat-secret` or `?secret=` and compare the supplied value with their configured `HEARTBEAT_SECRET`. Therefore, the presence of the query parameter alone does not explain the 401. The leading hypotheses are a secret/configuration mismatch or a difference between the inspected source and effective runtime configuration; neither is yet proven.

A follow-up read-only check on 16 October 2026 found the problem was still active: `agent-scheduler/tick` returned 401 at 13:36:30 UTC and `auto-pilot` returned 401 at 13:40:00 UTC. Their cron scheduler rows were marked `succeeded`, but that status only confirms the `pg_net` call was queued/executed at the database layer; it does not mean the HTTP request succeeded. The Edge Function request logs also recorded full query strings for rejected requests, confirming that this credential transport exposes the secret in log URLs. Treat the shared value as exposed and prioritize a coordinated, authorized rotation after safe caller migration. The observed 13:40 UTC `auto-pilot` log explicitly said the `?secret=` credential was missing even though the gateway request URL included it; this points to an additional request/handler parsing or runtime mismatch, but does not establish which layer is responsible.

**Updated 17 October 2026 (read-only confirmation):** in the 07:30–08:30 UTC log window, `agent-scheduler/tick`, `auto-pilot`, and `proposal-engine` each returned HTTP 401, with rejected requests continuing at approximately five-minute intervals. Their logged request URLs included the query-string credential. An aggregate query of `cron.job` confirmed all 16 active query-secret jobs currently use **one distinct shared value**; the value and any fingerprint were intentionally not returned. This expands the exposure scope: one credential is shared across multiple scheduled functions and appears in their request logs. The cron run-detail rows still show `succeeded` for queued requests, so the HTTP response logs are the relevant failure evidence. The function logs for `agent-scheduler` and `auto-pilot` report failed secret/authorization checks despite a query parameter in the gateway URL. Repo handlers parse `new URL(req.url).searchParams.get("secret")` correctly, so remaining plausible causes include mismatch between the cron-shared value and deployed `HEARTBEAT_SECRET`, or a difference between current repository source and effective deployed code/configuration. Do not select a root cause without a secret-safe comparison and deployed-version check.

Before changing any cron command:
1. Compare the cron-held value with the configured function secret through an authorized secret-management path, using a safe equality/fingerprint check that never prints either value.
2. Confirm the active deployed function version and its secret configuration for each route.
3. Check whether the rejected requests and cron jobs correlate by timestamp; do not infer exact job-to-request mapping from route alone.
4. Only after the mismatch is resolved, migrate one caller to a header and validate its response and durable business effect.

## Controlled migration checklist

1. Identify the exact secret and all callers/validators through the approved secret-management path. Never print the value into logs, tickets, chat, shell output, or this file.
2. Confirm each target Edge Function accepts and validates the intended header (for example, `x-heartbeat-secret`) using constant-time comparison where appropriate, rejects missing/invalid credentials, and does not fall back to query-string auth after migration.
3. Deploy the reviewed function change through the repository's CI/CD path. Confirm the deployed version and inspect sanitized logs.
4. Update one cron job at a time to send the credential in the header and remove the query parameter. Preserve schedule, payload, timeout, and retry semantics.
5. Trigger or wait for one controlled execution, verify the expected response and business-level effect, and confirm the credential is absent from URLs/logs. HTTP 200 alone is not enough to validate the business effect.
6. Continue to the next job only after the prior job passes. Keep a rollback plan that does not reintroduce the old exposed credential.
7. Rotate/revoke the old credential after all required callers have migrated and validated; coordinate this with the authorized secret owner to avoid service interruption.
8. Record change reference, deploy commit, cron job, verification timestamp, and outcome without recording secret values.

## Guardrails

- This document does not perform rotation, alter cron jobs, or modify Edge Function auth.
- Do not disable all affected jobs at once; that can interrupt scheduled operations.
- Do not assume a route supports header authentication until its deployed handler has been inspected and tested.
- Two active jobs were observed using a header-based pattern (`aeos-heartbeat` and `job-scheduler-drain`); use these as patterns to inspect, not as proof that every other endpoint is compatible.
- One inactive job, `sales-draft-proposals-hourly`, also contained a query-string secret in its configured command. It is excluded from the 16-active-job count but should be reviewed before reactivation.


## Updated 17 October 2026: cron credential differs from Vault credential

A further read-only SQL check compared the credential embedded in active cron command URLs with the decrypted value named `heartbeat_secret` in Supabase Vault. It returned aggregate metadata only; neither credential value nor a fingerprint was selected or logged.

- Active cron jobs containing a `secret=` URL parameter: **16**
- Exact matches between those URL credentials and Vault `heartbeat_secret`: **0**
- Mismatches: **16**
- Length of cron URL credential: **48 characters** (all 16)
- Length of Vault credential: **64 characters**

This establishes a concrete configuration mismatch between the scheduled callers and the Vault secret. It is a strong candidate explanation for the observed 401s, but **does not by itself prove the exact runtime root cause**: the configured `HEARTBEAT_SECRET` inside the deployed Edge Functions is not exposed by the available read-only tools, so it has not been compared safely to either value. Do not infer that the live Edge Function secret equals the Vault secret without verifying it through the authorized Supabase secret-management interface.

### Required next action

1. Through an authorized secret-management path, confirm whether the deployed functions' `HEARTBEAT_SECRET` matches the Vault `heartbeat_secret`, using a comparison that returns only equal/not-equal and never the value or fingerprint.
2. If the Edge Function secret matches Vault, update the cron callers to use the approved current credential—but first migrate from URL query strings to the supported `x-heartbeat-secret` header and verify a canary caller end to end.
3. If the Edge Function secret does not match Vault, agree which value is canonical, then coordinate the function secret and caller migration under change control.
4. Rotate the exposed query-string credential after all affected callers are migrated and verified. Do not change the 16 production jobs or function secrets blindly.


## Deployed auth-contract inventory for migration planning — 17 October 2026

A read-only inspection of currently deployed Edge Function source confirmed that most checked handlers parse either `x-heartbeat-secret` or `?secret=` and compare against `HEARTBEAT_SECRET`. One important exception was found:

- `executive-intelligence` is deployed at version 22. It defines a shared-secret variable but its request gate checks `CRON_SECRET` and `url.searchParams.get("secret")` only. The inspected gate does not accept `x-heartbeat-secret`.

Therefore, a blanket cron-only migration to header authentication would break at least this route unless its handler is first updated and deployed. Before migrating each caller, record the exact live auth contract and expected environment-variable name for its target function. Treat the migration as a per-function reviewed change, not a search-and-replace across all cron commands. This inventory is based on the currently deployed source returned by the project API; it does not prove the effective secret values configured in the runtime.


## Source-to-deployed auth drift — 17 October 2026

The deployed `executive-intelligence` function is version 22 and its returned source defines `CRON_SECRET = Deno.env.get("CRON_SECRET") || SHARED_SECRET`, then validates only `url.searchParams.get("secret")`. The current `main` source at `supabase/functions/executive-intelligence/index.ts` instead defines `SHARED_SECRET` from `HEARTBEAT_SECRET` and validates the query parameter against that value; it does not include the deployed `CRON_SECRET` fallback. This is direct evidence of source/deployed auth-contract drift for this function. It is separate from, and does not prove the cause of, the observed 401s on the other three functions.

For migration readiness, current deployed auth behavior was inspected for all ten distinct function routes used by the 16 active query-secret jobs:
- `agent-scheduler` (v51): `HEARTBEAT_SECRET`, header or query; can also authenticate service-role JWT/admin JWT.
- `auto-agents-engine` (v28): `HEARTBEAT_SECRET`, header or query; fails closed if missing.
- `auto-pilot` (v60): `HEARTBEAT_SECRET`, header or query, with service-role JWT fallback.
- `opportunity-engine` (v21): `HEARTBEAT_SECRET`, header or query; fails closed if missing.
- `enrichment` (v46): accepts header or query; has a distinct conditional auth path, so must be validated independently before migration.
- `evolution-engine` (v21): `HEARTBEAT_SECRET`, header or query; fails closed if missing.
- `executive-brain` (v21): `HEARTBEAT_SECRET`, header or query; fails closed if missing.
- `executive-intelligence` (v22): `CRON_SECRET` or fallback `HEARTBEAT_SECRET`, query only in deployed source.
- `proposal-engine` (v14): `HEARTBEAT_SECRET`, header or query; header is a fallback if query parameter is absent.
- `workday-engine` (v33): header or query plus additional authorization logic.

The 16 jobs cover ten distinct function routes, because four workday jobs and four auto-agents jobs share their respective handlers; the inventory above lists all routes observed in the active cron commands. Before a rollout, reconcile the route inventory against the full ten-route list and inspect each deployed auth gate. Do not infer that a handler's source-level support means the runtime secret value is correct.

The deployment workflow's known fixed function list does not include `executive-intelligence`; therefore, changing its source on `main` alone does not prove that the deployed function will be updated. Deployment coverage must be explicitly reconciled before attempting this migration.


## Fresh production log check — 17 October 2026, approximately 09:15 UTC

A read-only aggregation of recent Supabase function-edge logs found **667 HTTP 401 responses** across the ten scheduled function routes in the available recent log window. This is a request count, not a count of unique cron jobs or unique incidents.

| Deployed route | Version | HTTP 401 count | Latest observed |
|---|---:|---:|---|
| `agent-scheduler/tick` | 51 | 270 | 09:15:01 UTC |
| `auto-pilot` | 60 | 274 | 09:15:01 UTC |
| `proposal-engine` | 14 | 24 | 09:15:01 UTC |
| `enrichment` | 46 | 42 | 09:05:00 UTC |
| `auto-agents-engine` | 28 | 49 | 09:00:00 UTC |
| `workday-engine` | 33 | 4 | 08:30:05 UTC |
| `executive-brain` | 21 | 1 | 04:30:05 UTC |
| `evolution-engine` | 21 | 1 | 04:00:02 UTC |
| `opportunity-engine` | 21 | 1 | 03:30:06 UTC |
| `executive-intelligence` | 22 | 1 | 02:00:01 UTC |

This confirms the issue was still active in production at the time of the query; it is not merely a historical incident. Counts can include non-cron callers and should not be interpreted as one failure per job. No request URLs, query strings, or credential values were selected or included in this aggregation.


## Latest one-hour confirmation — 17 October 2026, 09:26 UTC

A separate read-only query scoped to 08:26–09:26 UTC found **29 HTTP 401 responses** on the affected scheduled routes, with `agent-scheduler/tick` and `auto-pilot` still failing at 09:25 UTC (11 and 12 responses respectively in that hour). Other observed failures in that window were proposal-engine (1), enrichment (2), auto-agents-engine (2), and workday-engine (1). These counts are scoped to this hour and the listed routes; they are not unique cron job counts and may include other callers. This confirms the incident continued after the earlier log snapshot. No production writes were made.


## Query-string credential exposure confirmed in function-edge logs

A read-only aggregation over the last 24 hours of available function-edge logs found **668 requests** to these routes where the logged request URL contains a `secret=` query parameter. The grouped results included 667 HTTP 401 responses and one HTTP 503 response. The query returned only counts, route names, status codes, and timestamps; it did not return or print any request URL or credential value.

This confirms that query-string credentials are present in the logged request URLs, increasing exposure risk beyond the cron configuration itself. Treat the URL credential as potentially exposed. Once the correct runtime authentication contract and a safe cutover sequence are established, rotate the credential and migrate callers away from query strings; do not rotate or rewrite production jobs blindly because the effective Edge Function secrets are not yet verified. Use the header where each function supports it, and update/deploy any query-only handler before moving its caller.
