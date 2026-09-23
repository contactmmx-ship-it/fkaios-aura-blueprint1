# FKAIOS V1 — Capability Classification (KEEP / MODIFY / REBUILD / MISSING)

Produced as step 1 of the V1 Autonomous Completion mandate. Grounded in
`FKAIOS_ARCHITECTURE_INVENTORY_2026-09-21.md`,
`FKAIOS_KERNEL_CONSOLIDATION_PHASE1_DEPENDENCY_GRAPH.md`, and live checks run
today (`cron.job`, `ai_jobs`, `orchestrator_requests`, `execution_log`,
`agent_performance_metrics`, function runtime logs) — not re-derived from
scratch. Every verdict below cites the evidence it rests on.

## Scope decision, stated up front

FKAIOS already runs **five independent, non-communicating work-item
schemas** (`ai_jobs`; `orchestration_projects`/`orchestration_tasks`;
`orchestrator_requests`; `fleet_memory`; `agent_dispatch_log`/
`agent_schedules`), each serving different live, revenue-relevant engines
(`orchestrator-engine`, `orchestrator-brain`, `governance-engine`,
`executive-intelligence`, `workday-engine`, ...). The inventory's own
Section 6 flags that deprecating or merging any of them is a genuine
business-risk decision, not an engineering cleanup. **This mandate's "one
objective → FKAIOS manages the journey" loop is scoped to the Founder's own
objective path** (`orchestrator_requests` tagged `requested_by:
'founder-brain'` → `orchestration_projects`/`orchestration_tasks` via
Executive Planner → `ai_jobs` via Work Engine → AI Engine execution →
Work Engine closes the loop → Objective Loop evaluates). The other four
schemas are left untouched — REBUILD/MERGE of those is explicitly out of
scope without founder sign-off, per the inventory's own finding.

## Objective Management

| Capability | Verdict | Evidence |
|---|---|---|
| Create one high-level objective | KEEP | `founder-brain.ts createTask()` → `orchestrator_requests` insert, real risk-gated (`approvals` row filed for high/critical). |
| Objective persists | KEEP | `orchestrator_requests` table, live, non-empty (4 pre-existing test rows confirmed via query today). |
| Objective → plan → tasks | KEEP | `executive-planner.ts planObjective()`: real LLM decomposition into 2-4 tasks, writes `orchestration_projects` + `orchestration_tasks`, tagged `[objective:<id>]`. |
| Dependencies represented | MISSING | `orchestration_tasks` has no dependency/ordering column; Executive Planner always creates all tasks `status:'pending'` simultaneously. Section 15 (concurrency) partially works by accident (nothing blocks parallel execution) but ordered/dependent task chains are not modeled at all. |

## Autonomous Execution (the core loop)

