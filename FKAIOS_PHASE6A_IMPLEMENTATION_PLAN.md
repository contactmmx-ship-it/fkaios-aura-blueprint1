# FKAIOS Phase 6A Implementation Plan — Intelligence Reliability

**Date:** 2026-07-24
**Status:** Planning only. No code changed, no migration written or applied, nothing deployed, no secrets touched, no cron activated or modified while producing this plan.
**Authorized scope:** Per `FKAIOS_PHASE6_FOUNDER_DECISION_RECORD.md` — Phase 6A approved to begin; AI provider strategy = **Option C, hybrid multi-provider architecture**. No UI redesign, no new dashboards, no cosmetic changes.

---

## 1. Current AI Intelligence Architecture Audit

| Function | Current Provider(s) | Model | Failure State | Business Impact | Dependencies |
|---|---|---|---|---|---|
| `executive-intelligence` | OpenAI only (deliberately migrated) | `gpt-4o` | **Working** — fixed 2026-07-24, cycle 18 verified live | Daily Founder Cockpit briefing | `OPENAI_API_KEY`; `CRON_SECRET`/`HEARTBEAT_SECRET`; cron job `executive-intelligence-daily` (02:00 UTC) |
| `ai-engine` | Anthropic primary; OpenAI fallback exists but **only triggers if the key is unset, not if it's rejected** | `claude-3-haiku-20240307` / `gpt-4o-mini` | **Broken live** — 400 "credit balance too low" | Job queue for invoices, proposals, agent chat stalls | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`; invoked by `job-scheduler` cron (every 10 min) |
| `lead-discovery` | Anthropic only, no fallback | `claude-sonnet-4-6` | **Broken live** — 502 "Extraction failed...credit balance too low" | New lead discovery/enrichment halted | `ANTHROPIC_API_KEY`; invoked by `auto-agents-engine` |
| `evolution-engine` | Anthropic only, no fallback | `claude-sonnet-4-6` | **Broken live** — 502 confirmed | Capability backlog / self-improvement generation halted | `ANTHROPIC_API_KEY`; cron `enterprise-evolution-daily` (04:00 UTC) |
| `opportunity-engine` | Anthropic only, no fallback | `claude-sonnet-4-6` | **Broken live** — 502 confirmed | "CEO thinking" commercial opportunity generation halted | `ANTHROPIC_API_KEY`; cron `ceo-think-daily` (03:30 UTC) |
| `brain-engine` | Anthropic → Gemini → OpenAI/GLM/DeepSeek fallback chain (own copy-pasted implementation) | `claude-sonnet-4-6` → `gemini-2.5-flash` → `gpt-4o-mini` | **Unverified live** — has real fallback, not exercised this session | Founder direct chat backend | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `open_ai_key`, `ZHIPU_API_key`, `deepseek key` |
| `brain-chat` | Same fallback chain as `brain-engine` (separately duplicated code) | Same | **Unverified live** | RAG-grounded founder chat over knowledge vault | Same key set |
| `sales-engine` | Same fallback chain (separately duplicated code) | Same | **Unverified live** | Sales Executive AI conversations | Same key set + `ELEVENLABS_API_KEY` (voice) |
| `_shared/founder-brain.ts` `reason()` | Anthropic → Gemini → OpenAI fallback (shared by cognitive cells) | `claude-sonnet-4-6` → `gemini-2.5-flash` → `gpt-4o-mini` | **Untested in practice** — founder-brain-tick has never run autonomously (see `FOUNDER_BRAIN_TICK_STATUS.md`) | Entire Confidence/Reflection/Curiosity/Belief/Imagination/Risk-Assessment loop | Same key set |
| 26 other functions | — | — | **Verified 2026-07-24 — see Section 1B below** | — | Verification Sweep 0 complete |

**Note on the "26 other functions" row:** Originally flagged as unverified via local-repo grep only. Verification Sweep 0 (Section 1B) has since fetched deployed source for all 26 and confirmed actual behavior — this superseded the placeholder above.

---

