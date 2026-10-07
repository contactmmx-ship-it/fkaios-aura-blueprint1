# FKAIOS — Master Source of Truth

**Merged history across ChatGPT, Claude, Claude Code, GitHub and Supabase, followed by the reconciled current state**

| | |
|---|---|
| Version | 1.0 |
| Written | 7 October 2026, 05:45 UTC |
| Repository | `contactmmx-ship-it/fkaios-aura-blueprint1` (`main` at `07762b5`) |
| Supabase project | `nrlsqshkjuuwiovthrnb` |
| Owner | Rajeev, Chairman, Bhavishya Associates (Franchise Kart, Aura Tech, Rajyog Infra) |

---

## 0. Read this first (rules for any person or AI tool)

This is the reference document for FKAIOS. Before changing anything:

1. Read **§1 Current truth**, then the relevant chapter in **§2**.
2. Do not restart FKAIOS, re-run a full audit, or rebuild something that already exists. The analysis has been done many times. Continue from **§6 Next execution checkpoint**.
3. A row, a UI badge or an LLM saying "completed" is **not** proof. Only live database rows, deploy IDs, logs and test results count.
4. Label every claim as one of: DISCUSSED · DECIDED · IMPLEMENTED · DEPLOYED · VERIFIED · BROKEN · MISSING · UNKNOWN.
5. If live production disagrees with this document, production wins. Then update this document.
6. Standing rules agreed with Rajeev:
   - No fake data, ever.
   - Evidence, not claims.
   - Improve and extend; never replace or rebuild.
   - AI never moves money.
   - ₹0 stays ₹0.
   - Work autonomously; stop only for money, credentials, or legal or irreversible decisions.
7. Every new piece of work must update this file. Append a chapter to §2 and refresh §1.

### Source coverage (be honest about gaps)

