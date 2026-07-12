# Edge Function Git Parity Audit (Blueprint P2.4)

**Audited:** 2026-07-12 against live Supabase project `nrlsqshkjuuwiovthrnb`.

## Result
- **Live edge functions:** 77
- **Previously in repo:** 73
- **DRIFT — live but never committed: 9**

If Supabase had lost these, they would have been **unrecoverable**. This is the
structural risk the Blueprint flags as HIGH: a non-reproducible system is the
substrate that let four silent failures persist unnoticed.

| Function | Criticality | Status |
|---|---|---|
| `governance-engine` | **CRITICAL** — the constitutional reviewer | ✅ RECOVERED into git |
| `executive-intelligence` | **CRITICAL** — the CEO cognition loop | ✅ RECOVERED into git |
| `market-intelligence` | HIGH — market signal capture | ⏳ pending pull |
| `invoice-engine` | HIGH — commercial lifecycle (Invoice object) | ⏳ pending pull |
| `avatar-orchestrator` | MEDIUM — Founder Avatar backend | ⏳ pending pull |
| `verify-voice` | LOW — voice utility | ⏳ pending pull |
| `diagnostic-secrets-check` | DEBUG — candidate for deletion | review |
| `temp-key-check` | DEBUG/TEMP — candidate for deletion | review |
| `avatar-debug-llm` | DEBUG — candidate for deletion | review |

## 🔴 SECURITY ESCALATION (new finding, discovered during this pull)

The shared secret is **hardcoded in edge function source**, not only in
`pg_cron` command text as previously believed:

```ts
const SHARED_SECRET = "kjhgfdsa";   // governance-engine, executive-intelligence
```

This is worse than the known cron exposure. Any read of the function source
reveals the credential that authorizes the **constitutional reviewer** and the
**executive cognition loop** — the two most privileged agents in FKAIOS.

**Required (Blueprint P1.5 — FOUNDER ACTION, cannot be done from this session):**
1. Generate a new strong `HEARTBEAT_SECRET` in the Supabase dashboard.
2. Replace every hardcoded `SHARED_SECRET` with `Deno.env.get('HEARTBEAT_SECRET')`.
3. Update the `pg_cron` job commands (15, 21, 22, 25, 26, 31) that embed `secret=kjhgfdsa`.

Claude has no tool to set Supabase edge-function secrets; this needs the dashboard.

## Policy going forward
No edge function may be deployed to production without being committed to this
repo in the same change. Drift is how silent failure hides.