## 1B. Verification Sweep 0 — Results (completed 2026-07-24)

Read-only deployed-source inspection of all 26 previously-unverified functions on `nrlsqshkjuuwiovthrnb`. No function was invoked live — several (`whatsapp-webhook-v2` sends real WhatsApp messages; `legal-engine`/`pr-engine`/`accounting-engine` take other real actions) were deliberately left untouched, source-read only.

| Function | Calls AI? | Provider(s) | Model(s) | Fallback Chain? | Cron/Trigger | Purpose |
|---|---|---|---|---|---|---|
| workday-engine | Yes | Anthropic → Gemini | claude-sonnet-4-6 → gemini-2.5-flash | Yes (2-tier) | **Cron** (workday-morning/midday/evening/ceo) | Daily AI-workforce plan→check-in→submit→CEO-review cycle |
| closer-engine | Yes | Anthropic only | claude-3-haiku-20240307 | **No** | Not cron; JWT-gated, user-triggered | Sales objection handling + deal closure |
| mis-engine | Yes | Anthropic only | claude-3-haiku-20240307 | **No** | Not cron; JWT-gated | Founder monthly briefing generation |
| market-intelligence | Yes | Anthropic only (web_search tool) | claude-sonnet-5 | **No** | Not cron; query-secret | External market/competitor research |
| learning-engine | Yes | Anthropic→Gemini→OpenAI/GLM/DeepSeek | 5-tier chain | Yes (5-tier) | Not cron; JWT-gated | Self-learning insights from operational data |
| governance-engine | Yes | Anthropic only | claude-sonnet-5 | **No** | Not cron; query-secret | Constitutional review, approve/reject verdicts |
| business-engine | Yes | Anthropic→Gemini→OpenAI/GLM/DeepSeek | 5-tier chain | Yes (5-tier) | Not cron; JWT-gated | Business idea scoring, proposal generation |
| builder-engine | Yes | 5-tier (text); Gemini-only (images) | Same chain + gemini-2.5-flash-image | Yes text / **No** images | Not cron; JWT-gated | AI website/CRM builder + Netlify deploy |
| avatar-orchestrator | Yes | Anthropic only (agentic + web_search) | claude-sonnet-5 | **No** | Not cron; interactive | Founder's personal AI avatar — "100% of measured AI spend" per its own code |
| auto-agents-engine | Yes | Anthropic only | claude-sonnet-4-6 | **No** | **Cron** (every 30min + daily) | Lead BANT qualification, daily reports, lead sourcing — **confirmed intermittently 502ing live today** alongside the original 4 |
| agent-engine | Yes | Anthropic→Gemini→OpenAI/GLM/DeepSeek | 5-tier chain | Yes (5-tier) | Not cron; browser-invoked | Runs a named `brain_agents` conversation |
| accounting-engine | Yes (1 route) | OpenAI only | gpt-4o-mini | N/A — already OpenAI | Not cron; JWT-gated | Bank statement parsing, transaction classification |
| orchestrator-engine | Yes | 5-tier chain, **degraded** | Same chain | "Yes" but GLM tier broken + DeepSeek has its own billing issue | Not cron; secret or JWT | Multi-step "AI Company" content/code pipeline |
| orchestrator-brain | Yes | 5-tier chain | Same chain | Yes (5-tier) | Not cron; secret or JWT | Master request router, vault RAG, approvals |
| knowledge-engine | Yes | Anthropic only | claude-sonnet-4-6 | **No** | Not cron; JWT-gated | Keyword search + Claude-synthesized answers |
| knowledge-search | Yes (embeddings only) | OpenAI only | text-embedding-ada-002 | N/A — already OpenAI | Not cron; JWT-gated | Semantic pgvector search |
| heartbeat-engine | Yes (conditional) | Anthropic only | claude-sonnet-4-6 | **No** | **Cron** (every 5 min) | Chief-of-staff briefing, WhatsApp draft replies — only calls Claude when a lead has WhatsApp history, so today's live 200s may just mean zero eligible leads, not proof of health |
| founder-executive | Yes | Anthropic → OpenAI | claude-3-haiku-20240307 → gpt-4o-mini | **Written but broken** — same defect class as `ai-engine`: catch block re-throws on "Anthropic API error"-prefixed messages before reaching the OpenAI branch | Not cron; JWT-gated | "Command Center" Q&A, morning brief, revenue review |
| document-ingest | Yes (embeddings only) | OpenAI only | text-embedding-ada-002 | N/A | Not cron; on document upload | Knowledge vault ingestion pipeline |
| dashboard-engine | Yes (1 action only) | Anthropic → Gemini | claude-sonnet-4-6 → gemini-2.5-flash | Yes (2-tier) | Not cron; on dashboard load | KPI aggregation; main path has **zero** AI calls, only `get_insights` does |
| customer-assistant | Yes | Anthropic → OpenAI | claude-3-haiku-20240307 → gpt-4o-mini | Yes (2-tier) | Not cron; per customer message | Customer chat with mandatory human-escalation rules |
| training-engine | Yes | 4-tier chain | Same family | Yes (4-tier) | Not cron — has an idle `HEARTBEAT_SECRET` path built for future cron, never scheduled | AI-workforce training module generation |
| project-review-engine | Yes | Anthropic only | claude-sonnet-4-6 | **No** | Not cron; JWT-gated | Reviews submitted code/docs; refuses to fabricate review of unparseable files |
| pr-engine | Yes | Anthropic → Gemini | claude-sonnet-4-6 → gemini-2.5-flash | Yes (2-tier) | Not cron — same idle `HEARTBEAT_SECRET` pattern as training-engine | Marketing/PR campaign copy |
| legal-engine | Yes | Anthropic → Gemini | claude-sonnet-4-6 → gemini-2.5-flash | Yes (2-tier) | Not cron — same idle pattern | Contract risk review (explicitly disclaimed, not legal advice) |
| whatsapp-webhook-v2 | Yes | Anthropic only | claude-sonnet-4-6 | **No** | **Not cron — genuine external webhook**, Meta pushes inbound messages, sends real outbound WhatsApp replies | Inbound WhatsApp handler with AI-drafted replies |

