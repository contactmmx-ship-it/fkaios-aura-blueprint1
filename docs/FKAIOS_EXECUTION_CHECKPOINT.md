# FKAIOS execution checkpoint

This is the resumable record for the FKAIOS Master Mission. It is updated after every major cycle. If a session stops, the next one starts here. Do not repeat completed work. Verify the "next action" before doing it.

## Cycle 1: 9 Oct 2026, 01:56 UTC — establish truth

### Supplied histories: ingestion coverage

| File | Lines | Bytes | md5 | Read | Repo copy |
|---|---|---|---|---|---|
| `3a1f14b4-fkaios_chats.txt` | 1525 | 32,971 | 043dffe61bf254bbe8e8c81cabb8da3e | **1–1525 (complete)** | verbatim in `docs/fkaios-archive/02_chatgpt_conversations_pasted.md` |
| `c9f742e0-fkaios_chat_2.txt` | 5330 | 143,995 | 323eeec0cf50fbfbee8785826e8dfc0b | **1–5330 (complete)** | verbatim in `docs/fkaios-archive/02a_chatgpt_ai_learning_and_fkaios_lite_2026-10-05_to_07.md` |

There is no unread remainder. Containment was checked by script, not by eye.

### Requirements extracted from file 2

File 2 is a ChatGPT conversation from 5–7 Oct 2026. It is an AI-literacy discussion that led to the FKAIOS-Lite design. Each requirement below is reconciled with what is actually live today.

