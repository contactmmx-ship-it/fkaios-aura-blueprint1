# FKAIOS Audit: Strengths and Weaknesses (7 Oct 2026)

**Method:** evidence only. Every claim below comes from one of:
- live Supabase production (read-only SQL, edge-function list, Supabase security advisor, run 7 Oct ~09:40 UTC);
- the repository (`main` at `07762b5`);
- the history in `docs/fkaios-archive/`.

**Nothing was changed during this audit.**

## Verdict in one paragraph

FKAIOS's **core engine is real and honest**. It takes an objective, plans it, runs it through workers, checks the evidence, and either completes it, or truthfully blocks or fails it. It has done this on real objectives (research with sources, a charter-grounded brief, a built and deployed web app, a website). It refuses to fake results (GoMax was blocked as `no_data_source`).

**But it is not yet a dependable business operating system.** It stops completely when the LLM providers run out (they have). Its public database API is exposed. Production and the repo have drifted apart badly. The system is buried under its own noise. And it has produced no business outcome yet: ₹0 revenue, and 0 leads past "new".

## Scorecard

| Layer | Grade | Evidence |
|---|---|---|
| Objective loop (plan → execute → verify → verdict) | 🟢 Strong | 11 objectives completed end to end; Console shows COMPLETED/BLOCKED correctly |
| Honesty / anti-fabrication | 🟢 Strong | Deterministic evidence gate; `no_data_source` blocking; fabricated-invoice path removed (Jul); ₹0 shown truthfully |
| Execution engine (`ai-engine`) | 🟢 Good | 7-day job success 71.7% of 1,156; retries and terminal failures recorded; 7,266 `ai_outcomes` |
| Scheduling / automation | 🟢 Good | 25 active cron jobs, **0 cron failures in 24 h**; 34 of 41 agents did real work in the last 7 days |
| LLM provider resilience | 🔴 Failing | All 3 providers down (credit/quota); fallbacks coded but **0 configured**; nothing new runs |
| Security | 🔴 Weak | 31 privileged DB functions callable **without login**; 2 tables without RLS; 9 privilege-escalating views; old secret never rotated |
| Repo ↔ production consistency | 🔴 Weak | **108 migrations live vs 36 in repo**; only 5 of 91 functions deployed by CI; `founder-brain-tick` v98 hand-deployed |
| Independent verification evidence | 🟠 Incomplete | `fkaios_verification_evidence` = 0; `final_output` stores a summary, not the deliverable |
| Observability of agent work | 🟠 Incomplete | `agent_runs` 99 rows, **66 stuck in `running`** |
| Learning / self-improvement | 🔴 Absent | `ai_evolution` = 0; outcomes are recorded but never change behaviour |
| Data / connectors | 🔴 Missing | Only the System Charter in the vault; no GoMax or other business data source; WhatsApp not live |
| Business outcomes | 🔴 None | ₹0 revenue · 150 leads, **0 advanced past `new`** · 4 invoices, 0 paid |
| Hygiene / focus | 🔴 Noisy | 173 failed objectives in 14 days · 232 projects stuck "working" · 764 open tasks · **337 approvals pending since 4 Jul** |
| Engineering discipline (recent) | 🟢 Good | Small PRs, CI deploy for core functions, 78 passing tests on core logic, constitution + docs |

---

## Strengths (what to protect)

1. **The loop works end to end.** Completed live:
   - Indian paint market facts with sources (`bc71499e`)
   - System Charter priorities + plan (`78f7828e`)
   - FKAIOS Product Test app built and launched (`d2013184`)
   - Franchise Kart website (`e35ecfd5`)
   - Approval & Decision Engine (`22074e41`)
   - and others

   This is the hardest part of an "AI OS", and it exists.

2. **It tells the truth.** The design rejects fake success:
   - jobs without persisted results are not "completed";
   - fact-needing tasks without sourced evidence are `no_data_source`;
   - completion needs evidence.

   GoMax proved it: no data, so it was blocked with an exact reason, not a made-up report. Most AI-agent projects fail exactly here.

3. **It runs itself.** The 15-minute tick drives work automatically:
   - worker drain, orphan recovery, replan cap of 5;
   - a database guard against duplicate projects;
   - one-active-approval Decision Center.

   No cron failures in 24 hours.

4. **The execution engine is mature.**
   - Retries and recorded terminal failures.
   - Real persistence (leads, invoices).
   - Outcome recording, cost tracking, provider-health tracking.
   - A multi-provider fallback chain already coded (OpenRouter, Groq, Mistral, Hugging Face, self-hosted).

5. **Founder-first governance.** Built in from the start:
   - AI never moves money;
   - autonomy levels per agent;
   - approvals for high-risk work;
   - a written constitution (`docs/FKAIOS_CONSTITUTION_V1.md`);
   - outcome contracts on objectives.

6. **Engineering has become disciplined.** Since late September:
   - small reviewed PRs;
   - GitHub → Supabase CI for the core functions;
   - unit tests on the grounding, rerun and loop logic;
   - every fix tied to live evidence.