| Capability | Verdict | Evidence |
|---|---|---|
| Continuation trigger (this cycle → next cycle, no chat message) | **MODIFY → now KEEP** | Was the single biggest gap: `founder-brain-tick`'s cron migration existed since Sprint 2b but was explicitly marked "NOT APPLIED". **Applied today** (`fkaios-founder-brain-tick`, `*/15 * * * *`, `cron.job.jobid=39`, confirmed active). Verified via a real manual invocation (not simulated): `cognitiveTick` ran a full Observe→Think→Imagine→Predict→GoalEval→Decide cycle (5 real Anthropic calls, `agent_performance_metrics` timestamps 10:37:17–10:37:56Z), made an honest `decision:"wait"` (real business state is empty — ₹0 revenue, 0 leads — so "nothing to do" is correct, not a stall), and `runObjectiveLoop()` ran with zero errors in the function's own runtime logs. |
| Objective evaluation (not just task completion) | KEEP (fixed this session) | `objective-loop.ts`'s `evaluateObjective()` had a real bug — `reason()` always returns an `LLMResult` object, never a bare string, so the original `typeof response === "string"` branch was dead code and every idle objective would replan forever, never reaching completed/blocked/failed. Fixed to parse `response.text` with tolerant JSON extraction; deployed and verified live (v5). |
| Work queue (durable, claimed/running/completed/failed) | KEEP | `ai_jobs` — real queue, drained by `ai-engine`'s `runPendingJobs()`. Confirmed **not starved**: although the standalone `ai-engine-run-jobs-5min` cron is `active:false`, `job-scheduler-drain` (active, every 10 min) invokes the exact same `ai-engine?action=run_jobs` endpoint as a side effect of `processPending()` — confirmed by reading `job-scheduler/index.ts` directly. Live `ai_jobs` rows from 10:30Z today (`ai_job` task_type in `agent_performance_metrics`) confirm this path is actively executing. |
| Stale-job recovery / leases | KEEP | `reap_orphaned_ai_jobs()` — pure-SQL cron (`ai-jobs-orphan-reaper`, every 10 min, active), requeues/fails jobs stuck >15 min. `work-engine.ts`'s `reassignStuckWork()` extends this by picking a genuinely different, better-fit employee for jobs the reaper already failed — not a duplicate. |
| Worker/agent selection | KEEP | `work-engine.ts selectBestEmployee()` — real: filters by department, excludes inactive/error/offline, ranks by lowest active-job-count then highest success-rate. Confirmed the only real selection logic in the codebase (everywhere else hardcodes an agent id). |
| Concurrency for independent tasks | KEEP (incidental) | Nothing serializes task execution — `allocateProjectWork()` allocates every pending task in a project to `ai_jobs` in one pass; `ai-engine`/`job-scheduler` process them independently. Works today because no dependency model exists yet (see Objective Management row above) — there's nothing to violate. |
| Retry limits / anti-infinite-loop | PARTIAL / MODIFY | `llm-router.ts` has real per-class retry limits (`retryLimitByClass`, 3 for `founder_intelligence`) and per-call timeouts (60s). `runObjectiveLoop()` caps at 10 objectives/tick. **Gap**: `objective-loop.ts`'s "replan" path has no cap on how many times the same objective can be replanned — an objective that never reaches achieved/blocked/failed will get a fresh `planObjective()` call every 15 minutes, forever, with no stored replan-count or backoff. Flagged as a MODIFY item, not fixed yet (Section 22 concern). |

## AI / Model Routing

