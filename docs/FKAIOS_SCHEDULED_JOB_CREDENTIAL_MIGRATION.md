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

## Controlled migration checklist

1. Identify the exact secret and all callers/validators through the approved secret-management path. Never print the value into logs, tickets, chat, shell output, or this file.
2. Confirm each target Edge Function accepts and validates the intended header (for example, `x-heartbeat-secret`) using constant-time comparison where appropriate, rejects missing/invalid credentials, and does not fall back to query-string auth.
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