| # | Requirement (source lines) | Live reality | Status |
|---|---|---|---|
| H1 | The project hub owns the project, and AI tools are replaceable workers (1832–2266) | Objective state lives in Supabase (`fkaios_objective_state`); `llm-router` swaps models | PARTIALLY VERIFIED: routing is proven; no objective has ever used the state table (0 rows) |
| H2 | A project passport or master state with a "DO NOT USE" list and unique project IDs (2268–2561) | No per-project master state for Syros, PerfumeWala, etc. Those projects are not in any accessible system | NOT IMPLEMENTED: project inventory is task #8 |
| H3 | Automatic micro-checkpoints, an INTERRUPTED state, and "verify before continuing" for unknown completion (2563–2879) | `execution-steps` + checkpoint/resume (PR-2); self-tests resume across the 145 s limit | VERIFIED for engine work (self-test resume evidence 8 Oct); not exercised on a founder objective |
| H4 | A system-generated handover packet when a worker stops (2815–2866) | Model failures are classified and recorded in `attempts`, and failover is automatic | PARTIALLY VERIFIED: failover is proven; there is no human-readable handover document |
| H5 | Capacity-aware scheduler, work sizing, and avoiding a model near its limit (2881–3302) | Health, `unavailable_until`, rate-limit cooldown, deferral cancel and a quota cooldown of 6 h | VERIFIED: a 429 led to deferral and cancellation, recorded in production 9 Oct 00:45 |
| H6 | Minimum Work Principle; inspect before acting (3090–3121, 3497–3531) | Constitution rule "inspect before changing"; the planner is not measured on it | NOT VERIFIED |
| H7 | Autonomy policy: automatic, log-only and Rajeev-required tiers (3423–3459, 4749–4779) | `approvals` table; adoption, communications and objectives are gated by the founder | VERIFIED for adoption (de2aeafd pending) and communications (never sent without approval) |
| H8 | Prompt compiler and context packet: only the relevant context, not the whole project (3461–3493, 4625–4664) | `structured-reasoning`, objective understanding, and planner prompts built from state | PARTIALLY VERIFIED |
| H9 | Alignment engine and Current Truth: superseded vs current decisions (3656–3944, 4702–4747) | `docs/FKAIOS_MASTER_SOURCE_OF_TRUTH.md` (manual); governed adoption with rollback | PARTIALLY VERIFIED: manual SoT; no automated alignment review |
| H10 | Dynamic tool registry, with no "always use Claude" rules (3854–3870, 4795–4812) | `model_registry` + `fkaios_resource_capabilities` + learning-driven routing | VERIFIED: Anthropic has no credit and is skipped automatically |
| H11 | Agent runtimes as infrastructure under FKAIOS (OpenAI Agents API, etc.) (4250–4424, 4866–4892) | Not adopted. OpenAI and Anthropic keys exist but have no usable credit. Only Gemini works | NOT APPLICABLE until a paid provider is authorized |
| H12 | One CEO/orchestrator; the 41 roles are capabilities, not processes (3352–3404, 4361–4371) | `ai_agents` = 41 active rows; Founder Brain tick is the single loop | PARTIALLY VERIFIED: see the agent catalog (task #8) |
| H13 | Goal → live execution → approval screens (4814–4865) | `ObjectiveCommand.tsx` + founder-objective actions | PARTIALLY VERIFIED: the UI exists; no end-to-end run with a real founder objective |
| H14 | "Freeze the design; build the operating loop" (5111–5114) | Followed: work since 7 Oct is execution, not redesign | — |
| H15 | Legitimate free routes only; never bypass paid restrictions (672–711) | Resource order local → free → existing → best → paid; `allowPaid=false` | VERIFIED in code and routing evidence |
| H16 | An AI radar that classifies each release: what it is, cost, API, and use for FKAIOS (741–789, 959–977) | Model discovery runs hourly against provider APIs; no tool, repo or MCP discovery | PARTIALLY VERIFIED: task #9 |

Superseded by later decisions: the fixed "41 permanent agents" model (H12), "OpenAI Agents SDK as primary orchestrator" (the 7 Oct transfer chose Supabase plus resource routing, with no paid provider), and "Claude = coding" fixed assignments.

### Production baseline (9 Oct 01:56 UTC)

- **Routing.** gemini-3.5-flash-lite is adopted. gemini-3.5-flash and gemini-3.7-flash are verified (production fallback). Approval de2aeafd (adopt 3.7-flash) is pending and expires 12 Oct 00:55 UTC.
- **Speech.** Verified autonomously by round-trip WER:
  - STT: gemini-3.1-flash-lite-preview, 0.142, at 00:58.
  - TTS: gemini-3.1-flash-tts-preview, 0.092, at 01:29.
  - Earlier: gemini-3.1-flash-lite, 3-flash-preview, 2.5-flash and 3.8-flash-lite-tts.
- **Self-tests.** The model_failover, continuation, verifier_reject, verifier_pass, structured_routing, speech_roundtrip and voice_turn scenarios have all passed in production.
- **Executive engines.** No runs in the last 30 h. They are scheduled at 03:30, 04:00 and 04:30 UTC, and check-in trig_01MnKtuREzfZQzDHd5Mu7RAf verifies them at 04:45.
- **Objectives.**
  - `fkaios_objective_state` has 0 rows, so no founder objective has run through the canonical loop.
  - `objective_contracts` has 10 rows.
  - Creating an objective through SQL is forbidden; it must come from the founder Console.
- **Knowledge.**
  - `brain_knowledge_documents` has 11 rows: 10 archived placeholders plus 1 charter. `brain_knowledge_chunks` has 2.
  - There are no page-level fields, and no books, SOPs or blueprint sources.
  - Storage: `documents` 0 objects, `project-submissions` 5, `product-video-photos` 1.
- **Projects.**
  - client_projects: 269 rows, most created by the AI lead pipeline.
  - orchestration_projects: 253. build_projects: 25. brain_projects: 2 (Dental Kart video). software_projects: 1.
  - Mr. Chick'n appears only as two AI-drafted partner proposals, not as an SOP.
- **Connectors table (7 rows).** It is a static seed from 8 Jul with no health checks:
  - "connected": whatsapp_business, elevenlabs, netlify, anthropic, openai.
  - "not_connected": gmail, google_calendar.
- **Crons.** 26 jobs, of which 24 are active. ai-engine-run-jobs-5min and sales-draft-proposals-hourly are inactive. Most still put the heartbeat secret in the URL (P0, RED).
- **Code tests.** `_shared` ran 140 passed and 1 failed; the failure is pre-existing (fact-grounding A7).

### Next actions (in order)

1. Write `docs/FKAIOS_ACCEPTANCE_MATRIX.md` (tests 1–15) from the evidence above.
2. Task #7: page-level knowledge store and ingestion with PDF page labels, and exact-page retrieval, verified by a production self-test on a generated labelled PDF.
3. Task #9: ecosystem discovery (MCP registry, GitHub, Hugging Face, public model lists) as a daily scheduled run, with dedup, run records and evidence. It is only called operational after a real scheduled run.
4. Task #8: generate the inventory, connector registry and agent catalog from live tables.
5. 04:45 UTC: verify the executive engines' scheduled runs.

## Cycle 2 — 9 Oct 2026, 03:05 UTC: knowledge library and daily discovery

### Done (evidence)

**PR #70 merged (main 8a3119a); CI deploy run 111 succeeded.**

**Migrations:**
- `20261009024803` adds the knowledge and discovery tables. md5 is identical to the live statement.
- `20261009030452` makes `/`, `_` and `\` separate words in search. It was applied without DROP COLUMN, because a DROP COLUMN through the connector hung twice and both attempts rolled back.

**Daily discovery: VERIFIED.**
- The first real **scheduled** run fired at 02:51 UTC (08:21 IST): 6 of 6 sources, 180 candidates, evidence 6818b1c1.
- Self-test reruns found 0 new candidates, so dedup holds.

**Histories ingested in production** (self-test `history_ingest`):
- `3a1f14b4`: 1525 lines, 26 segments.
- `c9f742e0`: 5330 lines, 89 segments.
- SHA-256 matches both supplied files.

**Exact-page retrieval** (self-test `knowledge_pages`) passed 8 of 9 checks. The scanned page OCR returned empty and was recorded honestly as `uncertain`.

**Inventory, connector registry and agent catalog** were written from live data:
- `docs/FKAIOS_PROJECT_AND_ARTIFACT_INVENTORY.md`
- `docs/fkaios_project_inventory.csv`
- `docs/FKAIOS_CONNECTOR_REGISTRY.md`
- `docs/FKAIOS_AGENT_CATALOG.md`

### Found

- **`hunt_leads` fails** (14 in 7 days) because lead-discovery calls research-engine with no auth header. This path **spends Apify credits**, so it is left stopped pending a founder decision; it is not "fixed" into spending.
- **9 `build_projects` are stuck in `generating`**, and 24 `orchestration_projects` are non-terminal.
- **OpenAI and Anthropic have no credit**, while the `connectors` seed still says "connected".

### Next actions

1. Ship the OCR fix (empty readings fail over to the next model; new prompt) and the corrected `history_retrieval` query. Re-run `knowledge_pages` and `history_retrieval`.
2. 04:45 UTC: verify the executive engines' scheduled runs.
3. Add a bounded timeout to stale `generating` builds and non-terminal orchestration rows.
4. Write SECURITY_AND_RECOVERY, OPERATIONS_RUNBOOK and CURRENT_STATE.