### Key findings from the sweep

1. **The "priority broken group" is larger than Section 1 originally scoped.** Beyond the 4 already confirmed broken (`ai-engine`, `lead-discovery`, `evolution-engine`, `opportunity-engine`), the sweep found **`auto-agents-engine` is also cron-scheduled and confirmed intermittently 502ing live today** — same failure, just not called out in the original plan. This needs to be added to the priority migration group, not treated separately.

2. **A second, distinct code defect exists.** `founder-executive` has the exact same bug as `ai-engine`: its OpenAI fallback exists in code but the catch block re-throws immediately on any "Anthropic API error"-prefixed message — the precise error the current credit exhaustion produces — so the fallback never actually fires. This is a code-pattern bug, not a missing-fallback gap, and should be fixed the same way in both places rather than patched twice independently.

3. **The copy-pasted 5-tier fallback chain is far more widespread than known.** At least 10 functions now confirmed independently reimplementing the identical Anthropic→Gemini→OpenAI→GLM→DeepSeek chain: `brain-engine`, `brain-chat`, `sales-engine`, `learning-engine`, `business-engine`, `builder-engine` (text path), `agent-engine`, `orchestrator-engine`, `orchestrator-brain`, `training-engine`. This is strong, direct confirmation that the Section 2 shared `callLLM()` abstraction is solving a real, widespread problem — not a hypothetical one. It also means a bug in the shared chain (e.g. the GLM tier being broken in `orchestrator-engine`, or DeepSeek's own billing issue) is silently replicated across every copy.

4. **9 functions have zero fallback of any kind** and would fail exactly like the original 4 the moment they're actually invoked with real work: `closer-engine`, `mis-engine`, `market-intelligence`, `governance-engine`, `avatar-orchestrator`, `knowledge-engine`, `project-review-engine`, `heartbeat-engine` (conditionally), `whatsapp-webhook-v2`. None of these are currently cron-scheduled except `heartbeat-engine`, so most are latent risks rather than active incidents — but `avatar-orchestrator` is the Founder's own interactive avatar and `whatsapp-webhook-v2` is a live customer-facing channel, so both warrant attention regardless of cron status.

5. **A recurring "built for autonomy, never scheduled" pattern beyond founder-brain-tick.** `training-engine`, `pr-engine`, and `legal-engine` each have an additive `HEARTBEAT_SECRET`-gated path clearly intended for future cron/admin triggering that was never wired up — structurally the same situation as `founder-brain-tick` (see `FOUNDER_BRAIN_TICK_STATUS.md`), just not yet documented as such before this sweep.

6. **Some functions are already immune** — `accounting-engine`, `knowledge-search`, and `document-ingest` use OpenAI exclusively (embeddings or `gpt-4o-mini`), unaffected by the Anthropic outage by construction, not by design intent.

7. **`knowledge-engine` and `knowledge-search` appear to be two separate, overlapping implementations** of similar search functionality (older/simpler vs. newer/structured) — flagged for a future consolidation decision, not resolved here.

**Recommendation arising from this sweep (not yet approved — for Founder review):** expand the Phase 6A priority migration group from 4 to at least 6 functions (add `auto-agents-engine` and `founder-executive`), and treat the `ai-engine`/`founder-executive` fallback-defect as one shared bug-fix rather than two.

---

## 2. Hybrid AI Architecture Proposal

*Design only — nothing below is implemented.*

- **Provider abstraction layer:** One shared module (a genuine shared import, replacing the pattern where `brain-engine`, `brain-chat`, and `sales-engine` each independently copy-paste their own fallback logic) exposing a single `callLLM(prompt, opts)` entry point. Callers stop knowing which provider answered; they only see a normalized result.
- **Primary provider selection logic:** Config-driven priority order (e.g. a small `provider_priority` table or a project secret holding an ordered list), not hardcoded "try Anthropic first" in each file. Changing provider order becomes a config change, not a redeploy.
- **Backup provider strategy:** On failure, automatically try the next provider in priority order, capped at a fixed max attempts (e.g. 3) to bound worst-case latency and cost — an unbounded retry chain across providers is its own reliability risk.
- **Failure detection:** Distinguish "provider unavailable" (billing/quota exhaustion, 5xx, timeout) from "bad request" (malformed prompt, 4xx unrelated to quota). Only the former should trigger failover — retrying a malformed prompt on a second provider just fails twice at someone else's cost.
- **Cost control mechanism:** Extend the already-existing `agent_performance_metrics.estimated_cost_usd` tracking (already read by `getTokenEconomyReport()` in `executive-planner.ts`) so every provider populates it consistently, plus a simple pre-call check against a configurable daily spend ceiling — reusing existing infrastructure rather than inventing a second cost system.
- **Logging requirements:** Every call recorded with: provider(s) attempted in order, which succeeded (if any), latency per attempt, and the specific reason each skipped/failed provider was skipped. One consistent shape across all callers — today this is scattered and inconsistent per engine, which is part of why the executive-intelligence failure went unnoticed for a full day.

---

## 3. Migration Strategy

### Priority group (currently broken, migrate first)

| Function | Current: Provider / Auth / Prompt / Dependencies | Future: Routing / Fallback / Testing |
|---|---|---|
| `ai-engine` | Anthropic (`claude-3-haiku-20240307`) primary; service-role auth (internal call from `job-scheduler`); job-queue-shaped prompts (invoice/proposal/chat tasks); depends on `ANTHROPIC_API_KEY` | Route through shared `callLLM()` with configured priority; fallback triggers on *any* provider failure (fixing today's gap where fallback only fires if the key is unset); test by manually re-queuing one job of each type and confirming `net._http_response`/job status shows success on the fallback provider when Anthropic is deliberately excluded from the priority list |
| `lead-discovery` | Anthropic only (`claude-sonnet-4-6`); invoked by `auto-agents-engine`; extraction-style prompt over research-engine output; depends on `ANTHROPIC_API_KEY` | Same shared routing; test via one manual invocation with Anthropic temporarily deprioritized, confirming a real extraction result lands, not just a 200 |
| `evolution-engine` | Anthropic only; cron-triggered (`enterprise-evolution-daily`); capability-backlog-generation prompt | Same; test the same way as the executive-intelligence fix — manual `net.http_post` replicating the cron's exact call, read `net._http_response`, confirm expected row lands |
| `opportunity-engine` | Anthropic only; cron-triggered (`ceo-think-daily`) | Same pattern |

### Secondary group (has partial fallback already, verify + consolidate)

| Function | Current | Future |
|---|---|---|
| `brain-engine`, `brain-chat`, `sales-engine` | Each independently implements its own Anthropic→Gemini→OpenAI/GLM/DeepSeek chain (copy-pasted, not shared) | Consolidate onto the one shared `callLLM()` module so there is exactly one fallback implementation to reason about, not three that can silently drift from each other; test by confirming existing behavior is preserved (same provider selected in the common case) before removing the old per-file logic |

### Deferred group (not in 6A scope)

`_shared/founder-brain.ts` `reason()` — already has a real fallback chain and is architecturally closest to the target shared module. Migrating founder-brain-tick's own consumers is scoped to **Phase 6B** (it isn't scheduled at all yet, per `FOUNDER_BRAIN_TICK_STATUS.md`), not 6A. 6A should confirm this file's fallback logic is sound (since it's a natural candidate to become the shared abstraction itself) but should not activate anything that depends on it.