7. **It's cheap to run.** Measured LLM spend is about **$13 in the last 30 days**. Providers are down for lack of credit, not because FKAIOS burns money.

---

## Weaknesses (ranked by damage)

1. **One point of failure: LLM credit.**
   - Anthropic and OpenAI are out of credit, and Gemini's quota is exhausted.
   - Last successful call: 6 Oct 09:40 UTC. Since then nothing new has been planned or executed (0 pending jobs).
   - The fallback providers are coded, but `provider_connections` = 0.
   - **Fix:** add credit, or configure one fallback key. This is a founder action and costs very little at current usage.

2. **The public database API is exposed.** From the Supabase security advisor:
   - **31 `SECURITY DEFINER` functions are callable by anyone with the public anon key** (the key ships in the website). Examples:
     - `auto_invoice_onboarding`, `auto_generate_proposal`, `auto_schedule_meeting`: business actions;
     - `brain_chat_rpc`: spends LLM credit;
     - `record_enterprise_memory`, `log_llm_cost`: write into FKAIOS memory and cost records;
     - `search_knowledge_documents`: reads company knowledge;
     - `reap_orphaned_ai_jobs`: changes job state.
   - `agent_aliases` and `model_registry` have **no RLS**; 9 views are `SECURITY DEFINER`; 46 functions have a mutable `search_path`; leaked-password protection is off.
   - About 30 edge functions run with `verify_jwt = false`.
   - The heartbeat secret flagged in July has **still not been rotated**.
   - **Fix:** revoke `EXECUTE` from `anon` (and from `authenticated` where not needed), enable RLS, rotate the secret.

3. **The repo is not the source of truth for production.**
   - **108 migrations are applied live; the repo has 36.**
   - Only 5 of 91 edge functions deploy through CI. The rest, including the live `founder-brain-tick` v98, were deployed by hand.
   - So FKAIOS **cannot be rebuilt from the repo**, and any tool deploying from the repo can silently overwrite newer live code. This is what produced the earlier "literal `\n`" class of bugs.
   - **Fix:** pull the live schema and function sources into the repo; make CI the only deploy path.

4. **No business outcome yet.**
   - ₹0 revenue; 150 leads, none past `new`; 4 invoices, 0 paid; no live WhatsApp number.
   - No data connectors for the brands (GoMax etc.).
   - The engine is proven on internal and research tasks, not on revenue work.

5. **Noise is drowning the signal.**
   - 173 objectives failed in 14 days. 118 were the Founder Brain's *own* auto-generated objectives, superseded by the one-active-gate rule.
   - 232 projects are stuck in `working`; 764 open tasks (585 `rework`).
   - **337 approvals have waited since 4 July**, so the approval queue is effectively unusable.
   - The Founder Brain still generates risky "strategies" on its own (e.g. "kill cron loops", "inject personal capital"). Two such objectives are stuck.

6. **Verification and observability aren't finished.**
   - `fkaios_verification_evidence` has **0 rows** even though objectives completed.
   - `final_output` holds the evaluator's one-line summary, not the actual deliverable.
   - 66 `agent_runs` never closed.
   - The `ai-engine-run-jobs-5min` cron gets 401 every 5 minutes (72 × 401 in 24 h).

7. **No learning.** `ai_outcomes` has 7,266 rows, but `ai_evolution` = 0: results are recorded and never used to improve routing, prompts or plans.

8. **Sprawl and thin tests.**
   - 158 tables, about 110 of them empty.
   - 91 edge functions, several overlapping (2 WhatsApp webhooks, 2 senders, 5 knowledge functions).
   - 38 overlapping plan/audit docs in the repo root.
   - Only 8 test files for about 55,000 lines of TypeScript.

9. **Work is scattered across tools.** ChatGPT, Claude and Claude Code have each worked on FKAIOS without a shared state. This directly caused weaknesses 3 and 5 and the repeated re-audits. `docs/FKAIOS_MASTER_SOURCE_OF_TRUTH.md` now exists to fix this, but only if every tool updates it.

---

## What to do, in order

| # | Action | Who | Effort |
|---|---|---|---|
| 1 | Restore one LLM provider (top up, or add a fallback key) | Rajeev | Minutes |
| 2 | Close the security holes: revoke anon `EXECUTE` on the 31 functions, RLS on 2 tables, rotate the heartbeat secret, turn on leaked-password protection | Engineering + Rajeev (secret) | ~1 day |
| 3 | Make the repo match production: pull 72 missing migrations and hand-deployed function sources; CI as the only deploy path | Engineering | 1–2 days |
| 4 | Clean the backlog safely: archive superseded objectives and stuck projects; triage the 337 approvals; require approval for Founder-Brain-generated objectives | Engineering + Rajeev decisions | ~1 day |
| 5 | Finish verification: write `fkaios_verification_evidence` on completion, store the real deliverable in `final_output`, close `agent_runs` | Engineering | 1–2 days |
| 6 | Point the proven engine at one revenue workflow with real data (one brand's data connector, or lead contact → meeting) | Rajeev chooses; engineering builds | 1–2 weeks |
| 7 | Only then: learning from outcomes, self-improvement, wider autonomy | Later | — |
