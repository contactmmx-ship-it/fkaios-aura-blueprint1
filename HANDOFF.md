# FKAIOS — SESSION HANDOFF (read this first, then continue)

## LATEST — 2026-11-19 (One Brain programme started)
**State**
- Supabase project moved to the **Pro plan** (free egress quota had blocked every edge function with HTTP 402).
- Background cron jobs re-enabled at lighter schedules: `founder-brain-tick`, `aeos-heartbeat`, `auto-pilot` every 15 min (were 1/5/5 min); `ai-jobs-orphan-reaper` every 30 min; `reconcile-agent-metrics` hourly. Other previously-paused jobs unchanged. Verified: all return HTTP 200.
- Egress cause found (pg_stat_statements since 2026-09-18): ~2.7M REST calls, mostly from the once-a-minute brain tick; objective-loop `loadObjectiveState()` loads `orchestration_tasks.*` (~36 KB avg, up to ~1 MB) each tick. Not yet slimmed (optional, low priority on Pro).
- **One Brain audit** (code + live DB): one canonical brain (`_shared/founder-brain.ts`) and shared `recall()` already used by Brain Chat, My Brain, Decision Engine, Self-Learning. Findings: goal hierarchy re-seeded every tick; `fleet_memory` "learning" rows are a success counter (7,975 rows, 3 distinct contents; read by `getLearningTrend`); decisions in 3 stores; `brain_learning_insights` last written 2026-06-26; Brain Chat messages not in recall; `brain-chat` function has no caller.
- **Step 1 DONE (PR #255, deployed by CI):** `getGoals()` reads goal rows directly (`_shared/goal-hierarchy.ts` + test); `seedGoalHierarchy()` writes only missing goals. 1,076 duplicate goal rows re-labelled `memory_type='goal_archived_duplicate'` (reversible, nothing deleted). Verified: next tick 200, 0 new goal rows, 2 goals.

**Next (in order, each = branch + PR + CI + live proof)**
2. Brain Chat messages into the shared recall (one memory).
3. One decision record + outcome → lesson loop (same pattern as MIRROR v1.9 outcome learning).
4. Self-Learning screen reads real lessons.
5. Retire `brain-chat` function; executive-brain output as an input to the brain.
6. One front door (single chat) — only with founder approval.

---

## (older) SESSION HANDOFF 2026-07-12

**Last updated:** 2026-07-12 (session 2) · **Branch:** `main`

> **New chat: do NOT restart, re-audit, or rebuild. Everything below is DONE and
> verified in production. Continue from "NEXT ACTIONS".**

---

## 1. WHAT FKAIOS IS
Rajeev (Chairman, Bhavishya Associates) is building an autonomous AI enterprise OS.
Holding co + subsidiaries: Franchise Kart, Aura Tech, Rajyog Infra. Mission: ₹1,100 Cr by 2030.
Rajeev's role = **Chairman only**: observe, review, approve. Never operate.

## 2. INFRASTRUCTURE (verified)
- **Repo:** `contactmmx-ship-it/fkaios-aura-blueprint1` (Next.js + Turbopack). Local clone: `/home/claude/repo`
- **Vercel:** project `prj_IV9dnJRvWv5KCWKMdpPeiPedvlSF`, team `team_oGvhWIRXZWTZzrItofdKyxJB`. Auto-deploys on push to main.
- **Supabase:** project `nrlsqshkjuuwiovthrnb`. 77 edge functions.
- **Deployment URLs are SSO-gated** → verification = build READY + live DB queries, never pixels.
- **GitHub PAT:** Rajeev supplies a fresh temporary one per push session, then deletes it. Never reuse/store.

## 3. THE ONE FACT THAT MATTERS
**FKAIOS has produced ₹0 revenue, 0 invoices, 0 payments, ever.**
- 60+ leads, ALL uncontactable scraped names (only 6 have any phone/email)
- 0 leads score ≥40 → **0 have ever advanced past `stage='new'`**
- 4 of 41 agents produce real work; 37 are idle nameplates
- **Maturity score: 40/100** — "impressive surface, unproven atom"

## 4. COMPLETED & VERIFIED IN PRODUCTION (do not rebuild)

### Production repairs
- **Agent metrics reconciliation** — `reconcile_agent_metrics()`, pg_cron job 30, every 15m. Rollups now derive from real `agent_dispatch_log`.
- **Qualifier root-cause fix** — was selecting a non-existent `name` column from `leads` (real: `company_name`/`contact_name`) → PostgREST error masked as "none found" on ALL 251 runs. Fixed; now scores real leads with Claude BANT and advances score≥40 → `contacted`.
- **Enrichment repaired** — was reading a non-existent `APIFY_API_TOKEN` env var (real token lives in `apify_connections` table) and writing to a siloed table. Now reuses `maps-engine` (free OpenStreetMap) and writes contacts back onto `leads`. **HONEST RESULT: OSM has no coverage for these small Indian businesses (0/8 enriched).**
- **Autonomous loop closed** (documented in `supabase/PIPELINE.md`):
  DISCOVER (jobs 25,26 daily) → ENRICH (31, :05/:35) → QUALIFY (21,22, /30m) → NURTURE (15, /5m) → METRICS (30, /15m) → SILENCE MONITOR (32, hourly)

### Founder Experience (all live)
- **FounderStory.tsx** — Level-1 plain-language narrative, live "watch the company work" stream, AI collaboration/delegation view, "what needs you" callout. Full cockpit behind a progressive-disclosure toggle.
- **23 nav items → 5 doors** (TODAY / BUSINESS / WORKFORCE / INTELLIGENCE / BUILD) in `AppShell.tsx`. Nothing deleted — reparented. `NAV_DOORS` / `ALL_PAGES`.
- **⌘K command palette** — jump to any of the 23 pages.
- **Revenue hero number** — ₹0 shown truthfully at 5xl with "the enterprise has never billed a customer."
- **GO/NO-GO department consoles** — NASA rule: staffed dept with 0 output in 24h reports NO-GO. Silence is never consent.
- **Workforce ranked by real output** (UiPath principle) — producers first, idle agents sink.

### Silence Monitor v3 (`public.detect_silences()`, pg_cron job 32, hourly)
9 detection classes. Writes to existing `founder_notifications`. Idempotent (1 alert/condition/12h).
**Currently raising 3 TRUE alerts, 0 false positives:**
- "67 leads scored and NONE advanced beyond stage=new"
- "5 decisions have waited on the Founder >48h — the enterprise is blocked on you"
- "45 leads have sat in stage=new for more than 48h"

### Security (P1.5 — partially done)
- **Eliminated ALL hardcoded secrets from source.** Found 3 copies of `kjhgfdsa`:
  `governance-engine`, `executive-intelligence`, and **`orchestrator-ui` — which SHIPPED THE SECRET TO THE BROWSER on a publicly-reachable (`verify_jwt:false`) page.**
- All now read `Deno.env.get('HEARTBEAT_SECRET')` and **fail closed**.
- Verified: valid secret → 404 (authenticated); wrong secret → 401.

### Git parity (P2.4 — partially done)
77 live edge functions vs 73 in repo → **9 were never committed**. Recovered: `governance-engine`, `executive-intelligence`. See `supabase/DRIFT.md`.

## 5. AUDIT DOCUMENTS (complete — DO NOT REGENERATE)
In repo root. `FKAIOS_WORLD_CLASS_OS_BLUEPRINT.md` is **v1.0 and supersedes the rest**:
- FKAIOS_PRODUCT_AUDIT.md (40/100 scorecard)
- FKAIOS_BENCHMARK_AND_REDESIGN_BLUEPRINT.md
- FKAIOS_REVERSE_ENGINEERING_AND_REDESIGN.md
- FKAIOS_SCREEN_AUDIT_AND_FINAL_BLUEPRINT.md (only 2 of 23 screens can produce a business outcome)
- **FKAIOS_WORLD_CLASS_OS_BLUEPRINT.md ← the definitive spec**

**Rajeev has asked for an audit ~5 times. The analysis is COMPLETE. Do not write another one.**
The blueprint's own §23 names the top risk: *the planning loop replacing the building loop.*

## 6. 🔒 BLOCKED — NEEDS RAJEEV (Claude cannot do these)
1. **Rotate the secret value.** It is still `kjhgfdsa`. Now a ONE-STEP dashboard change (set `HEARTBEAT_SECRET` env + update the **13** cron command texts embedding `secret=kjhgfdsa`: jobs 13, 15, 16, 17, 18, 19, 20, 21, 22, 25, 26, 29, 31 — full list verified live). No code deploy needed. `market-intelligence` v2 picks the rotation up automatically. Claude has **no tool** to set Supabase edge secrets.
2. **Approve paid contact data (Apify Google Maps).** This is THE blocker on revenue. Free OSM cannot enrich these leads. Claude will NOT spend credits without explicit approval — the system's own cost-governance rule requires it.

## 7. ▶️ NEXT ACTIONS (free, autonomous — just continue)
1. ✅ DONE 2026-07-12 — all 4 drifted functions recovered into git (drift now 0; see `supabase/DRIFT.md`). `market-intelligence` v2 removed the last hardcoded secret fallback and fails closed (verified 401/503 paths).
2. ✅ DONE 2026-07-12 — 3 debug functions NEUTERED (410 Gone + verify_jwt TRUE; no MCP tool can delete a function — Founder deletes the inert slugs from dashboard). `verify-voice` also JWT-gated (was an anonymous ElevenLabs credit burner). All verified 401 via pg_net.
3. ✅ DONE 2026-07-12 — **P2 Lineage** shipped (`LineagePanel.tsx`, commit `550131f`, Vercel `dpl_5TXTyTUgMEuY1QWVS2uiSnYz9wHv` READY). Every number on TODAY (revenue hero, ops 24h, producing/total agents, discovery, qualification, failures, each GO/NO-GO dept chip, approvals callout) opens a drawer showing source table + derivation + the ACTUAL rows + a reconciliation footer. Derived from the payload already on the page — zero new queries. **Truth fix found while wiring: the narrative's revenue figure was a HARDCODED `₹0` literal, not read from the payload. Now bound to `revenue.received_inr`.** Sweep the rest of the app for the same class of bug.
4. **P2 — Ontology navigation:** the object graph already exists in the schema (companies→departments→agents→tasks→leads); the UI flattens it. Expose it as drillable objects+links.
5. **P2 — Proposal/Invoice/Payment screens** (only meaningful once real leads exist)

### ₹1,100 Cr Progress Engine (World Class Constitution) — DONE 2026-07-12
`public.compute_mission_progress()` + governance-dashboard **v6** (`mission` key) +
live Mission bar on TODAY. Commit `6902da1`, deploy `dpl_695BAS391UP2q8wTBvsA2vubrcQT` READY.
- **DATA TRAP:** `company_revenue_milestones` is HIERARCHICAL — the holding row (₹1,100 Cr)
  is a ROLLUP of the 3 subsidiaries (₹366.67 Cr each). **`SUM(target_inr)` returns ₹2,200 Cr
  and halves the apparent gap.** The engine sums subsidiaries only + asserts reconciliation
  (₹100 tolerance; exact equality was firing a false positive on a ₹1 rounding artifact).
- Live truth: target ₹1,100 Cr · **0.0000% achieved** · gap ₹1,100 Cr · 1,602 days ·
  **₹68,66,417/day required** · forecast **NEVER** (₹0/mo run-rate → division undefined, not faked).
- Engine also reports the plan has **NO 2026–2029 ramp** (all targets in the final year), so
  progress can be reported but not GRADED. **Building that ramp is a Founder decision, not mine —
  I will not invent revenue targets.**

### LLM Execution Graph + Enterprise Economics — DONE 2026-07-13
`compute_enterprise_economics()`; `agent_performance_metrics` += model/provider/
selection_reason/prompt_version/retries (NULLABLE, **deliberately not backfilled** —
avatar runs `claude-sonnet-5`, qualifier runs `claude-sonnet-4-6`, so a backfill would
have written a FALSE audit trail on all 88 rows). `auto-agents-engine` **v7** costs every
qualifier call incl. failures. Spend vs revenue now on TODAY with lineage (`cc8a7aa`).
- **Live truth: ≥ $5.49 burned → ₹0 earned. 100% of measured spend went to `founder-avatar`
  (the Founder talking to his own avatar). $0.00 to any agent with a path to revenue.**
- Spend is a **FLOOR**: only 3 of 41 agents log cost; **963 dispatches never costed**.
- ⏭ REMAINING: extend cost+model logging to `avatar-orchestrator` (the 100% spender —
  logs cost but no model), `executive-intelligence`, `market-intelligence`, `research-engine`.
  Until then true spend stays unknown.

## 8. NON-NEGOTIABLE OPERATING RULES
- **No fake data. Ever.** No `Math.random()`, no hardcoded stats, no stubs presented as complete. Rajeev has caught this repeatedly and treats it as trust-breaking.
- **Evidence, not claims.** Every "done" must be proven with a live query result, deployment ID, or verified HTTP response.
- **Preserve / Enhance / Integrate / Extend — never Replace or Rebuild.**
- **AI never moves money.** AI prepares; Rajeev approves. Finance & Legal are outside autonomous scope.
- **Truth Before Beauty.** If reality is ugly, show it ugly. ₹0 stays ₹0.
- **Rajeev wants autonomous execution.** Don't ask permission between steps. Only stop for: money, dashboard-only credentials, irreversible/legal decisions.

## 9. KEY TECHNICAL GOTCHAS
- `execute_sql` returns only the FIRST result set — verification SELECTs must be separate calls.
- `pg_net.http_post` needs `timeout_milliseconds: 60000–120000`; poll `net._http_response` after `pg_sleep`.
- Direct HTTP to `*.supabase.co` is NOT available from the sandbox — use `pg_net` from SQL.
- `deploy_edge_function` works, but **cannot set/delete Supabase secrets**.
- Vercel `list_projects` requires explicit `teamId`.
- `leads` table uses column `stage`, not `status`.
- LLM edge functions use forced tool-use (`tool_choice`) to prevent thinking-block 502s.