### Verification Sweep 0 (precondition, not a migration)

Before committing to which of the 25 unverified functions need migration: fetch each one's deployed source, grep for provider signatures, confirm whether it calls an AI provider at all. Functions with no AI call are out of scope entirely. This sweep produces the real, complete version of the Section 1 table's last row — it is listed here as the first concrete 6A task, to be done before any provider code changes.

---

## 4. Reliability Framework

**What happens if OpenAI fails?**
Falls back to the next provider in the configured priority order (Anthropic or Gemini, depending on config). If every configured provider fails, the function returns an honest error — no fabricated success, no silent 200 with empty content — and the failure is logged with which providers were tried and why each failed.

**What happens if Anthropic fails?**
Symmetric to the above. Additionally, "insufficient credit"/billing-type failures must be tagged distinctly from transient outages (rate limit, timeout) in the logging, because a credit exhaustion will not self-resolve on retry the way a transient failure might — today's incident is exactly this case, and nothing currently distinguishes it from a temporary blip.

**How does FKAIOS know an AI employee is unavailable?**
Today: it largely doesn't, reliably — a cron reporting "succeeded" only confirms the HTTP request was dispatched, not that the function's own logic completed (this is precisely how the executive-intelligence 401 went unnoticed). Proposed: a lightweight health view over the new consistent per-call logging (Section 2), showing each engine's last N calls, provider used, and outcome — queryable directly, and surfaced through the *existing* Governance Health panel in the Cockpit rather than a new UI element (no new dashboards, per the approved non-goals).