| Source | Covered? | How |
|---|---|---|
| Repository: 182 commits on `main`, 29 Jul to 6 Oct, plus ~40 FKAIOS status/checkpoint docs from 29 Jun to 6 Oct | ✅ Complete | Read directly |
| Live Supabase production, 7 Oct 05:41 UTC | ✅ Snapshot | Read-only SQL and function list |
| Claude Code session on 4 Oct (GoMax recovery, PRs #25–#28) | ✅ Complete | Written by the same session |
| Two ChatGPT conversations pasted by Rajeev on 7 Oct | ✅ As pasted | Included and reconciled |
| Other ChatGPT conversations not pasted (e.g. 28 Aug AURA recovery) | ⚠️ Partial | Only what the pasted ChatGPT summary and the repo docs say |
| Other Claude / Claude Code chats | ⚠️ Partial | Only through their commits and the docs they wrote into the repo |

**Missing:** verbatim transcripts of chats that weren't pasted. To fill a gap, paste or export that chat and append it as a chapter. Never invent it.

---

## 1. Current truth (verified live on 7 Oct 2026, 05:41 UTC)

### 1.1 One-paragraph status

The FKAIOS engine runs this chain: objective → plan → task → job → worker → evidence gate → verdict. **It has completed real objectives end to end:**
- an Indian paint-market research report (3 Oct);
- a FKAIOS System Charter strategic-priorities brief (4 Oct);
- a test web app (5 Oct);
- a Franchise Kart landing website (6 Oct).

It also correctly **refused** objectives it had no data for. GoMax sales analysis was blocked as `no_data_source`.

**Today, though, FKAIOS cannot do any new work.** All three LLM providers are unavailable:
- **Anthropic and OpenAI:** out of credit.
- **Gemini:** quota exhausted, with its last success at 6 Oct 09:40 UTC.

The planner cannot plan, so no jobs exist (0 pending, 0 running; the last job was created 6 Oct 19:05 UTC). Two objectives have been stuck in `processing` since 6 Oct.

The independent-verification evidence table (`fkaios_verification_evidence`) is still empty, and revenue is still ₹0.

### 1.2 Live numbers

| Item | Live value | Note |
|---|---|---|
| `ai_jobs` | 22,658 total: 7,721 completed, 14,937 failed, **0 pending, 0 running** | ChatGPT's "19,333 total" was wrong; 7,721 + 14,904 can't sum to 19,333 |
| Last 24 h | 66 completed, 88 failed | Most failures: "All configured LLM providers failed" (69) |
| Last job created | 6 Oct 2026 19:05 UTC | Nothing new for ~10.5 h |
| `agent_runs` | **99** (33 failed, **66 stuck in `running`**) | ChatGPT said 0. The lifecycle works, but 66 runs never got a finish record (BROKEN) |
| `fkaios_verification_evidence` | **0** | No objective has produced an independent-evidence record yet |
| Founder objectives | 11 completed, 177 failed, 1 awaiting approval (blocked), 2 processing | |
| Provider: Anthropic | unavailable, credit exhausted | 1,110 consecutive failures; last success 22 Sep |
| Provider: OpenAI | unavailable, no credits | Never succeeded |
| Provider: Gemini | degraded, 429 quota | 1,152 consecutive failures; last success 6 Oct 09:40 |
| Revenue | ₹0 | Unchanged since day one |

### 1.3 Live edge-function versions

| Function | Version | Deployed via |
|---|---|---|
| `ai-engine` | v114 | GitHub CI ✅ |
| `founder-objective` | v68 | GitHub CI ✅ |
| `founder-brain-tick` | **v98** | **Manual deploy, not CI** ⚠️ The live code may differ from the repo; check before editing |
| `builder-engine` | v50 | GitHub CI |
| `research-engine` | v21 | GitHub CI |

### 1.4 Schema drift

These 5 migrations are applied in production but **not committed to the repo**:
- `20261005165738 restore_founder_brain_tick_scheduler_auth`
- `20261006045655 objective_contracts_v1`
- `20261006151835 objective_contracts_v2_governance_fields`
- `20261006151939 objective_contracts_governance_guard_v1`
- `20261006163657 prevent_duplicate_active_orchestration_projects`

### 1.5 Objectives verified COMPLETED (live rows)

| ID | Date | Objective |
|---|---|---|
| `7659111c` | 22 Sep | V1 autonomous-loop test |
| `65248de4`, `72b9e615` | 23 Sep | Task 24 research-connection tests |
| `bc71499e` | 3 Oct | 3 verified facts about the Indian paint market |
| `22074e41` | 4 Oct | Approval & Decision Engine + Decision Center |
| `c8b9fdf8` | 4 Oct | Founder Decision Brief from the System Charter |
| `78f7828e` | 4 Oct | **System Charter: 3 strategic priorities + execution plan** (the completion-path test) |
| `cc9ead10` | 4 Oct | Charter-based evaluation of a proposed action |
| `d2013184` | 5 Oct | "FKAIOS Product Test" web app built and launched |
| `e35ecfd5` | 6 Oct | Franchise Kart landing website |
| `f50cd1d9` | 6 Oct | Claim-level factual grounding test |

**Caveat on `78f7828e`:**
- It went through 5 planning passes. One project is `complete`; the other 4 were left `working`, because they predate the project-status fix.
- Its `final_output` is the evaluator's one-line summary, not the actual priorities and plan. The deliverable itself lives in the task outputs.

### 1.6 Not working, or not proven

| Area | State |
|---|---|
| LLM providers | 🔴 All exhausted. Needs Rajeev: add credit or enable another provider |
| Alternative providers (OpenRouter, Groq, Mistral, Hugging Face, self-hosted) | ⚫ Code exists (`1153316`, `21fb058`, `0b49984`), but `provider_connections` = 0, so none are configured |
| Independent verification evidence | 🟡 Code exists (`07762b5`); 0 records written |
| `agent_runs` lifecycle | 🟡 Writes rows; 66 never closed |
| Two stuck objectives (`352317c0`, `39dd2cf8`) | 🔴 6–7 projects in ~80 minutes, then stalled. These are founder-brain-generated "strategies" (cron kill, personal capital), not your requests |
| GoMax sales data | ⚫ No connector or data source. Objective `6217332e` now `failed` ("superseded by newer active gate") |
| WhatsApp live number | ⚫ Code only; no real number connected |
| Learning (`ai_outcomes` → behaviour change), self-evolution | 🔴 Not demonstrated |
| Real-world acceptance, failure testing, autonomous E2E, 100/100 | 🔴 Not done |
| Revenue | ₹0 |

---

## 2. Chronological history (oldest first; the current chat is last)

Each chapter lists its source. "Repo" means the commit or document in this repository.

### Chapter 1: 29 Jun 2026, first real-vs-fake fix pass
*Source: `STATUS_2026-06-29.md` · Tool: Claude*

**Found:**
- The orchestrator and agent-scheduler referenced 5 tables that didn't exist.
- 7 "brain" engines were byte-identical stubs.
- Sales Executive AI and Voice AI were scripted templates that invented statistics ("94% satisfaction", "₹42L revenue").
- A lead score came from `Math.random()`.
- 5 tables were open to anonymous internet access.

**Fixed and deployed:**
- Created the missing tables and added a `pg_cron` heartbeat.
- Locked down public RLS.
- Rewrote the 7 engines with real Claude calls.
- Added a real `sales-engine`.

**Lesson set:** don't trust the surface; read the code and the data.

### Chapter 2: 4 Jul 2026, Phase 1: governance, vault, master orchestrator
*Source: `PHASE1_STATUS.md` · Tool: Claude*

- **Structure and permissions:**
  - 9 departments, with all 27 agents mapped.
  - Autonomy levels 0–5.
  - An `approvals` table (finance boundary) and `execution_log` (cost, tokens, latency).
- **Knowledge vault:**
  - Real vector vault: pgvector with `gte-small`.
  - `brain-chat` moved to real Claude with real RAG.
- **Master orchestrator:**
  - Built `orchestrator-brain`: understand → classify → retrieve → plan → autonomy gate → execute or file for approval.
  - Created the `orchestrator_requests` table, the objective table still used today.
- **Charter:** removed 15 fabricated seed documents and replaced them with the **FKAIOS System Charter — Governance & Structure (2026-07-04)**, document `1f2f8a3b`. It is still the only verified knowledge document, with 2 chunks.
- **Correction recorded:** `orchestrator`, `orchestrator-engine`, `auto-pilot` and `agent-scheduler` are **not** duplicates. Each does a different job.

### Chapter 3: 12–13 Jul 2026, autonomous lead loop and the truthful Founder view
*Source: `HANDOFF.md` · Tool: Claude*

- **Lead loop:** the qualifier was reading a non-existent `name` column and reported "none found" on 251 runs. Fixed, which closed the loop DISCOVER → ENRICH → QUALIFY → NURTURE → METRICS → SILENCE MONITOR.
- **Founder view:**
  - FounderStory narrative and 5-door navigation (TODAY / BUSINESS / WORKFORCE / INTELLIGENCE / BUILD).
  - ⌘K command palette.
  - ₹0 revenue shown truthfully.
  - GO/NO-GO department consoles and a silence monitor (3 true alerts, 0 false).
- **Security:** removed the hard-coded secret `kjhgfdsa` from 3 functions; one of them had shipped it to the browser.
- **Progress and spend engines:**
  - ₹1,100 Cr progress engine: 0.0000% achieved, forecast "never".
  - Economics: ≥ $5.49 spent → ₹0 earned.
- **Maturity score: 40/100.**
- **Waiting on Rajeev:** rotate the secret; approve paid contact data.

### Chapter 4: 13–19 Jul 2026, PR #1 and the cognitive cells
*Source: `FKAIOS_CONVERSATION_SUMMARY_2026-09-23.md`*

- Deleted the fabricated-invoice path.
- Added a revenue department, proposal engine, product library, software factory, and Dealer CRM waves 1–2.
- Split the Founder Brain into cognitive cells (Confidence, Reflection, Reassignment, Importance, Curiosity, Belief).
- Wrote the V2 blueprint.

### Chapter 5: 22–25 Jul 2026, v0.9.x decision intelligence and Phase 6A
*Sources: `FKAIOS_CHECKPOINT-2026-07-23-*.md`, `FKAIOS_PHASE6_*.md`, `FKAIOS_CHECKPOINT-2026-07-2[45]-*.md`*

- **Decision intelligence (v0.9.1–v0.9.4):** Founder Brain Brief, decision memory in `fleet_memory`, `executive-intelligence`, CEO Control Room, Founder Cockpit.
- **Phase 6 decision record (24 Jul):** Rajeev approved Phase 6A (intelligence reliability).
- **Router:** built a shared `callLLM` router with provider failover, and moved `ai-engine` onto it (v44 → v46, live-validated).

### Chapter 6: 27–29 Jul 2026, Phase 0.1 execution truth
*Sources: `FKAIOS_CHECKPOINT_PHASE0.1_*.md`, `FKAIOS_CHECKPOINT-2026-07-27-*.md`, commits `6356bf0`, `60a295a`, `b72a2ad`, `99ff69a`*

- **Found:** 153 GENERATE_INVOICE jobs marked "completed" with 0 invoice rows (fabricated).
- **Fixed:** `ai-engine` v47 no longer reports unpersisted results as complete. QUALIFY_LEAD (v48) and GENERATE_INVOICE (v52) now write real records. `ai_outcomes` recording added.
- **Removed:** the fake "41 active agents"; replaced by real active/dormant verdicts (`compute_workforce_truth()`).

### Chapter 7: 28–29 Aug 2026, AURA blueprint recovery
*Sources: ChatGPT conversation (pasted summary, §2–3), `FKAIOS_CONVERSATION_SUMMARY_2026-09-23.md`*

- **Original blueprint ZIP:** `ORIGINALS\fkaios-aura-blueprint1.zip` (286,089,139 bytes). It had far more architecture than the V2 state: orchestrator, orchestrator-brain, orchestrator-engine, avatar-orchestrator, and two auto-pilots. V2 had only `auto-pilot` + `_shared/utils.ts` and no SQL.
- **Key question raised:** the orchestrator *creates* `ai_jobs`; what *consumes* them? (The answer, found later: `ai-engine`, drained by `job-scheduler` and the objective loop.)
- **AURA engine:** deployed (v42).
- **Production recovery diagnosis:** 3 breaks in the LLM layer; 1,102 retry jobs stuck.

### Chapter 8: 8 Sep 2026, PR #2: router fallback
*Repo: `39a1ec1`, `e081538`, `e21fce3`*

- Gemini fallback added.
- Model IDs updated.
- Every attempt is now logged.

### Chapter 9: 21–24 Sep 2026, production fix pass, V1 classification, agreed roadmap
*Sources: commits `8fae22b` → `caf0a31` (PRs #3–#5); `FKAIOS_ARCHITECTURE_INVENTORY_2026-09-21.md`; `FKAIOS_V1_CLASSIFICATION_2026-09-22.md`; `FKAIOS_CONVERSATION_SUMMARY_2026-09-23.md`; ChatGPT audit (pasted §4–5)*

- **Changes:**
  - Real telemetry, retry discipline, duplicate-job fix, architecture inventory.
  - Founder Brain on the canonical router; 15-minute tick; replan cap.
  - Task #23: safe capability dispatch for `work_engine_task`.
  - Task #24: deterministic evidence gate in `evaluateObjective()`.
  - Console objective input; objective-level status.
  - `knowledge.search` 401 fix.
  - Founder Brain background cycle limited to hourly.
- **First completed objective:** V1 autonomous-loop test `7659111c` (22 Sep).
- **Roadmap agreed with Rajeev (23 Sep):**
  1. Engine
  2. Usable V1 Command Center + Rajeev AI API
  3. Business autopilot (MCP, browser, WhatsApp/email/CRM behind approval)
  4. Self-building / self-evolving

  Rule: keep the kernel; outside tools plug in as workers.
- **Open-source candidates (evaluate, don't install):** MCP, Playwright MCP, n8n, OpenHands/Cline, Goose, LangGraph/Mastra patterns, Ollama/vLLM, LiteLLM, Qdrant, A2A.

### Chapter 10: 2–3 Oct 2026, V1 acceptance gate and the self-driving loop (PRs #7–#24)
*Repo: `58f8e18` → `510e20a`; `docs/FKAIOS-V1-ACCEPTANCE-GATE.md`*

- **Acceptance and capabilities:**
  - V1 acceptance gate.
  - Orchestrator-approved `research.run` (Apify) capability.
  - Founder authorization carried into jobs.
  - Resource intelligence gating capability execution.
- **Deployment:**
  - Automatic Supabase deployment from GitHub (`deploy-supabase-functions.yml`, with a pinned CLI).
  - Netlify and Railway configuration.
- **Self-driving loop:**
  - Orphaned-task recovery.
  - The founder status check advances objectives.
  - The heartbeat drives the `ai-engine` worker itself.
  - Duplicate research dispatch prevented.
  - Research evidence persisted on tasks.
  - Console re-run action.
- **Result:** objective `bc71499e` (Indian paint market, 3 verified facts) **completed**.

### Chapter 11: 4 Oct 2026, Claude Code session: GoMax objective recovery (PRs #25–#28)
*Source: this Claude Code session; PRs #25–#28*

**Context:** GoMax objective `6217332e` was stuck.

**Fixes shipped:**

| PR | Merge commit | Fix |
|---|---|---|
| #25 | `58b6070` | `work-engine.ts` had a comment holding a literal `\n`, which swallowed the open-task and completed-job queries, so every tick threw "completedJobs is not defined". Restored, with pagination and chunking. Also fixed `ai-engine`: `taskText` was out of scope, so every job with prior tasks threw (seen live), and double-escaped regexes meant the verification gate never fired. |
| #25 | `480a452` | Completed-work reconciliation limited to **active** founder objectives, so 21 old `research.run` results (paid Apify calls) were not re-dispatched. |
| #26 | `81c723f` | The objective loop turned held-back `pending` tasks into `rework`, so the second task never ran and it replanned every 15 minutes, with a paid research run each time. Pending tasks are now excluded. |
| #27 | `f530fc8` | The grounding gate didn't treat **sales / revenue / turnover** analysis as needing real facts, so empty vault searches "verified" it. Fixed generally, with tests D1–D4. |
| #28 | `78d4752` | `markObjective` copied objective statuses onto projects, violating `orchestration_projects_status_check`. Now: completed → `complete` (with `final_output`), failed → `failed`, blocked → status kept and blocker recorded. Tests P1–P4. |

**GoMax result:** **BLOCKED / `no_data_source`.**
- FKAIOS has no GoMax data source: none of its 7 connectors covers GoMax, there is no GoMax capability, and the database holds 0 GoMax rows.
- 3 Apify research runs returned only a generic Google AI Overview, which is not evidence.
- No data was fabricated.

**Clarified by Rajeev:** GoMax is a separate business and application, not part of this repo.

**Also found, not fixed (out of scope):**
- The `ai-engine-run-jobs-5min` cron sends no Authorization header (401).
- Anthropic credit is exhausted.
- 688 open orchestration tasks: 565 rework, 107 assigned, 16 pending.

**Completion-path test:** Rajeev submitted the System Charter objective through the Console. `78f7828e` **completed** on 4 Oct.

**Same day, other sessions:** #29 terminal progress alignment; #30 verified deliverables shown in the Console; #31 approval dedupe and resume; Decision Center production verification documented.

### Chapter 12: 5 Oct 2026, single active approval, outcome contracts, product builds
*Repo: `80ce4e2` → `c4a7731`, PRs #32–#34*

- **Decision Center:** hard limit of one active Founder Brain approval.
- **Outcome contracts:** explicit outcome completion contracts; planning against the contract; code alone can't satisfy "product" completion; live-URL evidence gate.
- **Products:** product objectives run through the Builder Engine; generated products served as live outcomes; product tabs made interactive.
- **Result:** objective `d2013184` ("FKAIOS Product Test" app) **completed**.
- **Migration:** `restore_founder_brain_tick_scheduler_auth` (live; not in the repo).

### Chapter 13: 6 Oct 2026, constitution, contracts, provider continuity, agent runs, verification evidence
*Repo: `5897cd4` → `07762b5`; ChatGPT conversation #1 (pasted, §8–25)*

- **Objective contracts:** universal objective discovery; objective contract preparation; contract-aware planner and evaluator; contract and discovery shown in the Command Center.
  - Migrations `objective_contracts_v1/v2/governance_guard` (live; not in the repo).
- **Planning and execution:** ranked capability and repository solution options; persistent work packages; automated provider handoffs; live Execution Room in the Console.
- **Grounding:** factual synthesis subjects now require grounding.
- **Product lifecycle:** real `product.deploy` / `product.verify` capability handlers.
  - Result: objective `e35ecfd5` (Franchise Kart landing website) **completed**.
- **Constitution and docs:** Phase 0 master operating map frozen; **Constitution v1** (`docs/FKAIOS_CONSTITUTION_V1.md`); objective URL parser fix (`6331cd5`).
- **Provider continuity:**
  - Multi-provider fallback (`1153316`): OpenRouter, Groq, Mistral, Hugging Face, self-hosted.
  - Persisted provider health (`21fb058`, `dc239da`).
  - Full fallback-chain traversal with retry budget 8 (`0b49984`).
  - Made a constitutional rule (`f18fcaf`).
- **Agent-run lifecycle** (`8da3e2d`): `startAgentRun` / `finishAgentRun` → `agent_runs`.
- **Deterministic verification evidence** (`07762b5`): `syncDeterministicVerificationEvidence()`. An LLM saying "verified" is never accepted as evidence.
- **Duplicate-project guard:** migration `prevent_duplicate_active_orchestration_projects` (live; not in the repo).
- **Side effect:** later the same day, the founder brain generated strategy objectives `352317c0` and `39dd2cf8`. These replanned 6–7 times and then stalled when the providers ran out.

### Chapter 14: 7 Oct 2026, ChatGPT conversation #2: the merge request
*Source: ChatGPT conversation (pasted)*

- ChatGPT produced a "Master Historical Transfer" summary.
- Rajeev's requirement: **merge every FKAIOS conversation across all tools in chronological order, with the current chat last, then a reconciled current state.** It must work as a single reference any tool can read.
- ChatGPT could not generate the file (usage limit) and acknowledged it could not export all chat transcripts.
- Its stated checkpoint: "0 pending jobs; trace why the planner isn't producing jobs".

### Chapter 15: 7 Oct 2026, current chat (latest): Claude Code builds this master record

- Merged the repo history (Jun 29–Oct 6), the 4 Oct Claude Code session and both pasted ChatGPT conversations.
- Checked them against live production (§1).
- **Answered the open question from Chapter 14:** jobs are at 0 because all three LLM providers are down, not because of a broken planner link. The planner needs an LLM, and none is available.
- Corrected the ChatGPT summary's errors (see §3).
- Committed this file to the repo as the single source of truth.
- **No code, schema or data was changed in this chapter.**

---

## 3. Reconciliation: where the sources disagree

| Claim | Source | Live evidence (7 Oct) | Verdict |
|---|---|---|---|
| `ai_jobs` total 19,333 | ChatGPT | 22,658 (7,721 + 14,937) | ChatGPT number wrong |
| `agent_runs` = 0 | ChatGPT | 99 rows (66 stuck `running`, 33 failed) | Outdated; the real issue is runs never closed |
| "ai-engine cron 401 was fixed" | ChatGPT §20 | In this session the 5-minute `ai-engine` cron still had no auth header (4 Oct); jobs are drained by `job-scheduler-drain` and the objective loop instead | Unverified; treat as still open |
| "Planner/dispatch link broken" is the next problem | ChatGPT §28 | Planner calls fail: all LLM providers exhausted | Root cause is providers, not a code link (re-check once providers are back) |
| founder-brain-tick v98, ai-engine v113 | ChatGPT | v98 (manual deploy), ai-engine v114 | Close; note the manual deploy |
| GoMax "stuck/replanning" | ChatGPT | Blocked `no_data_source` on 4 Oct, then `failed` ("superseded by newer active gate") | Resolved as a data-source blocker |
| "First acceptance execution should be safe and non-financial" | ChatGPT | Already done: charter objective `78f7828e` completed 4 Oct | Done |
| Roadmap phases 0–23 | ChatGPT | Phase status is an assessment, not acceptance | Keep as a guide only |

---

## 4. Architecture (as built)

```
Rajeev → Console / Command Center (founder-objective: submit · status · rerun)
       → orchestrator_requests (objective row)
       → founder-brain-tick (pg_cron, every 15 min): objective loop
            ├─ drain ai-engine worker
            ├─ returnCompletedWork()  (active founder objectives only)
            ├─ orphan recovery (assigned/running/working only; pending is held back)
            ├─ deterministic gate assessCurrentTaskSet() → no_data_source ⇒ BLOCKED
            ├─ allocate next pending task → ai_jobs (work_engine_task, prior evidence handed forward)
            ├─ evaluateObjective() (contract-aware; LLM + deterministic evidence)
            └─ completed / blocked (awaiting_approval) / failed / replan (cap 5)
       → ai-engine (executeJob → LLM router → capability dispatch via Company OS:
            knowledge.search · research.run · product.build/deploy/verify · …)
       → orchestration_tasks.output → evidence → markObjective() → project projection → Console
```

The Console renders from `orchestrator_requests.status` + `action_taken`, via `src/lib/objective-view.ts`:
- **BLOCKED** = `awaiting_approval` + `objective_loop`
- **COMPLETED** = `completed`, with the deliverable shown

---

## 5. Open issues, ranked

**Needs Rajeev (money, credentials or a decision):**
1. **LLM provider access.** Add credit to Anthropic or OpenAI, wait for or raise the Gemini quota, or provide a key for one of the already-coded fallbacks (OpenRouter, Groq, Mistral, Hugging Face, self-hosted). Nothing new runs until this is done.
2. **GoMax data source.** Decide how FKAIOS should reach GoMax sales data (API, database export or document ingest) before any GoMax objective is retried.
3. **Rotate `HEARTBEAT_SECRET`** (open since July), paid contact data, a real WhatsApp number, and 2026–2029 revenue targets.

**Engineering (no approval needed, but don't start until providers are back):**

4. Commit the 5 live-only migrations to the repo, and confirm the live `founder-brain-tick` v98 matches `main` (it was deployed manually).
5. Close the 66 `agent_runs` stuck in `running` (find why `finishAgentRun` is skipped), and add a reaper.
6. Get `fkaios_verification_evidence` written on a real completed objective (it's still 0).
7. The two stalled strategy objectives (`352317c0`, `39dd2cf8`) suggest the Founder Brain is auto-generating risky objectives (shutting down crons, "inject personal capital"). Review whether auto-generated objectives should need approval.
8. `final_output` stores the evaluator's summary sentence, not the deliverable. Persist the actual result.
9. `ai-engine-run-jobs-5min` cron sends no Authorization header (401 every 5 minutes).
10. Old backlog: 23 `research.run` jobs and about 688 open tasks. Leave them untouched; never replay blindly.

---

## 6. Next execution checkpoint — start here

1. **Blocker:** LLM providers (§5 item 1). Ask Rajeev; don't work around it.
2. Once one provider responds, re-check: do the stalled objectives (or a new safe, non-financial test objective) produce `ai_jobs`? Does `ai-engine` run them? Do `agent_runs` go `running → completed`?
3. Then verify that `fkaios_verification_evidence` gets a record on completion, and that completion is refused without one.
4. Then run failure tests: provider down → truthful BLOCKED; bad output → rework; missing data → `no_data_source`.
5. Only after that, move on to real-world acceptance and the Stage 3 business autopilot.

**Do not:**
- insert fake jobs or evidence;
- replay the failed backlog;
- spend money;
- contact leads as a test;
- rebuild anything listed as working.

---

## Appendix A: key identifiers

- **Objectives:**
  - GoMax `6217332e-8d33-49b6-b13e-74f74bf5405f`
  - Charter test `78f7828e-bfa0-476d-9691-3fbdfead4512`
  - Paint market `bc71499e`
  - Product test `d2013184`
  - FK website `e35ecfd5`
- **System Charter document:** `1f2f8a3b-be05-4427-a754-828d78a9ea39` (2 chunks)
- **GoMax brand row:** `a27d9e4c-61a6-4baf-b079-96e938e03b9d` (no data linked)
- **Cron:** `fkaios-founder-brain-tick` (*/15), `job-scheduler-drain` (*/10), `ai-engine-run-jobs-5min` (*/5, returns 401)

## Appendix B: document index (in this repo)

- **Most authoritative:** this file → `docs/FKAIOS_CONSTITUTION_V1.md` → `docs/FKAIOS-V1-ACCEPTANCE-GATE.md` → `FKAIOS_CONVERSATION_SUMMARY_2026-09-23.md` → `FKAIOS_WORLD_CLASS_OS_BLUEPRINT.md` (July spec)
- **History:**
  - `STATUS_2026-06-29.md`
  - `PHASE1_STATUS.md`
  - `HANDOFF.md`
  - `FKAIOS_CHECKPOINT-*.md`
  - `FKAIOS_PHASE6_*.md`
  - `FKAIOS_ARCHITECTURE_INVENTORY_2026-09-21.md`
  - `FKAIOS_V1_CLASSIFICATION_2026-09-22.md`
- **Audits (complete; don't regenerate):** `FKAIOS_PRODUCT_AUDIT.md`, `FKAIOS_ORGANISM_AUDIT_REPORT.md`, `FKAIOS_CAPABILITY_REALITY_REPORT.md`, `FKAIOS_SCREEN_AUDIT_AND_FINAL_BLUEPRINT.md`
