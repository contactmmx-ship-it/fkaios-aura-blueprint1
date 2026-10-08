# FKAIOS independent re-audit (8 Oct 2026)

**Sources:**
- repo `main` at `6d3ec14`;
- unmerged branches `feat/canonical-project-state` and `feat/capability-benchmarking`, plus `feat/automatic-capability-discovery` at `cc707df` (PRs #45, #46);
- live Supabase `nrlsqshkjuuwiovthrnb`: catalog, `schema_migrations`, table row counts, `cron.job`, deployed function versions and their source;
- runtime rows: `orchestrator_requests`, `ai_jobs`, `agent_runs`, `fkaios_verification_evidence`.

**Evidence ladder:** code → migration → DB object → deployed → called → connected to real execution → real data → affects behaviour. A stage counts as done only when it reaches the last rung in production.

## 1. Stage verification

| # | Stage | Claimed | Actual | Evidence | Production connected? | Gap |
|---|---|---|---|---|---|---|
| 1 | Objective | Done | ✅ DONE (once, low quality) | Objective `4e50bb9a`: request → contract → project → 3 `ai_jobs` → 3 `agent_runs` → `fkaios_verification_evidence` row → `final_output` → COMPLETED, shown in Console. Founder approval gate enforced by unique indexes | Yes | The answer was built from truncated vault excerpts and nothing checks its correctness. LLM capacity is a single free Gemini quota (Anthropic and OpenAI out of credit, `provider_connections` = 0) |
| 2 | Canonical State | Done (branch) | ❌ NOT DONE | `fkaios_project_state` exists only in migration `20261008090000` on the unmerged branch. The table is absent live | No | Not merged or applied. On the branch it is written only at init (`allocateProjectWork`) and never updated as work progresses |
| 3 | Continuity | Done (branch) | 🟡 PARTIAL | Live: `worker_handoffs` (20 rows) and `fkaios_worker_checkin` for coding workers. Branch: `canonical_project_state` added to the handoff packet in `reassignStuckWork` | Legacy path only | The branch packet is unreachable (not deployed, and it depends on stage 2). No resume-from-state for objective-loop jobs |
| 4 | Capability Registry | Done | 🟡 PARTIAL | `capability_registry` holds 36 rows. On `main`, the only reader is `objective-discovery.ts:90`, which keyword-scores rows into **planning context** | Read as planning context only | It does not select the worker or model that executes. No health or cost updates from real runs |
| 5 | Capability Graph | Done (branch) | ❌ NOT DONE | `fkaios_capability_graph_edges` and `fkaios_get_capability_graph` exist only in branch migration `20261008093000`; absent live; 0 callers in any branch | No | Not applied, no reader, no writer |
| 6 | Execution Evidence | Done | 🟡 PARTIAL | Live: `ai_jobs`, `agent_runs` (reaper closes runs open >30 min), 1 `completion_gate:all_tasks_verified` row | Yes | No per-capability or per-resource attribution, no cost per task, no quality score. Evidence only records that every task ended, not that the answer is right |
| 7 | Outcome Learning | Done (branch) | ❌ NOT DONE | `fkaios_capability_outcomes` exists only on the branch; absent live | No | Not applied. **Design defect:** outcomes are written under `company-os:<capability>`, but routing reads `worker:<id>`/`<id>`, so learning could never change routing even if deployed |
| 8 | Resource Routing | Done | 🟡 PARTIAL (provider failover only) | Live `llm-router.ts` reads `provider_health_state` and skips unhealthy providers. On `main`, nothing calls `fkaios_select_worker`, `compute_model_choice` or `model_routing_rules` | Failover yes; evidence-based routing no | `selectBestEmployeeWithEvidence` is branch only. Its capability regex (`capability: x` in the description) rarely matches real task text |
| 9 | Benchmarking | Done (PR #45) | 🟡 PARTIAL (schema only) | `capability_benchmarks` and `fkaios_rank_benchmarked_resources` exist live (applied out of band 8 Oct 08:02; not on `main`). 0 rows. The `capability-benchmark` function is not deployed | No | Nothing writes benchmarks. The endpoint design accepts caller-reported success, verified and quality values, so it is self-graded |
| 10 | Governed Adoption | Done (PR #45) | ❌ NOT DONE | `capability_adoption_proposals` exists live with 0 rows. No code writes `adopted` or `decided_by`. Proposals are not linked to `approvals` or the Decision Center | No | No decision path, nothing applies an adoption, no rollback |
| 11 | Discovery | Done (PR #46) | 🟡 PARTIAL | `fkaios_discover_capabilities` ran once by hand at 08:02:08, producing 8 candidates (3 eligible, 5 blocked), all with `capability_id` NULL | No cron, no caller | It only re-reads the internal, hand-maintained `model_registry`. No external source. The 3 "eligible" candidates are Anthropic models, but Anthropic has no credit |
| 12 | Controlled Test Queue | Done (PR #46) | 🟡 PARTIAL (rows only) | `capability_test_queue` has 3 rows, all `queued`, `attempts`=0 | No consumer in any branch | No worker, no lease or timeout. `unique(candidate_id, suite, status)` blocks a second `passed` or `failed` row per candidate |
| 13 | Automatic Test Execution | Claimed next | ❌ NOT DONE | 0 code references to dequeuing | No | Everything |
| 14 | Evidence → Benchmark | Claimed | ❌ NOT DONE | No path from `agent_runs` or `fkaios_verification_evidence` to `capability_benchmarks` | No | Everything |
| 15 | Incumbent Comparison | Claimed (PR #45) | ❌ NOT DONE | Code (undeployed) sets the incumbent to the top-ranked benchmark row (`ranked[0]`), not the resource production actually uses | No | Wrong definition of incumbent; no data |
| 16 | Automatic Adoption Proposal | Claimed (PR #45) | ❌ NOT DONE | Undeployed code; confidence = verified attempts × 10; 0 proposals | No | Depends on stages 13–15 |
| 17 | Self-Evolution | Claimed | ❌ NOT DONE | `ai_evolution` = 0 rows. `evolution-engine` exists live only (source snapshot) and does not feed routing | No | Everything |

## 2. False positives

**FALSE POSITIVE #1: PRs #45 and #46 deliver the stages "on main".**
- **Reality:** both PRs are unmerged; `main` = `6d3ec14`. Their migrations were applied to production out of band (8 Oct, 08:02).
- **Evidence:** `schema_migrations` vs `git log origin/main`.
- **Severity:** High. Production schema is ahead of the repo again, which recreates the drift steps 2–3 removed.
- **Required correction:** either merge both migrations to `main` as already applied, or record them in `live-snapshot` with an explicit "applied out of band" note. No new production writes until then.

**FALSE POSITIVE #2: "Benchmarking is live".**
- **Reality:** the tables are empty and `capability-benchmark` is not deployed (not in the CI list, not in the live function list).
- **Evidence:** `count(*)` = 0; deployed-function list.
- **Severity:** High.
- **Required correction:** report it as "schema only".

**FALSE POSITIVE #3: "Discovery is automatic".**
- **Reality:** one manual invocation, no cron, no caller, and the only source is the internal `model_registry`.
- **Evidence:** `cron.job` has no entry; a grep finds 0 callers.
- **Severity:** Medium.
- **Required correction:** report it as "manual, internal-only".

**FALSE POSITIVE #4: "Controlled test queue".**
- **Reality:** 3 rows that nothing will ever dequeue.
- **Evidence:** 0 consumers; `attempts` = 0.
- **Severity:** Medium.
- **Required correction:** report it as "inert".

**FALSE POSITIVE #5: "Outcome learning improves routing".**
- **Reality:** the code is undeployed, and even if deployed the write key (`company-os:x`) never matches the read key (`worker:id`).
- **Evidence:** branch `work-engine.ts` diff.
- **Severity:** High; it is a design defect, not only a deploy gap.
- **Required correction:** use one `resource_ref` scheme for both writes and reads.

**FALSE POSITIVE #6: "Verified outcomes".**
- **Reality:** `verified` is set true by capability name (research.run, product.deploy, product.verify, knowledge.search), and benchmark `verified` and `quality` are supplied by the caller. Nothing independently checks them.
- **Evidence:** branch `returnCompletedWork`; `capability-benchmark` action `record`.
- **Severity:** High; the system would learn from self-grading.
- **Required correction:** only a separate verifier may set `verified`.

**FALSE POSITIVE #7: "Canonical project state / continuity".**
- **Reality:** the table is not live. On the branch it is written once at init, so it would show stale state.
- **Evidence:** branch migration and diff; live catalog.
- **Severity:** Medium.
- **Required correction:** write state on every task transition, or don't claim it.

**FALSE POSITIVE #8: "Incumbent comparison".**
- **Reality:** the incumbent is the best benchmark row, not the resource production currently routes to.
- **Evidence:** `capability-benchmark/index.ts`, `incumbent = ranked[0]`.
- **Severity:** Medium.
- **Required correction:** the incumbent must come from the router's actual current choice.

**FALSE POSITIVE #9: "Capability registry drives execution".**
- **Reality:** on `main` it is read only for keyword-scored planning context.
- **Evidence:** `objective-discovery.ts:90`; 0 callers of `fkaios_select_worker` or `compute_model_choice`.
- **Severity:** Medium.
- **Required correction:** report it as "planning context only".

## 3. Real current position

**Proven in production:**
- One governed objective ran end to end: founder approval gate → plan → jobs → runs → completion evidence → deliverable → Console.
- Provider-health failover.
- The stale-run reaper.
- Security hardening.
- Repo ↔ production reconciliation for the 5 CI-deployed functions.

**Not proven:**
- answer quality;
- repeatability (n = 1);
- any learning, benchmarking, discovery-to-adoption or self-evolution behaviour.

**Operational blocker:** LLM capacity is one free, rate-limited Gemini model.

## 4. Additional required components

Columns: **Exists?** is what is in production now; **Needed for** is the stage it unblocks.

| Component | Exists? | Needed for |
|---|---|---|
| Planning | 🟡 executive-planner (LLM plan, no validation) | 1 |
| Decomposition | 🟡 3-task split, fixed shape | 1 |
| Dependencies between tasks | ❌ tasks are independent | 1, long work |
| Goal verification (answer vs objective) | ❌ | 1, 6, 14 |
| Quality gates (rubric, independent grader) | ❌ | 6, 9, 14 |
| Retry / recovery | 🟡 ai-engine retries, reaper | 1 |
| Provider failure | 🟡 failover with no second provider | 1 |
| Context-limit handling | ❌ (vault excerpts truncated) | 1 quality |
| Budget enforcement | 🟡 `log_llm_cost`; no per-objective cap | 13 |
| Permissions | ✅ service-role only, anon closed | — |
| Approval gates | ✅ Founder Brain gate (unique indexes) | 10 |
| Idempotency | 🟡 unique indexes on gates; the queue unique key is wrong | 12–13 |
| Concurrency / leases | ❌ no `FOR UPDATE SKIP LOCKED` lease on the queue | 13 |
| State machine (enforced transitions) | 🟡 terminal guards only | 2, 12 |
| Observability | 🟡 rows exist; no dashboard of loop health | all |
| Evaluation sets (golden objectives) | ❌ | 9, 14 |
| Regression tests | 🟡 `objective-rerun.test.ts` 15/15; no end-to-end evaluation | 15 |
| Versioning (prompt, model, routing rule) | ❌ | 15–17 |
| Resource lifecycle / retirement | ❌ | 11, 17 |
| Memory separation (facts vs learned policy) | ❌ | 7 |
| Learning safety (min sample size, holdout, rollback) | ❌ | 7, 16 |
| Rollback | ❌ | 10, 17 |
| Continuous discovery / evaluation | ❌ | 11–14 |
| Multi-agent coordination | 🟡 coding-worker handoffs only | 3 |
| Long-running work | ❌ | 2, 3 |
| Autonomous verification | ❌ | 14 |
| End-to-end objective verification | 🟡 every task ended ≠ objective met | 1 |

## 5. Architecture: current → gaps → target

**CURRENT:**
1. Founder objective → approval gate → `objective-loop` (plan, jobs) → ai-engine → `llm-router` (health failover) → output.
2. Completion evidence ("all tasks ended") → deliverable.
3. On the side, with nothing connected to them: discovery candidates, test queue, benchmark tables, adoption table.

**GAPS:**
- no answer verification;
- no resource attribution per run;
- no runner for the test queue;
- no independent grading;
- no single `resource_ref` scheme;
- no link from the router to adoption;
- no rollback;
- repo ↔ production drift for PRs #45 and #46.

**TARGET:** extend the existing subsystems; add no new ones.
1. **ai-engine** stamps every `agent_runs` row with `resource_ref`, cost and latency.
2. A **verifier step** in `objective-loop`: an independent model grades against an acceptance rubric and writes `fkaios_verification_evidence` with a score.
3. A **queue runner** in founder-brain-tick:
   - leases one `capability_test_queue` row;
   - runs a fixed golden suite through the same ai-engine path;
   - the verifier writes `capability_benchmarks`.
4. **Ranking** compares the candidate with the router's actual incumbent.
5. A **proposal** goes to `approvals`, which the Decision Center already handles.
6. On founder approval, a **`model_routing_rules` row** is written, and `llm-router` reads it. The row is versioned, with a one-click revert.

## 6. Roadmap

### P0: make what exists true and usable

**P0.1 Repo ↔ production for PRs #45 and #46**
- **Why:** the schema is live but not on `main`.
- **Current:** applied out of band.
- **Missing:** a repo record.
- **Dependencies:** none.
- **Implementation:** fix the queue unique key, then merge the migrations, marked as already applied.
- **Verification:** `schema_migrations` names match the repo.

**P0.2 LLM capacity**
- **Why:** nothing runs reliably.
- **Current:** a free Gemini quota.
- **Missing:** a paid or second provider.
- **Dependencies:** founder action.
- **Implementation:** add credit or a key (founder).
- **Verification:** `provider_health_state` shows 2 providers available.

**P0.3 Goal verification**
- **Why:** completion ≠ correct.
- **Current:** "all tasks ended".
- **Missing:** a grader.
- **Dependencies:** P0.2.
- **Implementation:** a verifier step in `objective-loop` that blocks completion below a threshold.
- **Verification:** a deliberately wrong answer is rejected.

### P1: attribution and evaluation

**P1.1 Per-run resource attribution**
- **Why:** prerequisite for any learning.
- **Current:** runs have no `resource_ref`.
- **Missing:** a column and a write.
- **Dependencies:** none.
- **Implementation:** ai-engine writes provider:model, tokens, cost and latency.
- **Verification:** 100% of new runs are stamped.

**P1.2 Golden evaluation set**
- **Why:** repeatable benchmarks.
- **Current:** none.
- **Missing:** a suite.
- **Dependencies:** P0.3.
- **Implementation:** 10–20 objectives with acceptance criteria, stored as `fkaios_default_v1`.
- **Verification:** the suite runs against the incumbent and the score is stored.

**P1.3 One `resource_ref` scheme**
- **Why:** FALSE POSITIVE #5.
- **Current:** mismatched keys.
- **Missing:** a convention.
- **Dependencies:** P1.1.
- **Implementation:** `model:<provider>:<model>` and `worker:<id>` everywhere.
- **Verification:** the ranking read returns the rows that were written.

### P2: closed evaluation loop

**P2.1 Queue runner**
- **Why:** stage 13.
- **Current:** inert rows.
- **Missing:** a consumer.
- **Dependencies:** P1.1, P1.2, P0.2.
- **Implementation:** a lease with `SKIP LOCKED`, a budget cap and timeout in founder-brain-tick, and a fixed unique key.
- **Verification:** a queued row moves to passed or failed, with benchmark rows.

**P2.2 Evidence → benchmark**
- **Why:** stage 14.
- **Current:** self-reported values.
- **Missing:** an independent writer.
- **Dependencies:** P0.3.
- **Implementation:** only the verifier writes `capability_benchmarks`; the external `record` action is removed.
- **Verification:** no row exists without a linked evidence id.

**P2.3 True incumbent comparison**
- **Why:** stage 15.
- **Current:** `ranked[0]`.
- **Missing:** the router's actual choice.
- **Dependencies:** P2.2.
- **Implementation:** the incumbent is the current router choice for the capability.
- **Verification:** comparison rows name the live model.

### P3: governed adoption and evolution

**P3.1 Proposals into `approvals` and the Decision Center**
- **Why:** stages 10 and 16.
- **Current:** an empty table.
- **Missing:** a link.
- **Dependencies:** P2.3.
- **Implementation:** reuse the approvals flow.
- **Verification:** a proposal appears in the Decision Center, and approve or reject is recorded.

**P3.2 Adopt with rollback**
- **Why:** stage 17.
- **Current:** none.
- **Missing:** a routing-rule write path.
- **Dependencies:** P3.1.
- **Implementation:** a versioned `model_routing_rules` row read by `llm-router`; automatic revert if the post-adoption score drops.
- **Verification:** routing changes after approval, and reverting restores it.

**P3.3 External discovery and retirement**
- **Why:** stage 11.
- **Current:** internal registry only.
- **Missing:** sources and a retirement rule.
- **Dependencies:** P2.
- **Implementation:** a provider model-list fetch on a daily cron; retire resources after N failures.
- **Verification:** a new model appears with no manual edit.

## A. REAL CURRENT STAGE

Based on repository + Supabase + runtime evidence, FKAIOS is currently at **Stage 1 (governed objective execution), proven once end to end, with partial execution evidence (Stage 6) and provider-failover routing. Stages 2–17 are not functioning in production. Stages 9, 11 and 12 exist only as database schema with seed rows, and stages 2, 5 and 7 exist only as unmerged branch code.**

## B. VERIFIED DONE
- Objective loop end to end (`4e50bb9a`).
- Founder approval gate.
- Completion-evidence row and deliverable.
- `agent_runs` closure and reaper.
- Provider-health failover.
- Security hardening.
- Repo ↔ production parity for the 5 CI functions.

## C. PARTIALLY DONE
- 3 Continuity (legacy coding-worker handoffs).
- 4 Registry (planning context only).
- 6 Execution evidence (no attribution or quality).
- 8 Routing (failover only).
- 9 Benchmarking (schema only).
- 11 Discovery (manual, internal source).
- 12 Test queue (inert rows).

## D. NOT DONE
- 2 Canonical state.
- 5 Graph.
- 7 Outcome learning.
- 10 Governed adoption.
- 13 Automatic test execution.
- 14 Evidence → benchmark.
- 15 Incumbent comparison.
- 16 Automatic adoption proposal.
- 17 Self-evolution.

## E. FALSE CLAIMS / FALSE POSITIVES

See §2:
1. Merged/live claims for PRs #45 and #46.
2. Benchmarking live.
3. Automatic discovery.
4. Controlled queue.
5. Learning affects routing.
6. Verified outcomes.
7. Canonical state.
8. Incumbent comparison.
9. Registry drives execution.

## F. ADDITIONAL REQUIRED COMPONENTS

See §4. The critical ones:
- goal verification and an independent grader;
- per-run resource attribution;
- a golden evaluation set;
- queue lease, budget and timeout;
- a single `resource_ref` scheme;
- versioned routing rules with rollback;
- learning-safety thresholds.

## G. NEXT 5 IMPLEMENTATION PRIORITIES
1. Reconcile PRs #45 and #46 into `main` (fix the queue unique key); no new out-of-band production writes.
2. Restore LLM capacity (founder action: credit or a second provider key).
3. Add a goal-verification step to `objective-loop` that blocks completion below the rubric threshold.
4. Stamp every `agent_runs` row with `resource_ref`, cost and latency, under one `resource_ref` scheme.
5. Build a golden evaluation suite, then the queue runner that writes benchmarks only from verifier evidence.

## H. FINAL AUTONOMY SCORE

**FKAIOS implementation maturity: 15%**

Basis:
- 1 of 17 stages is fully done and production-proven (n = 1).
- 7 stages are partial, weighted 0.05–0.4 each, by how far up the evidence ladder they reach.
- 9 stages get 0.
- No credit for schema, seed rows or unmerged branch code.
