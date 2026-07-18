# FKAIOS V2 Engineering Blueprint

**Status: for Founder review. No code changes until approved, per the Genesis document's explicit instruction.**

Every claim below is either (a) verified by reading actual code in
`contactmmx-ship-it/fkaios-aura-blueprint1`, current as of commit `2922eb3`,
or (b) explicitly marked as unverified/aspirational. Nothing here is
inferred from the Constitution documents alone — those describe what
FKAIOS should become; this describes what it actually is right now.

---

## 1. Current Reality

### 1.1 Architecture, as built

```
founder-brain.ts (canonical Brain — reason(), cognitiveTick(), memory, goals, imagination)
        ↓ imported by
executive-planner.ts (planning, reflection, intuition, provider performance,
                       capability graph, brain state, intelligence index)
        ↓ imported by
work-engine.ts (task allocation) ──┐
        ↓                          │
company-os.ts (capability dispatch registry, 7-of-30 verified callable)
        ↓                          │
curiosity.ts (research, deliberately unscheduled) ┘
```

Three real HTTP entrypoints exist (Supabase Edge Functions can't expose a
shared library directly to callers, so each is a thin wrapper):
- `founder-brain-tick` — the main cognitive cycle
- `founder-curiosity-tick` — research, deliberately **not** wired to a cron
  (cost governance: each call spends real Apify credits)
- `founder-brain-state` — read-only snapshot for the Founder Workspace UI

### 1.2 What is verified working — Five Tests passed, chain traced by reading code

| Capability | Evidence |
|---|---|
| **Reasoning** (`reason()`) | 3-provider fallback (Anthropic→Gemini→OpenAI), self-records every call to `agent_performance_metrics` (commit `5ba06fc`) |
| **Goal Hierarchy** | Seeded via idempotent guard; feeds `evaluateAgainstGoals()` → Decide phase (`3b31ee4`) |
| **Working Memory** | `think()` reads/writes real `brain_messages`/`brain_conversations` rows; **traced end-to-end**: `thought` → `evaluateAgainstGoals()` → Decide phase's prompt → the actual `act`/`wait` branch (verified this session, not assumed) |
| **Imagination** | `imagine()` reads its own last-5 history before generating new ideas — genuinely builds on or diverges from prior imagining (`e75a7c1`) |
| **Learning** | `recordOutcome()` writes real success/failure (bug found and fixed — was previously hardcoded to always-true, `c862a53`); read back via `getLearningTrend()`; a real decline becomes an urgent Executive Attention item (`2922eb3`) |
| **Risk Awareness** | Real `reason()`-based assessment feeds `createTask()`'s pre-existing approval gate, previously hardcoded to `'low'` on every task (`ef2867c`) |
| **Capability Graph** | Read-only representation: nodes = capabilities (including `reasoning` itself, no special path), edges = real weighted success rates from `execution_log`/`getProviderPerformance()` (`6a5f427`) |
| **Brain State** | Synthesis of goals, capability health, confidence, reflection, imagination, learning, running tasks, approvals, Executive Attention, Brain Intelligence Index (`a7220d1`, `d63ce8d`) |
| **Brain Intelligence Index** | 4 of ~16 requested dimensions have real quantitative evidence (Learning, Confidence, Execution Reliability, Mission Alignment); 9 explicitly listed as unmeasured with named reasons, not fabricated (`4950ec0`) |
| **Parallel Execution** | 5 independent tick operations run via `Promise.allSettled`, same failure-isolation as before, real wall-clock timing (`51001ce`, `464f93f`) |
| **Deployment verification** | Real, via GitHub's Deployments API (Vercel's GitHub integration posts status back) — used to confirm all 18 commits this session actually deployed successfully |

### 1.3 What is verified NOT existing (checked, not assumed absent)