**How does the Founder get notified?**
Proposed: reuse the existing `approvals` / `founder_notifications` tables (already present, already used for other Founder-facing alerts) to raise a notification specifically when a function exhausts every configured provider — not on every transient retry, only on total failure. This avoids building a new notification channel and avoids alert fatigue from routine failovers that self-resolve.

---

## 5. Success Criteria

Phase 6A is complete only when:

- ✓ Executive Intelligence completes 3 automatic (scheduled, not manually triggered) cycles — verified via `net._http_response` status codes and corresponding `executive_cycles` rows, the same evidence standard used for today's fix.
- ✓ AI agents in the priority migration group no longer depend on a single provider — verified by confirming the shared routing module is in place and a deliberate single-provider-removed test succeeds for each.
- ✓ Failed-provider scenario tested — at least one deliberate test where the primary provider is excluded from the priority list and the system is confirmed to fail over correctly, not just in theory.
- ✓ No silent failures — every call's outcome is logged with provider and result; a "succeeded" status anywhere in the system (cron, function response, or log) must correspond to a real verified outcome, not just a dispatched request.
- ✓ Logs show provider used and outcome — queryable directly, per Section 2's logging requirement.
- ✓ Existing Cockpit continues working — no regression in any of the panels already confirmed honest in the Cockpit Truth Audit; this is a reliability change to the intelligence layer, not a UI change, and should be invisible to the Cockpit except that its data sources become more reliable.

