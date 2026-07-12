# Edge Function Git Parity Audit (Blueprint P2.4)

**Audited:** 2026-07-12 against live Supabase project `nrlsqshkjuuwiovthrnb`.
**Updated:** 2026-07-12 (second session) — drift CLOSED.

## Result
- **Live edge functions:** 77
- **Drift (live but never committed):** was 9 → **now 0**

| Function | Criticality | Status |
|---|---|---|
| `governance-engine` | **CRITICAL** — the constitutional reviewer | ✅ RECOVERED into git |
| `executive-intelligence` | **CRITICAL** — the CEO cognition loop | ✅ RECOVERED into git |
| `market-intelligence` | HIGH — market signal capture | ✅ RECOVERED as **v2** (see security note) |
| `invoice-engine` | HIGH — commercial lifecycle (Invoice object) | ✅ RECOVERED into git (verbatim) |
| `avatar-orchestrator` | MEDIUM — Founder Avatar backend | ✅ RECOVERED into git (verbatim v8) |
| `verify-voice` | LOW — voice utility | ✅ RECOVERED as **v3**, now JWT-gated |
| `diagnostic-secrets-check` | DEBUG | 🔒 **NEUTERED** → 410 Gone, verify_jwt TRUE |
| `temp-key-check` | DEBUG/TEMP | 🔒 **NEUTERED** → 410 Gone, verify_jwt TRUE |
| `avatar-debug-llm` | DEBUG | 🔒 **NEUTERED** → 410 Gone, verify_jwt TRUE |

## Security actions taken 2026-07-12 (verified in production via pg_net)
1. **`market-intelligence` v2** — removed the hardcoded `?? "kjhgfdsa"` fallback
   (the last remaining hardcoded secret in any live function source). Auth now
   reads `MARKET_INTEL_SECRET` → `HEARTBEAT_SECRET` → **fail closed (503)**.
   Verified: wrong secret → HTTP 401 (req 23645).
2. **3 debug functions neutered.** No MCP tool can DELETE an edge function, so
   each was redeployed as a 410-Gone stub with `verify_jwt: true`. Before this,
   `diagnostic-secrets-check` publicly enumerated which secrets exist, and
   `avatar-debug-llm` made a **real Anthropic web-search call on every
   anonymous hit** (observed live, req 23648, before the fix propagated).
   Verified after propagation: all three → HTTP 401 unauthenticated
   (reqs 23646, 23647, 23649).
3. **`verify-voice` v3** — was `verify_jwt:false` and burned real ElevenLabs
   credits per anonymous call. Now `verify_jwt: true`; capability preserved for
   authenticated callers. Verified: anonymous → HTTP 401 (req 23655).

## 🔒 Remaining FOUNDER dashboard actions (Claude has no tool for these)
1. **Rotate the fleet secret** — still `kjhgfdsa`. Set `HEARTBEAT_SECRET` to a
   strong value + update the 13 cron commands embedding `secret=kjhgfdsa`
   (jobs 13, 15, 16, 17, 18, 19, 20, 21, 22, 25, 26, 29, 31 — note: MORE than
   the 6 previously listed; job list verified live 2026-07-12).
   `market-intelligence` v2 picks up the rotation automatically.
2. **Delete the 3 neutered debug slugs** from the dashboard (Edge Functions →
   delete). They are inert 410 stubs until then.

## Policy going forward
No edge function may be deployed to production without being committed to this
repo in the same change. Drift is how silent failure hides.