| Capability | Verdict | Evidence |
|---|---|---|
| Central router, multi-provider | KEEP | `llm-router.ts` — real Anthropic/Gemini/OpenAI adapters, failure classification, cost estimation, structured logging. |
| Founder Brain on canonical router | KEEP (this session) | `founder-brain.ts reasonCore()` now calls `llm-router.ts callLLM()` exclusively — no hardcoded per-provider fetch calls remain in this file. |
| Router adoption across engines | MISSING (documented gap, not this pass's job) | Per the inventory, only 3 of ~90 functions import `llm-router.ts` directly (`ai-engine`, `market-intelligence`, one comment-only reference). `staff-engine`/`decision-engine`/`sales-engine` were migrated onto `founder-brain.ts`'s `reason()` (→ router) earlier this session; `brain-engine` deliberately deferred (needs optional tool-schema support in the router first — native Anthropic `web_search` would break). Every other business engine still hardcodes its own model/fallback. |
| Provider-independent project state | KEEP | Objective/task/job state lives in Postgres tables, never in any model's own chat history — `orchestrator_requests`/`orchestration_*`/`ai_jobs` are the durable state, `reason()` is a stateless call. |

## Memory / State

| Capability | Verdict | Evidence |
|---|---|---|
| Persistent objective/decision/learning state | KEEP | `fleet_memory` (goals/decisions/reflections/learning/imagination, tagged by `memory_type`), `execution_log` (episodic), `agent_performance_metrics` (cost/model telemetry) — all real, all confirmed populated by today's test tick. |
| Resume after interruption | KEEP | Nothing here holds in-process state between ticks — every tick reads goals/state fresh from Postgres. A worker restart or session termination loses nothing because nothing was held in memory to begin with. |
| Schema-level memory typing (FACT/DECISION/EPISODIC separation) | MISSING | Per the inventory: everything is one `fleet_memory` table distinguished only by a free-text `memory_type` column. Real but unstructured. Not blocking V1's core loop; flagged as a known gap. |

## Verification & Recovery

| Capability | Verdict | Evidence |
|---|---|---|
| Verification before completion | PARTIAL | `objective-loop.ts`'s `evaluateObjective()` is a real LLM-graded check against actual project/task evidence (now fixed, see above) — this is verification, not self-declaration. **Gap**: it's LLM-graded, not tied to any deterministic acceptance criteria (tests passing, a build succeeding) for engineering-shaped objectives. Fine for business objectives; would need a real test-runner hook for code-shaped ones (Section 6/23's "controlled repository maintenance task" example). |
| Controlled-failure recovery test | MISSING | Not yet run this session (Task #20, in progress). `reap_orphaned_ai_jobs()` + `reassignStuckWork()` give real infrastructure for it; no end-to-end test has exercised "inject failure → diagnose → retry → verify → continue" against the live objective loop yet. |

## Aura UI (control surface)

| Capability | Verdict | Evidence |
|---|---|---|
| Objective/status/current-task/blockers/approvals visible | MISSING (built but unmounted) | Per the inventory: `src/components/fkaio/AppShell.tsx` and its full component set (`Dashboard`, `WorkforcePanel`, `ApprovalsPage`, `OrchestratorAI`, `GovernanceDashboard`, `DecisionCenter`, `KnowledgeVault`) are real, DB-backed (verified no hardcoded arrays), but `AppShell.tsx` has **zero imports anywhere** — unreachable from the live site. Routed pages are only `/`, `/cockpit-preview` (both `FounderCockpit`), `/franchise`, `/products`. No `/dashboard`, `/objectives`, `/approvals`, `/governance` routes exist. This is Task #19. |
| Resume automatically after human approval | UNVERIFIED | `approvals` table + `ApprovalsPage` component exist and are wired to real data, but since the page isn't mounted, the approve→resume flow has never been exercised end-to-end from the UI. The backend side (an approved `orchestrator_requests` row still needs something to flip it back to `processing` and re-enter the loop) was not found as an explicit mechanism — likely a real MISSING piece once Aura is mounted. |

## Observability

| Capability | Verdict | Evidence |
|---|---|---|
| Traceable objective→plan→task→agent→model→result chain | KEEP | Confirmed today by direct query: a single tick's correlation id ties together `execution_log`, `agent_performance_metrics`, and `fleet_memory` writes; `founder-brain-tick`'s JSON response bundles `planned`/`allocated`/`escalated`/`returned`/`dispatched`/`objectiveLoop`/`parallelExecutionSummary` in one payload. |
| "Why did FKAIOS stop?" answerable from state | PARTIAL | `decisionWithheldReason` (added this session) gives an honest reason when the Brain couldn't reach act/wait. `objective-loop.ts`'s per-objective `summary` field explains blocked/failed/no_action outcomes. **Gap**: no single dashboard surfaces this today (ties back to the Aura UI gap above) — the evidence exists in tables, not in a human-readable view. |

## Cost Control

| Capability | Verdict | Evidence |
|---|---|---|
| Per-call retry/timeout limits | KEEP | `llm-router.ts` `retryLimitByClass`/`timeoutMsByClass`. |
| Token/cost tracking | KEEP | `agent_performance_metrics.estimated_cost_usd`, `getTokenEconomyReport()` (executive-planner.ts) — real, with honest caveats about what it can't yet price (Gemini has no cost table). |
| Bounded replan/retry at the objective level | MISSING | See "Retry limits / anti-infinite-loop" row above — no cap on repeated replanning of a single stuck objective. Real risk once real objectives start flowing (currently zero `founder-brain`-tagged objectives exist in production, so risk is latent, not active, today). |
| Cron cadence sized to cost | KEEP | 15-minute interval was deliberately chosen in the original migration's own comment to bound LLM-call volume (~4-8 calls/hour of self-reflection, not 24+). |

## Testing

| Capability | Verdict | Evidence |
|---|---|---|
| `llm-router.ts` unit tests | KEEP | 29/29 passing (confirmed earlier this session). |
| `work-engine.ts` unit tests | KEEP | 8/8 passing (confirmed earlier this session). |
| End-to-end autonomous multi-task test | MISSING | Not yet run — Task #20. |
