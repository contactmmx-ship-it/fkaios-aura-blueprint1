# FKAIOS security and recovery

Status is from inspection on 9 Oct 2026. Secret values are never written here.

## Security status

| Item | Status | Evidence | Next action |
|---|---|---|---|
| **Heartbeat secret in pg_cron request URLs** | **RED (open)** | Most cron jobs call `…/function?secret=…`, and edge request logs record full URLs, so the secret must be treated as compromised | **Rajeev:** rotate it and store it in Vault as `fkaios_cron_secret` (steps in `docs/FKAIOS_P0_CRON_SECRET_PLAN.md`). **Claude:** then apply the prepared `fkaios_cron_call()` migration, switch the jobs to the header, and verify that every job returns 200 and the old secret returns 401. The automated Vault write was correctly refused by the session's safety control and was not worked around |
| Unauthenticated ai-engine cron | Fixed (8 Oct) | Migration `20261008161605` deactivated the job | — |
| Founder actions (objective, voice, communications, knowledge) | Enforced | founder-objective requires a valid JWT and the `FOUNDER_EMAILS` allow-list | — |
| research-engine gateway JWT | Enforced (`verify_jwt: true`, CI deploy) | `list_edge_functions` | Side effect: lead-discovery's call is unauthenticated and fails (see below) |
| New knowledge and discovery tables | RLS on, no policies, `anon`/`authenticated` revoked; search function is `security definer` and revoked from `public` | Migration `20261009024803` | — |
| Secrets in the repository | None committed. `credential_ref` columns hold variable *names* only (CHECK constraint) | Code review of this session's changes | — |
| Discovered content | Stored as untrusted metadata: descriptions clipped, control characters stripped, nothing installed or executed | `ecosystem-discovery.ts` | — |
| External communications | Sent only after a founder approval row exists, at most once (compare-and-swap claim). 0 sent to date | `communications.ts` | — |
| Paid spend | `allowPaid=false` by default. Anthropic and OpenAI are excluded by health (no credit) | Routing evidence | — |
| **Paid lead discovery (`hunt_leads` → lead-discovery → research-engine, Apify)** | **Stopped by an auth failure**, left stopped on purpose | 14 failures in 7 days (`UNAUTHORIZED_NO_AUTH_HEADER`). The function's own header says it spends Apify credits | **Founder decision:** re-enable paid discovery (then Claude fixes the auth header and moves the secret to a header), or deactivate the two `auto-agents-hunt-leads-*` cron jobs |

## Recovery mechanisms

| Failure | Mechanism | Evidence |
|---|---|---|
| Model or provider down, rate-limited or out of credit | Model-scoped failure classification. A 503 or 529 counts as `rate_limit`, not "provider down". The router fails over to the next resource, retries once on transient errors, and applies cooldowns | Self-test `model_failover` (3e57e289); opportunity-engine served by gemini-3.5-flash-lite while Anthropic has no credit |
| Output cut off at the token limit | Continuation from a checkpoint (at most 2 continuations) | Self-test `continuation` |
| Edge background time limit (~145 s) | Self-tests run one scenario per tick under a 4-minute lease, so a dead worker resumes | voice_turn resumed across ticks |
| Stuck evaluation | 5 deferrals for a candidate or 10 for the incumbent, then cancel. Discovery cools down for 6 h on quota | Production, 9 Oct 00:45 |
| Work stuck in a non-terminal state | `fkaios_reap_stale_work()`, hourly: builds `generating` for more than 2 h, and projects `working`/`merging` with 72 h of no task activity, are marked `failed` with a reason | First run: 9 builds and 22 projects |
| Daily discovery run dies | A run stuck in `running` for 10 minutes is marked failed and retried, up to 3 times a day. A unique index allows only one scheduled run per day | `runScheduledDiscoveryIfDue` |
| Bad model adoption | `fkaios_rollback_routing` (approval-gated) | Governed adoption functions |
| Database | Supabase managed backups (platform) | — |

## Rules (non-negotiable)

- Never create objectives, approvals or test results through SQL to make a test pass.
- Never expose, copy or work around a secret.
- Never send external communications without approval.
- Never spend without authorisation.