---

## 6. Risk Assessment

**Possible breaking changes:**
Introducing a shared abstraction touches the entry point of every migrated function. The main risk is behavior drift — some functions (`executive-intelligence`) use structured tool-calling (`emit_cycle` function-calling schema), others use plain text completion. The abstraction must be a thin routing layer that preserves each caller's existing prompt/tool-call shape, not a rewrite of prompt logic — conflating "fix the provider routing" with "improve the prompts" would violate Preserve → Enhance → Extend and make rollback harder to reason about.

**Rollback approach:**
Nothing is deployed yet, so there is currently nothing to roll back. Once implementation begins, the same discipline used for today's executive-intelligence fix applies: each function is migrated and redeployed individually, verified via direct `net._http_response` inspection, with the prior byte-identical version available to redeploy immediately if the new version misbehaves. No batch "migrate everything at once" deploy.

**Database impact:**
None required for the core abstraction itself. A new lightweight table or view for consistent provider-call logging may be needed if `agent_performance_metrics`'s existing shape can't cleanly carry the new fields (provider-attempt list, skip reasons) — this is a design decision for implementation time, not committed to here, and would be a small additive migration, not a schema change to existing tables.

**Deployment impact:**
Each migrated function requires its own independent Supabase edge function deploy (functions deploy independently of each other). Migration should proceed one function at a time — priority group first, verified individually — not as a single combined deploy, so that a problem with one function's migration doesn't obscure or block the others.

---

## Phase 6A Scope Update — Post Verification Sweep 0

**Date:** 2026-07-24. This section supersedes the priority-group framing in Sections 1 and 3 above with what Verification Sweep 0 actually found. It is a scope proposal arising from evidence, not an approved change — Section 6 (Founder Decisions Required equivalent) still applies before any of this is implemented.

### 1. Updated priority migration group

The original plan scoped 4 functions as broken-and-first-to-fix. Sweep 0 confirms the group is now **6**:

| Function | Why it's in the priority group |
|---|---|
| `ai-engine` | Anthropic-only for its primary path; live 400 "credit balance too low" confirmed today; OpenAI fallback exists in code but only triggers if the key is unset, not rejected |
| `lead-discovery` | Anthropic only, no fallback; live 502 "credit balance too low" confirmed today |
| `evolution-engine` | Anthropic only, no fallback; live 502 confirmed today |
| `opportunity-engine` | Anthropic only, no fallback; live 502 confirmed today |
| `auto-agents-engine` | **Added by Sweep 0** — Anthropic only, no fallback; cron-scheduled every 30 minutes plus daily jobs; confirmed intermittently 502ing live today, same root cause as the other four, simply not named in the original scope |
| `founder-executive` | **Added by Sweep 0** — has an OpenAI fallback written in code, but it never fires (see Item 2 below); functionally equivalent to having no fallback at all |

### 2. Fallback-defect repair — shared reliability issue

Sweep 0 found that `ai-engine` and `founder-executive` share the **identical code defect**, not two separate bugs: each has an OpenAI fallback path written, but the catch block re-throws immediately whenever the error message is prefixed `"Anthropic API error"` — which is exactly the message shape the current credit-exhaustion failure produces. The fallback code is present and correctly reachable in principle; it simply never gets a chance to run against this specific failure type.

