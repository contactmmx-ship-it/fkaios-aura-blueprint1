# FKAIOS — Conversation & Work Summary (as of 2026-09-23)

Sources: git history of this repo (all branches), the handoff/audit/checkpoint
docs in the repo root, and the titles/final status lines of the Claude Code
sessions on this repo. Transcripts of other chats (claude.ai, other AIs) were
not readable, only what they left behind in git and docs.

---

## 1. What FKAIOS is

- Owner: Rajeev, Chairman, Bhavishya Associates (Franchise Kart, Aura Tech, Rajyog Infra).
- Goal: an autonomous AI operating system. Target ₹1,100 Cr by 2030.
- Founder role: observe, review, approve. Never operate.
- Stack: Next.js on Vercel, Supabase `nrlsqshkjuuwiovthrnb`, Anthropic / OpenAI / Gemini via a shared LLM router.

## 2. Timeline

| When | What happened |
|---|---|
| Jun 29 | First real-vs-fake fix pass: missing tables, stub engines, fabricated stats, `Math.random()` lead scores, publicly readable tables. All fixed. |
| Jul 12–13 | Qualifier fix, discover→enrich→qualify→nurture loop, 5-door nav, truthful ₹0 revenue, silence monitor, number lineage, hardcoded secret removed, ₹1,100 Cr progress engine, AI cost tracking. |
| Jul 13–14 (PR #1) | Fabricated-invoice path deleted; revenue dept, proposal engine, product library, software factory, Dealer CRM waves 1–2. |
| Jul 18–19 | Founder brain split into cognitive cells (Confidence, Reflection, Reassignment, Importance, Curiosity, Belief). V2 blueprint. |
| Jul 22–23 | v0.9.1–v0.9.4: Founder Brain Brief, decision memory, decision intelligence, CEO Control Room. |
| Jul 24–25 | Phase 6A: shared `callLLM` router with provider failover. |
| Jul 27 | Phase 0.1 execution truth: 153 "completed" invoice jobs found fabricated. QUALIFY_LEAD and GENERATE_INVOICE now persist real records. Organism audit, capability reality report. |
| Jul 28–29 | Phase 0–3 control doc; founder data into version control; fake "41 active agents" replaced with real active/dormant verdicts. |
| Aug 28–29 | AURA engine deploy (v42); backend reconciliation; production recovery diagnosis (3 LLM-layer breaks, 1,102 stuck retry jobs). |
| Sep 8 (PR #2, merged) | Router: Gemini fallback, updated model IDs, every attempt logged. |
| Sep 21–23 (PR #3, open) | Production fix pass: real telemetry, retry discipline, duplicate-job fix, architecture inventory, founder brain on canonical router, 15-min founder-brain tick activated, replan cap, `/console` mount, V1 capability classification, no fabricated persistence claims, evidence-gated objective verification. |

## 3. Where FKAIOS stands against the original vision

The vision: *I tell FKAIOS what I want; it understands, plans, does the work,
checks the work really happened, learns, and keeps going, asking me only for
approval.*

| Requirement | Reality | Status |
|---|---|---|
| Give FKAIOS an objective | Backend path exists (`orchestrator_requests`). **No UI to type one**: the UI only reads `orchestrator_requests` (DecisionCenter, read-only). | 🔴 front door missing |
| Understand / reason / decide | Founder brain stages run on the canonical router; tested live | 🟢 |
| Plan | Objective → project → tasks tested (`executive-planner.ts`) | 🟢 |
| Assign work | Tasks become real `ai_jobs`; real worker selection | 🟢 |
| Do real work | Capability dispatch proven for a limited set of capabilities | 🟢/🟡 |
| Not fake completion | Fixed and tested | 🟢 |
| Verify independently | Deterministic evidence gate added (PR #3) | 🟢/🟡 |
| Handle failure | Retry limits, orphan reaper, reassignment | 🟢 |
| Remember state | Postgres-backed; `fleet_memory` untyped | 🟡 |
| Continue autonomously | 15-min tick active; long end-to-end run not yet proven | 🟡 |
| Talk to FKAIOS naturally | Not yet | 🔴 |
| Rajeev AI → FKAIOS | Rajeev AI is separate; **no reference to it anywhere in this repo** | 🔴 |
| Approve / edit / reject actions | Approvals exist for some paths; objective approvals are read-only in UI | 🟡 |
| WhatsApp | Code exists; never connected to a live number | 🟡 |
| Self-coding / test / deploy | Software-factory pieces; full loop never demonstrated | 🔴 |
| Learn from outcomes | `ai_outcomes`, `ai_evolution` = 0 rows | 🔴 |
| Self-evolution | Not started | 🔴 |

Revenue remains ₹0. That is a business fact, not the next engineering step.

## 4. Agreed roadmap (founder's direction, 2026-09-23)

1. **Stage 1 — Engine.** Largely built (brain, planner, orchestration, jobs, execution, recovery, verification). Merge PR #3.
2. **Stage 2 — Usable FKAIOS V1 (now).** Command Center at `/console` with:
   - an objective input box that writes `orchestrator_requests`
   - a live status view per objective (plan, tasks, jobs, evidence, verdict)
   - Approve / Edit / Reject buttons on anything awaiting approval
   - a secure API so Rajeev AI can submit objectives and read status (plain authenticated HTTP first; A2A later)
3. **Stage 3 — Business autopilot.** Capability layer (MCP), browser worker, WhatsApp/email/CRM behind approval, scheduled and long-running objectives.
4. **Stage 4 — Self-building / self-evolving.** Coding worker loop (write → test → fix → staging → approval → deploy), outcome learning, governed self-improvement.

Rule: the FKAIOS kernel (Supabase, objective loop, planner, `ai_jobs`,
verification, governance) is kept. Outside tools plug in as workers. None of
them replace the kernel.

## 5. Open-source capability candidates (to evaluate, not install)

Source: the founder's research notes of 2026-09-23. Version, release and
feature claims are **not yet independently verified** in this repo. Verify
each one when its evaluation starts.

| FKAIOS gap | Candidate | Plan |
|---|---|---|
| Tool plug-in standard | MCP | Adopt as the capability interface, with an allow-list and security review per server |
| Browser work | Playwright MCP (Browser Use as alternative) | First capability to benchmark |
| Business integrations | n8n | Evaluate; check its fair-code licence before commercial use |
| Self-coding worker | OpenHands, Cline | Benchmark on one real FKAIOS task in Stage 4 |
| General worker | Goose | Evaluate later |
| Approval / durable workflow patterns | LangGraph, Mastra (TypeScript) | Borrow patterns only; don't replace the kernel |
| Free/local models | Ollama (later vLLM) | Add as another router provider for low-risk tasks |
| LLM gateway / budgets | LiteLLM | Compare against the existing router before any switch |
| Vector memory | Qdrant | Only if Supabase memory proves insufficient |
| Google capabilities | Google Agent Skills, agents-cli, ADK | Use as dev/skill accelerators, not the kernel |
| Agent-to-agent | A2A | Later, for Rajeev AI ↔ FKAIOS |
| Chat UI patterns | Open WebUI | Study the patterns; build our own Command Center |

"Free software" does not mean "free to run". WhatsApp messaging, cloud
resources, paid data, GPUs and commercial LLM APIs still cost money.

## 6. Standing rules

No fake data. Evidence, not claims. Improve what exists, don't rebuild. AI
never moves money. ₹0 stays ₹0. Work autonomously; stop only for money,
credentials, or legal/irreversible decisions. Evaluate new tools one at a
time against a real FKAIOS requirement.

## 7. Waiting on the founder

1. Review and merge PR #3.
2. Approve starting the Stage 2 Command Center + Rajeev AI API build.
3. Share where Rajeev AI lives (repo, hosting, how it talks today), since it isn't in this repo.
4. Later: WhatsApp Business number, paid contact data, and 2026–2029 revenue targets.