- **Vision, Hearing, Speech, OCR** — zero API reference anywhere across all 85 edge functions (grep-confirmed)
- **Time awareness as cognition** — only per-call latency timers exist; nothing reasons about elapsed time or staleness
- **Cost-aware behavior** — spend is reported (`getTokenEconomyReport`), never acted on; no pricing table exists anywhere to make a cost-based decision honest
- **Provider-performance-informed routing** — real data exists (`getProviderPerformance`), `reasonCore()`'s fallback order is still hardcoded; deliberately deferred as a hot-path risk (12+ callers depend on this one function)
- **Capability-graph-informed routing** — the graph exists and has real weights; nothing consults it before dispatching a capability
- **Cross-employee collaboration** — flagged missing since Sprint 8, never built
- **Work Objects** — honestly stubbed; `work_objects` table does not exist
- **Confirmed autonomous execution** — the decisive gap. Two cron migrations exist in the repo: `20260629_schedule_agent_heartbeat_cron.sql` (pre-existing, presumably active, schedules something else) and `20260717000000_schedule_founder_brain_tick_cron.sql` (written this milestone, **never confirmed applied**). No code in this session has ever executed against the live database.

---

## 2. Vision Gap Analysis

| Genesis concept | Current reality |
|---|---|
| Autonomic System — "never sleeps, watches everything, generates ideas without being asked" | 100% built as code, 0% confirmed running. Every "autonomous" function requires a manual HTTP call today. |
| Conscious System — "Founder speaks, FKAIOS thinks, executes" | Pre-existing infra from before this milestone (BrainChat, Sprint 1) delegates to `reason()`, but nothing built this session extends it |
| Executive System — "everything competing for attention must pass through Executive Attention" | Real, but narrow: exactly 3 signal types compete today (pending high-risk approvals, learning decline, top goal fallback) — not "everything" |
| Thought System — "thousands of thoughts may exist, attention decides which survives" | Does not exist in this form. `cognitiveTick()` generates exactly **one** thought per cycle (`think()`'s single topic). There is no multi-thought generation-then-selection step. |
| "FKAIOS must possess every human and AI capability" | A small, real, verified subset exists (reasoning, memory, goals, imagination, learning, risk, reflection). The overwhelming majority of the requested capability list (vision, speech, negotiation, leadership, video, 3D, robotics, etc.) has zero implementation and zero provider credentials to build on. |

---

## 3. Missing Capabilities (intelligence, not features)

In rough priority order, each tied to why it matters rather than that it sounds impressive:

1. **Genuine, confirmed autonomy** — the root blocker. Nothing else's value is realized until this is true.
2. **Multi-thought generation + Executive Attention arbitration** — today's single-thought-per-cycle model doesn't match "thousands of thoughts, attention selects" even in miniature.
3. **Provider-performance-aware routing** — real data exists and is unused for the one decision it was built to inform.
4. **Capability-graph-aware routing** — same shape of gap, one layer up.
5. **Cost-aware behavior** — currently a real, named financial risk (unbounded spend once autonomy is confirmed), not just a missing nicety.
6. **Prediction-vs-outcome tracking** — predictions are generated every cycle and never checked against what actually happened; there is no feedback loop making prediction *quality* improve.
7. **Cross-employee collaboration** — named as missing since Sprint 8, still absent.
8. **Sensory capabilities** (vision/speech/OCR) — lowest priority by the Genesis document's own logic ("capabilities are permanent, providers are replaceable") since no provider credentials exist yet to build any of this on.

---

## 4. Dependency Graph

```
[Confirmed Autonomy]  ←── root dependency, blocks nearly everything below
        │
        ├──→ [Multi-Thought Generation + Attention Arbitration]
        │            │
        │            ├──→ [Provider-Performance Routing]  (needs real accumulated
        │            │            │                         data from autonomy running)
        │            │            └──→ [Capability-Graph Traversal Routing]
        │            │
        │            └──→ [Prediction-vs-Outcome Tracking] (needs autonomy running
        │                                                     long enough to have
        │                                                     real outcomes to check)
        │
        └──→ [Cost Governance]  ←── separate prerequisite: needs a pricing table
                                     built first, independent of autonomy

[Sensory Expansion] ←── independent branch, blocked on new provider credentials
                         the founder would need to supply
```

This session's own Level 1 audit found 10 of 13 checked capabilities
blocked or partial *specifically because of the autonomy gap* — this
dependency graph isn't theoretical, it's what was actually observed.

---

## 5. Execution Roadmap

| Phase | Content | Testable independently? |
|---|---|---|
| **A — Confirm Autonomy** | Run `DIAGNOSTIC_execution_pipeline_check.sql`; decide on cron 23/27; apply `20260717000000_schedule_founder_brain_tick_cron.sql`; observe one real scheduled invocation | Yes — a single Supabase function log entry showing an unrequested invocation is the pass/fail signal. **Founder-gated: requires Supabase access this environment doesn't have.** |
| **B — Multi-Thought + Attention Arbitration** | Extend `cognitiveTick()` to generate several candidate thoughts per cycle instead of one; Executive Attention scores and selects among them | Yes — code-buildable now, testable via `tsc` + tracing the selection logic, same methodology as this session's other fixes |
| **C — Provider-Performance Routing** | Use `getProviderPerformance()`'s real data to inform (not yet replace) `reasonCore()`'s try-order | Needs isolated review given blast radius — 12+ callers depend on this function; should not be bundled with other changes |
| **D — Capability-Graph Traversal Routing** | Company OS dispatch consults the graph's real edge weights before choosing an execution path | Depends on C's pattern being proven safe first |
| **E — Cost Governance** | Build a real per-model pricing table (prerequisite, doesn't exist); wire spend into an actual ceiling/throttle | Independent of A–D; can start anytime |
| **F — Prediction Tracking** | Store each cycle's `predicted` outcome; compare against what actually happened next cycle; feed accuracy back into Wisdom/Confidence | Needs Phase A running for enough real cycles to have outcomes to check |
| **G — Sensory Expansion** | Vision/Speech/OCR integration | Blocked until the founder supplies provider credentials; out of scope until then |

---

## 6. Definition of Done

**Phase A:** cron 23/27 status explicitly known (not assumed); `founder-brain-tick` cron applied; at least one real Supabase function invocation log observed that was **not** triggered by a manual call.

**Phases B–F (each):** must pass the Five Tests as this session defined and applied them — Exists, Executes, Influences Cognition, Influences Decisions, Self-Improves — verified by:
1. `tsc --noEmit` clean on the change and every file that depends on it, checked individually
2. The dependency chain traced by reading the actual code path (not assumed from the function's name)
3. Live execution confirmed via GitHub's Deployments API or Supabase function logs — not claimed without evidence

**Phase G:** cannot have a Definition of Done defined yet — depends on which provider the founder selects, which hasn't happened.

---

## 7. Risks and Technical Debt

- **`reasonCore()`'s fallback order is a single point of behavior for nearly all reasoning in the system.** Any future change here needs isolated testing given a 12+ file blast radius — this is why Phase C was deliberately deferred three separate times this session rather than rushed.
- **Unbounded LLM/Apify cost with no ceiling.** Real financial risk, not hypothetical — becomes urgent the moment Phase A is confirmed, since a 15-minute autonomous cycle with no budget check could scale spend quickly.
- **Two Vercel projects deploy from the same repo** (`fkaios-aura-blueprint1` and `fkaios-aura-blueprint1-lmjz`) — unresolved, founder's decision needed on whether both are intentional.
- **`work_objects` table doesn't exist.** Any future Work Engine expansion that assumes it will hit a wall until a schema decision is made.
- **No pricing table anywhere in the codebase.** Blocks every honest cost-based decision until built.
- **The 2026-07-13 fabrication incident** (pre-dating this milestone, real, confirmed via the repo's own commit history) disabled two crons; whether they were safely re-enabled is still unconfirmed by the founder as of this writing.
- **The single largest item:** every commit this session is verified in the sense of *compiles correctly and deploys successfully* — none of it has been verified in the sense of *runs correctly under real autonomous load*, because it has never run autonomously at all. That gap is real, has been stated consistently, and is the one item on this entire list that only the founder can close from here.