This is added to the plan as **one shared reliability fix**, not two independent ones: whatever correction is designed for `ai-engine`'s catch-block logic should be applied identically to `founder-executive`, since they are the same bug in two places. Treating them separately would risk the two implementations drifting again, the same way the copy-pasted 5-tier fallback chain (Item 3 below) has already drifted across 10 different functions.

### 3. 26-function AI dependency map — summary

Full detail in Section 1B. Condensed picture across all 26 swept functions plus the original 8 named functions (34 total AI-relevant components reviewed this session):

- **Zero fallback, would fail exactly like the priority group if invoked with real work:** 9 functions (`closer-engine`, `mis-engine`, `market-intelligence`, `governance-engine`, `avatar-orchestrator`, `knowledge-engine`, `project-review-engine`, `heartbeat-engine` (conditional), `whatsapp-webhook-v2`).
- **Fallback written but defective (fires-never bug):** 2 functions (`ai-engine`, `founder-executive` — see Item 2).
- **Real multi-provider fallback already working in code:** 15+ functions, but built as **10 independent copy-pasted implementations** of the same Anthropic→Gemini→OpenAI/GLM/DeepSeek chain (`brain-engine`, `brain-chat`, `sales-engine`, `learning-engine`, `business-engine`, `builder-engine`, `agent-engine`, `orchestrator-engine`, `orchestrator-brain`, `training-engine`), one of which (`orchestrator-engine`) is already confirmed running in a degraded state (broken GLM tier, DeepSeek billing issue of its own).
- **Already immune to the Anthropic outage by construction:** 4 functions using OpenAI exclusively (`executive-intelligence`, `accounting-engine`, `knowledge-search`, `document-ingest` — the latter two for embeddings only, not chat).
- **Confirmed live-broken today:** 5 functions (`ai-engine`, `lead-discovery`, `evolution-engine`, `opportunity-engine`, `auto-agents-engine`).
- **Genuine external webhook, explicitly not a migration candidate:** `whatsapp-webhook-v2` — sends real outbound messages, was not invoked, needs its own no-fallback issue addressed carefully given it's a live customer channel.

This confirms the Section 2 shared `callLLM()` abstraction proposal is addressing a widespread, verified problem (10 duplicated implementations) rather than a hypothetical one.

### 4. Autonomous Capability Inventory

Sweep 0 surfaced a recurring pattern beyond the one already documented in `FOUNDER_BRAIN_TICK_STATUS.md`: real, working AI capability that was built with autonomous triggering in mind and then never switched on. Tracked together here since they share the same activation-decision shape:

| Capability | Status |
|---|---|
| `founder-brain-tick` | Fully implemented cognitive loop (Confidence, Reflection, Importance, Curiosity, Belief, Learning); its cron migration exists in the repo and was never applied; zero autonomous runs ever (see `FOUNDER_BRAIN_TICK_STATUS.md` for full detail) |
| `training-engine` | AI-workforce training module generation; has an additive `HEARTBEAT_SECRET`-gated path clearly built for future cron/admin triggering; not currently scheduled |
| `pr-engine` | Marketing/PR campaign copy generation; same idle `HEARTBEAT_SECRET` pattern; not currently scheduled |
| `legal-engine` | First-pass contract risk review; same idle pattern; not currently scheduled |

None of these four are being activated as part of this plan. They are recorded here as a single inventory so that Phase 6B's activation-planning work (already scoped to `founder-brain-tick`) can consider whether the same deliberate scheduling/cost-budget decision process should extend to the other three, rather than each being discovered and decided on separately later.

### 5. Confirmation

- **No code changed** while producing this scope update.
- **No deployment** performed.
- **No migration** written or applied.
- **Awaiting Founder approval** before any of the above (expanded priority group, shared defect fix, or autonomous capability activation) moves into implementation.

---

## Constraints Honored While Producing This Plan

No code was written or changed. No migration was created or applied. Nothing was deployed. No secrets were read, set, or rotated. No cron job was created, modified, or activated. This document is planning only, per the approved Phase 6A scope.

**Stopping here — awaiting Founder review of this plan before any implementation begins.**
