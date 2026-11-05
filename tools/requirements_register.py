#!/usr/bin/env python3
"""Generates docs/FKAIOS_MASTER_REQUIREMENTS_REGISTER.md and its CSV companion
from the single list below. Edit the list, then run:  python3 tools/requirements_register.py"""
import csv, io, os
from collections import Counter

LAST = "2026-11-05"
OLD = "2026-10-09"  # items before the 4 Nov block were last verified on 9 Oct
FIELDS = ["id", "intent", "source", "priority", "decision", "status", "files", "deps", "criteria", "test", "evidence", "blocker", "next", "verified"]
R = []
def r(id, intent, source, priority, status, criteria, evidence="", files="", deps="", test="", blocker="", next="", decision="Accepted", verified=OLD):
    R.append(dict(id=id, intent=intent, source=source, priority=priority, decision=decision, status=status, files=files, deps=deps,
                  criteria=criteria, test=test, evidence=evidence, blocker=blocker, next=next, verified=verified))

D = "Master Execution Directive 9 Oct 2026"
AM = "docs/FKAIOS_ACCEPTANCE_MATRIX.md"
SOT = "docs/FKAIOS_MASTER_SOURCE_OF_TRUTH.md"
RA = "docs/FKAIOS_REAUDIT_2026-10-08.md"

# ── P0 execution and security ────────────────────────────────────────────
r("P0-EXEC-01", "Objectives are planned for the deliverable they ask for (a report is not a website)", D+" §4 P0.1 (root cause found 9 Oct)", "P0", "IMPLEMENTED_UNVERIFIED",
  "Kids DPS text classifies as information; stale product plan retired and replanned in production",
  "objective-contract.test.ts (6 tests pass); PR #78", "_shared/objective-contract.ts, _shared/objective-loop.ts, ai-engine/index.ts", "PR #78 merge + CI deploy",
  "deno test _shared/ → 167 passed, 1 failed (A7, failing before this work)", "PR #78 awaiting founder merge confirmation", "Merge #78; confirm plan ef6fbcec retired and 20cbf892 replanned as report")
r("P0-EXEC-02", "builder-engine accepts the supported server-to-server credential (sb_secret key) without weakening auth", D+" §4 P0.1", "P0", "IMPLEMENTED_UNVERIFIED",
  "Internal product.build call returns a build record and live /product/<id> URL; forged/anon/malformed tokens get 401",
  "Gateway log 08:04:02 UTC: sb_secret_ prefix, function-level 401; internal-auth.test.ts (8 tests)", "_shared/internal-auth.ts, builder-engine/index.ts", "PR #78",
  "internal-auth tests pass", "PR #78 not yet deployed", "After deploy, run one product objective or the product self-test and record build_id + URL")
r("P0-EXEC-03", "builder-engine generation uses routed, verified resources (no hard-wired model without credit)", D+" §9", "P0", "IMPLEMENTED_UNVERIFIED",
  "A build completes via selectResources('coding') on a verified model", "", "builder-engine/index.ts", "PR #78", "", "PR #78 not yet deployed", "Verify on first build after deploy")
r("P0-EXEC-04", "Resume the existing Kids DPS objective 20cbf892 without creating a duplicate", D+" §1, §5", "P0", "IN_PROGRESS",
  "Same objective_id reaches completed with verified report, or a truthful blocker", "fkaios_objective_state 20cbf892 phase executing v33 (baseline)", "", "P0-EXEC-01",
  "", "Depends on #78 deploy", "Observe replan → research → report → verifier → Console")
r("P0-SEC-01", "Scheduled calls never carry the secret in URLs; secret rotated; receivers validate a header", SOT+" §5.3; docs/FKAIOS_P0_CRON_SECRET_PLAN.md", "P0", "BLOCKED",
  "0 cron.job commands contain '?secret='; old secret rejected; new header calls succeed; logs show no secret",
  "Baseline: 17 active jobs url-secret, 1 header, 1 auth-header, 8 SQL-only (cron.job, 9 Oct)", "docs/FKAIOS_P0_CRON_SECRET_PLAN.md", "Founder rotation",
  "", "Rotation is a secret-store write: founder-only (plan step 1). executive-intelligence does not read the header yet and must be fixed + deployed before cutover",
  "Rajeev runs plan step 1; Claude applies fkaios_cron_call migration and alters each job")
r("P0-SEC-02", "No function accepts an arbitrary Authorization header as proof of identity", "Found 9 Oct during P0.1 trace", "P0", "IN_PROGRESS",
  "research-engine, workday-engine (fixed in #78); enrichment, lead-discovery, lead-ingestion-engine, orchestrator-brain, linkedin-webhook reviewed and fixed",
  "Pattern `provided !== secret && !authHeader` in 6 functions; workday-engine (no-verify-jwt) accepted any Bearer string", "research-engine/index.ts, workday-engine/index.ts", "",
  "", "Remaining 5 functions are not in the CI deploy list; their live source differs from repo (69-function drift)", "Reconcile each with live source, add to CI, apply internal-auth")
r("P0-SEC-03", "Apify token stored with real encryption (not XOR with a default-key fallback)", "Found 9 Oct (research-engine getActiveToken)", "P1", "MISSING",
  "Token in Vault or encrypted with a required secret; no hard-coded fallback key", "research-engine/index.ts decryptToken", "", "", "", "Secret handling = founder approval", "Propose Vault migration to founder")
r("P0-REC-01", "Stale and interrupted work is recovered by defined lease rules; terminal failure visible", D+" §4 P0.3", "P0", "VERIFIED_COMPLETE",
  "Hourly reaper marks stale builds/projects failed with reasons; active work untouched",
  "cron fkaios-reap-stale-work (hourly :07); first run marked 9 builds + 22 projects failed with reasons (9 Oct)", "supabase/migrations/20261009034813_fkaios_reap_stale_work.sql", "", "", "", "Add ai_jobs lease-expiry evidence to the next checkpoint")

# ── Objective loop / acceptance ─────────────────────────────────────────
r("AT-01", "Natural-language objective executes through to actual delivery", AM+" test 1", "P1", "IN_PROGRESS", "One founder objective completed with verified deliverable shown in Console",
  "Kids DPS 20cbf892 submitted from Console 9 Oct 08:03 UTC", "", "P0-EXEC-01..04", "", "Depends on #78", "See P0-EXEC-04")
r("AT-02", "Historical knowledge search returns source-backed evidence", AM+" test 2", "P1", "VERIFIED_COMPLETE", "Query returns file + line range", "self-test f5d930dd (9 Oct 03:50)", "_shared/knowledge-library.ts", "", "self-test history_retrieval passed")
r("AT-03", "Exact-page retrieval on real documents including OCR", AM+" test 3", "P1", "IMPLEMENTED_UNVERIFIED", "Founder's real book: printed page → PDF page with OCR flag",
  "Verified on generated books (f5d930dd); no real founder book indexed", "_shared/knowledge-library.ts", "Founder upload", "", "No real book uploaded", "Rajeev uploads a book to the documents bucket")
r("AT-04", "Blueprint reuse avoids unsupported facts and cross-brand leakage", AM+" test 4", "P1", "VERIFIED_COMPLETE", "Deterministic checks pass after correction", "self-test 699ba88a, evidence 2a55e69c", "_shared/blueprint-reuse.ts", "", "", "Founder's own SOPs not uploaded (limitation)")
r("AT-05", "Project/artifact inventory accurate and accessible", AM+" test 5", "P1", "IMPLEMENTED_UNVERIFIED", "Inventory visible and searchable in the Console",
  "docs/fkaios_project_inventory.csv (19 rows, from live tables)", "docs/FKAIOS_PROJECT_AND_ARTIFACT_INVENTORY.md", "", "", "Not exposed in Console", "Console inventory panel (CON-04)")
r("AT-06", "Two or more distinct specialist capabilities contribute to one objective", AM+" test 6", "P1", "IN_PROGRESS", "Job IDs of ≥2 capabilities (e.g. knowledge.search + research.run) with separate outputs integrated and verified",
  "", "", "AT-01")
r("AT-07", "Independent tasks execute concurrently inside one objective", AM+" test 7", "P1", "MISSING", "Timestamps proving overlap of independent tasks plus a sequential control",
  "objective-loop allocates one task at a time by design (evidence chain)", "_shared/objective-loop.ts, _shared/work-engine.ts", "", "", "Design change needed: dependency-aware allocation", "Add depends_on to plan tasks; allocate all tasks whose dependencies are done")
r("AT-08", "Interrupted work recovers without duplicate side effects", AM+" test 8", "P1", "VERIFIED_COMPLETE", "Resume across limit; continuation", "voice_turn b41ae8bb; continuation 3e57e289")
r("AT-09", "Provider/model fallback under controlled failure", AM+" test 9", "P1", "VERIFIED_COMPLETE", "Failover self-test + live reroute", "model_failover 3e57e289; staff/workday rerouted 9 Oct")
r("AT-10", "Independent verification detects and corrects a failed deliverable", AM+" test 10", "P1", "IMPLEMENTED_UNVERIFIED", "Controlled failure → targeted correction → passing recheck on an objective deliverable",
  "Verified for blueprint reuse (0d03384f → 699ba88a); objective verifier is same-model", "_shared/objective-verifier.ts", "AT-01", "", "Single working provider", "Run on Kids DPS deliverable")
r("AT-11", "Scheduled discovery identifies candidates and records evidence", AM+" test 11", "P1", "VERIFIED_COMPLETE", "Scheduled run with evidence", "run 716b1eb9, evidence 6818b1c1")
r("AT-12", "Scheduled execution authenticated; secrets protected", AM+" test 12", "P0", "BLOCKED", "See P0-SEC-01", "", "", "P0-SEC-01", "", "Founder rotation")
r("AT-13", "Live voice input and response in the Console", AM+" test 13", "P1", "IMPLEMENTED_UNVERIFIED", "Founder uses mic in Console; turn recorded", "voice_turn self-tests b41ae8bb, a3ca6e21 (server path)", "", "", "", "Needs a physical microphone session", "Rajeev tries voice in Console")
r("AT-14", "Signed-in production objective ends with verified accessible delivery", AM+" test 14", "P1", "IN_PROGRESS", "Kids DPS completed and visible in /console", "Console /console HTTP 200 (dpl_F2u9b752)", "", "AT-01")
r("AT-15", "Automated regression tests run and results recorded", AM+" test 15", "P1", "VERIFIED_COMPLETE", "Suite runs on every PR", "167 passed / 1 pre-existing failure (A7) on PR #78", "", "", "deno test -A --no-check _shared/")

# ── Console ─────────────────────────────────────────────────────────────
r("CON-01", "Objective command centre shows persisted objective, phase, tasks, blockers, next action", D+" §6.1", "P1", "IMPLEMENTED_UNVERIFIED", "Refresh shows the true persisted status", "ObjectiveCommand.tsx renders fkaios_objective_state", "src/components/fkaios/ObjectiveCommand.tsx", "", "ObjectiveCommand.render.test.tsx", "", "Visual check with Kids DPS")
r("CON-02", "Decision Center lists real approvals; approve/reject persisted; action gated", D+" §6.2", "P1", "IMPLEMENTED_UNVERIFIED", "Approval de2aeafd visible and actionable", "approvals table; DecisionCenter page exists", "", "", "", "", "Verify with de2aeafd")
r("CON-03", "Knowledge search in Console with source, excerpt, line/page refs; no-evidence state", D+" §6.3", "P1", "MISSING", "Search panel calls founder-objective knowledge_search", "Backend action exists (founder-objective knowledge_search)", "founder-objective/index.ts", "", "", "", "Build Console panel")
r("CON-04", "Searchable project/artifact inventory view", D+" §6.4", "P1", "MISSING", "Filterable view with status/source/verification", "", "", "AT-05")
r("CON-05", "Accessible states, keyboard navigation, no decorative dead controls, no demo data as live", D+" §6.5", "P1", "PLANNED", "Audit of /console pages", "", "src/components/fkaio/AppShell.tsx")

# ── Founder Brain, memory, knowledge ────────────────────────────────────
r("FB-01", "Founder Brain sequence observe→think→imagine→predict→evaluate→decide", D+" §7.1", "P1", "IMPLEMENTED_UNVERIFIED", "Tick log shows each stage", "founder-brain-tick runs every minute", "_shared/founder-brain.ts")
r("FB-02", "Policy tiers: automatic / log-only / founder-approval", D+" §7.10; docs/FKAIOS_CONSTITUTION_V1.md", "P1", "IMPLEMENTED_UNVERIFIED", "Paid/external actions create approvals", "approvals table; communications gated")
r("FB-03", "Current Truth with provenance; conflicts preserved, flagged for founder", D+" §7.7-7.8", "P1", "PLANNED", "Conflict register with both statements", SOT+" §3 reconciliation (manual)")
r("KN-01", "Knowledge layer: PDF/OCR/DOCX ingestion, provenance, dedup, failures recorded", D+" §8", "P1", "IMPLEMENTED_UNVERIFIED", "DOCX ingestion + failure register", "PDF/OCR/text verified; DOCX not implemented", "_shared/knowledge-library.ts", "", "", "", "Add DOCX extraction")
r("KN-02", "Missing-source register for unavailable histories", D+" §8", "P1", "IMPLEMENTED_UNVERIFIED", "Register lists each unprocessed source and the export needed", "Baseline doc §Needs the founder; inventory marks NOT IN ACCESSIBLE SYSTEMS")
r("KN-03", "Project passports for active projects", D+" §8, §11", "P1", "PLANNED", "One passport per active project with decisions, DO-NOT-USE rules, blockers", "docs/FKAIOS_PROJECT_AND_ARTIFACT_INVENTORY.md (partial)")

# ── Routing / evolution ─────────────────────────────────────────────────
r("RT-01", "Model registry with real health; task-aware selection; fallback", D+" §9", "P1", "VERIFIED_COMPLETE", "Selection by task class, health recorded", "fkaios_routing_policies v1 (8 classes); provider_health_state")
r("RT-02", "Evaluation is not adoption: de2aeafd gemini-3.7-flash coding adoption awaits founder", D+" §9; approval de2aeafd", "P1", "BLOCKED", "Approval decided; routing policy changes only after approval", "Active coding policy still gemini-3.5-flash-lite first (9 Oct)", "", "", "", "Founder decision", "Rajeev decides in Decision Center")
r("RT-03", "Paid usage beyond limits requires authorization", D+" §9.14", "P1", "VERIFIED_COMPLETE", "Paid lead discovery left stopped; no paid provider enabled", "Baseline doc")
r("RT-04", "Second provider for independent model verification", RA, "P2", "BLOCKED", "Distinct provider verifies", "", "", "", "", "Paid/credentials: founder")

# ── Business projects ───────────────────────────────────────────────────
for pid, name, note in [
  ("BP-01","Franchise Kart / FKAIOS","Active; this repository"),
  ("BP-02","Mr. Chick'n","Proposal stored (client_projects cfde8eb2); SOPs not uploaded"),
  ("BP-03","Healthfreek","Proposal named in history; document not in accessible systems"),
  ("BP-04","GoMax","No verified data connector; objective 6217332e failed (superseded)"),
  ("BP-05","Syros OPD EMR","History only; 'DO NOT USE' artifact recorded (file 2 lines 2401-2460)"),
  ("BP-06","Kids DPS","Objective 20cbf892 in progress")]:
    r(pid, f"Reconcile project: {name}", D+" §11", "P2", "IMPLEMENTED_UNVERIFIED" if pid=="BP-01" else "IN_PROGRESS" if pid=="BP-06" else "BLOCKED" if pid in("BP-02","BP-03","BP-04") else "PLANNED",
      "Authoritative/stale/historical status recorded with source", note, "docs/fkaios_project_inventory.csv")

# ── 4 Nov 2026: every feature discussed or approved since June, from all chats ──
# Sources: Claude chats Jun–Nov, the FKAIOS memory (768 chats), Master Analysis (10 Oct), Knowledge Pack (4 Nov),
# the 29–30 Oct tab and capability checks, and live checks on 4 Nov. Status vocabulary as above.
# LOST = built in a chat but never reached the repo (recorded as MISSING with that note).
N4 = "2026-11-04"
def n(id, intent, source, status, evidence="", next="", priority="P1", blocker=""):
    r(id, intent, source, priority, status, "Live end-to-end test with evidence (Done = proof)", evidence, next=next, blocker=blocker, verified=N4)
MA = "Master Analysis 10 Oct"; KP = "Knowledge Pack 4 Nov"; JUL15 = "Autonomous build 15 Jul"; S = "Founder Brain sprints 17–19 Jul"
C = "Cycles C1–C35 21 Jul"; V = "Vision restated 10–11 Oct"; OB = "ONE BRAIN plan 26 Oct"; AUR = "Aura master plan (ChatGPT, Oct–Nov)"

# Brain and memory
n("BR-01", "ONE BRAIN step 1: Brain Chat recalls founder memory and cites the chat", OB, "VERIFIED_COMPLETE", "Brain Chat acceptance test 29 Oct")
n("BR-02", "ONE BRAIN step 2: Vault, Decision Engine, Self-Learning, objectives read the one memory", OB, "CONFLICTING", "28–29 Oct checks; memory search v4 live 3 Nov. 5 Nov: founder reports the Knowledge Vault is empty. Logs: that browser opened an old branch-preview URL (built before the Founder Memory panel), not the live app. Separately the Vault's Add Document wrote to an old store the brain never reads; PR #254 makes it write to Founder Memory", "Founder opens fkaios-aura-blueprint1.vercel.app and confirms")
n("BR-03", "ONE BRAIN step 3: experience loop (expected vs actual lesson, recalled before acting)", OB, "MISSING", "brain_learning_insights empty; 10,263 fleet_memory rows not linked to tool/model", "Hermes-style lessons into existing table", "P0")
n("BR-04", "ONE BRAIN step 5: merge the 4 brains (founder-brain, brain-engine, ai-engine, executive-planner)", OB, "MISSING", "", "After GoMax passes twice")
n("BR-05", "Founder Brain thinks like a human: own ideas, rectify until satisfied, then plan", V+" (11 Oct)", "IN_PROGRESS", "Objective loop plans/verifies/rectifies; no idea-generation-and-compare step")
n("BR-06", "Learn Rajeev: thinking, standards, decisions, corrections; stated kept apart from inferred", V, "MISSING", "Founder Learning Loop (decision→outcome→lesson→patterns) rebuilt 21 Jul as patch only, never deployed")
n("BR-07", "Mission Engine: a decision spawns a mission with objective, agents, metrics, review date", "Learning Loop mandate 21 Jul", "MISSING", "", "After BR-03")
n("BR-08", "Truth Layer: every claim carries evidence, verification status, confidence", "Founder Constitution 21 Jul", "IN_PROGRESS", "Verifier + source check (PR #237–#239) cover objective outputs only")
n("BR-09", "Cognitive cells: confidence, reflection, reassignment, salience, curiosity, belief revision, Brain Intelligence Index", S, "IMPLEMENTED_UNVERIFIED", MA+": in code, mostly not shown in UI")
n("BR-10", "Signal Bus, Capability Registry self-model, Executive Brain controller, organ map, autonomy test", C, "MISSING", "LOST: 45 commits never pushed (confirmed 21 Jul)")
n("BR-11", "Outer-world knowledge kept separate from brand knowledge (crux, summary, fit for my projects)", "Founder 29 Oct", "IN_PROGRESS", "AI World digests written daily to the vault; fit-to-project not scored")
n("BR-12", "Memory types: working / episodic / semantic / procedural; 5 categories personal/org/brand/project/shared", AUR, "PLANNED")
n("BR-13", "Current Truth with provenance; conflicting sources preserved and flagged", "Register FB-03", "PLANNED")

# Objectives and quality
n("OB-01", "Objective = finished result (a website objective means a live premium site; Excel means the file)", "Founder 29 Oct", "IN_PROGRESS", "Contracts by deliverable type (#234); only text reports proven")
n("OB-02", "Resume a failed/finished objective from where it stopped", "Founder 3 Nov", "IMPLEMENTED_UNVERIFIED", "PR #235; failed→verifying transition still missing")
n("OB-03", "Source check: every figure attributed to its real source; no invented targets", "Founder 3 Nov", "IMPLEMENTED_UNVERIFIED", "PR #237–#239 live; run 5 caught issues")
n("OB-04", "GoMax real objective passes twice (6/6), second run better because of the first", KP, "IN_PROGRESS", "Runs 1–5: best 3.5/6; run 6 after quota reset", "Run 6", "P0")
n("OB-05", "Stop self-set objectives the brain cannot execute", "Capability audit 30 Oct", "MISSING", "197 of 227 objectives were self-set and failed; 49 agent objectives active 4 Nov", "Founder decision", "P0")
n("OB-06", "Approval queue holds only real decisions (rules not requests)", "Capability audit 30 Oct", "IN_PROGRESS", "5 Nov: pending approvals older than 2 days set to expired with a reason (migration 20261105150000, PR #251); the rule that stops new request-type approvals is not built", "Stop agents filing requests as approvals", "P0")
n("OB-07", "Portfolio: a new project never erases old ones; owners, deadlines, dependencies; parallel work", V, "MISSING", "Register AT-07: one task at a time by design")
n("OB-08", "Fix failures by root cause in batches with regression tests", V, "IN_PROGRESS", "Practised in PRs #231–#241 with tests")
n("OB-09", "Objective result shown on screen", "Tab check 29 Oct", "MISSING")
n("OB-10", "Overlapping ticks cannot duplicate work (lease/lock)", "Run 5, 4 Nov", "PLANNED", "Dedupe in #240; lease table approved 4 Nov", "Build lease")

# Skills ("hands")
n("SK-01", "Skills library + make Excel", "Skills plan 3 Nov", "VERIFIED_COMPLETE", "skill-excel live 4 Nov (PR #242): 200/400/401 tests, read-back, LibreOffice total", "Planner picks it")
n("SK-02", "Planner picks the right skill for a sheet/report/PDF/document request", "Skills plan 3 Nov", "MISSING", "Capability finder fixed 4 Nov (PR #243)", "", "P0")
n("SK-03", "PDF and Word skills", "Skills plan 3 Nov", "MISSING")
n("SK-04", "Radar → proposed skills; founder approves; repo-to-skill method (Karpathy-style extract + tests)", "Skills plan 3 Nov; founder 4 Nov", "MISSING")
n("SK-05", "Delegated access to founder's apps (Drive, Gmail, Calendar) granted once, every action logged", "Gaps register 30 Oct", "MISSING")
n("SK-06", "Document intelligence: read a signed agreement, extract clauses and obligations", "Capability audit 30 Oct", "MISSING")
n("SK-07", "Exact-page answers from real books (OCR)", "Register AT-03", "IMPLEMENTED_UNVERIFIED", "No real book uploaded")

# Radar and world intelligence
n("RD-01", "World Radar daily free scan (GitHub, Hugging Face, MCP registry, OpenRouter, AI news)", OB+" step 4", "IMPLEMENTED_UNVERIFIED", "337 candidates, 26 discovery runs")
n("RD-02", "Radar evaluates and scores against register needs; weekly top 5 for approval; adopt with rollback", OB+" step 4", "MISSING", "All 337 status 'new'; relevance scoring wrong (Mem0 scored 0)", "Fix scoring", "P0")
n("RD-03", "Discovery sources: TAAFT, Futurepedia, Toolify, Product Hunt, Papers with Code, HF Agentic Resource Discovery, n8n", "ChatGPT 29 Oct", "PLANNED")
n("RD-04", "Daily Intelligence & Learning feed per role/brand", AUR+" phase 6", "PLANNED")
n("RD-05", "Radar → Vault: source registry, 9-step processing, confidence and expiry per item", AUR+" phase 5", "PLANNED")

# Cost and resources
n("CS-01", "Free-first: never stop when one free quota runs out — switch provider automatically", "Founder 28 Oct", "IN_PROGRESS", "Groq/Gemini chain + verifier backoff (#240); quota still ran out in run 5")
n("CS-02", "No paid AI/search without approval (paid-search gate)", "Founder rule", "VERIFIED_COMPLETE", "paid_research_auto OFF; gate live since 28 Oct")
n("CS-03", "Budget rules (founder sets rules, not per-request approvals; warn 80%, hard stop)", "ChatGPT Resource Engine; approved 4 Nov", "IMPLEMENTED_UNVERIFIED", "PR #243 tables + fkaios_budget_status() live; no amounts set", "Founder sets amounts; wire into AI calls", "P0")
n("CS-04", "Cost per verified result; every AI call tagged with its objective", "ChatGPT Resource Engine", "MISSING", "agent_performance_metrics has no objective id")
n("CS-05", "Router: cheapest suitable model per task class (L1–L4), quality-gated escalation", "ChatGPT 2 Nov", "MISSING", "Fixed backup chain today")
n("CS-06", "AI credit wallet for brands (reserve, consume on verified work, release)", AUR+" phase 9", "PLANNED")
n("CS-07", "Local/free models (Ollama, Qwen) and local speech (Whisper, Piper)", MA+" not built", "MISSING", "PR #112 local inference unverified")
n("CS-08", "Provider outage preserves state and resumes; backups and recovery", "ChatGPT 2 Nov", "IN_PROGRESS", "Reaper + resume; backups not verified")

# Agents and AI company
n("AG-01", "AI CEO + executives (Finance, Sales, Marketing, Tech, Ops, HR) with KPIs, authority, reporting", V, "IMPLEMENTED_UNVERIFIED", "Executive Council: 84 reports, last 9 Oct")
n("AG-02", "41 agents each with identity, duties, test tasks, scorecard; one team under one brain", AUR+" phase 3", "MISSING", "Agent Workday broken since 9 Oct; 1,154 agent runs")
n("AG-03", "HR fills capability gaps: find agent/repo/free service, else define role and create agent", V, "MISSING")
n("AG-04", "Company creates its own work: opportunity backlog, KRAs/KPIs, daily roadmap to 2030 goal", JUL15+"; "+V, "IMPLEMENTED_UNVERIFIED", "Opportunity backlog engine + Evolution Engine (daily cron)")
n("AG-05", "Agents message each other with structured hand-offs; AI-to-AI orchestration", "Roadmap 15 Jul item 6", "MISSING")
n("AG-06", "Chief of Staff weekly review of agent work", "Tab check 29 Oct", "BLOCKED", "Last report 9 Oct (agents paused)")
n("AG-07", "Generic AI board review (5 disclosed roles, never real people's names)", C, "MISSING", "LOST 21 Jul")
n("AG-08", "Specialist / dynamic temporary agents activated only when relevant", "ChatGPT 3 Nov", "PLANNED")

# Founder interface
n("UI-01", "One entry point: 'What would you like me to accomplish today?' — tabs become views of one brain", "AHI mandate 22 Jul", "IN_PROGRESS", "Give an Objective works; 31 tabs remain")
n("UI-02", "Simplify sidebar to ~10 tabs; archive/merge duplicates (Decision Center, AI Company, My Brain)", KP, "MISSING", "", "", "P1")
n("UI-03", "Founder Cockpit panels connected to live intelligence", "Tab check 29 Oct", "MISSING", "Panels say 'awaiting intelligence connection'")
n("UI-04", "Founder Avatar: voice conversation in Hindi/Hinglish/English that speaks what is in the brain", V, "IN_PROGRESS", "Partly: needs Chrome/Edge; Indian voice id not set; 110 conversations")
n("UI-05", "Living Office UI: active, premium, executives and AI employees visibly working", "Roadmap 15 Jul item 4", "MISSING")
n("UI-06", "Morning brief and evening report (Chairman Partner OS features into FKAIOS)", MA, "MISSING", "Separate app; Founder Brain Brief stale since Sep")
n("UI-07", "Premium dark UI everywhere; no demo data shown as live", "Founder rule; CON-05", "IN_PROGRESS", "AURA Blueprint shows demo data")
n("UI-08", "Retire the duplicate Vercel copy of the app", "HANDOFF 28 Oct", "MISSING")

# Business and revenue
n("BZ-01", "Revenue Desk: AI drafts invoice → founder approves → sends", JUL15, "IMPLEMENTED_UNVERIFIED", "0 invoices ever raised")
n("BZ-02", "₹5 Cr progress engine and revenue blocker engine on live numbers", JUL15, "IMPLEMENTED_UNVERIFIED", "Revenue actuals not updated since Sep")
n("BZ-03", "Leads & pipeline from WhatsApp/Meta/LinkedIn webhooks; inbound /franchise capture", "Phases 0–5 Jun; "+JUL15, "BLOCKED", "150 leads, last 22 Sep; channel credentials missing")
n("BZ-04", "Brand commercial register: fees, receivables, deliverables per brand", "Capability audit 30 Oct", "MISSING")
n("BZ-05", "Dealer distribution module", "Capability audit 30 Oct", "MISSING")
n("BZ-06", "One control system for all brand work, CRMs and full history, brand-wise", "Founder 23 Oct", "IN_PROGRESS", "Brands & Projects tab (78 projects, read-only)")
n("BZ-07", "Razorpay payments, Google Calendar meetings, closer + objection handler, MIS briefing", "Phases 0–5 Jun", "BLOCKED", "Credentials placeholders")
n("BZ-08", "Proposal generation as executable plan (timeline, milestones, deliverables, remuneration, requirements)", "Founder rule; roadmap 15 Jul item 8", "IN_PROGRESS", "Proposal engine exists; plan format not enforced")
n("BZ-09", "Two reports per client objective: internal blueprint (tools, cost, profit) + client quote without tool names", "ChatGPT 2 Nov", "PLANNED")
n("BZ-10", "Market Validation engine (idea→demand→competition→finance→risk; can say 'don't invest yet')", "ChatGPT 29 Oct", "PLANNED")
n("BZ-11", "Business Resilience scenario tests (−20/−40/−60%)", "ChatGPT 2 Nov", "PLANNED")
n("BZ-12", "Courier-style brand roadmap with credit cost per milestone; brand agreement; work approval", AUR+" phase 9", "PLANNED")

# Software factory and products
n("SF-01", "Software Factory: intake → planner (dependency waves) → checkpointed queue → evidence-gated tasks", JUL15, "IMPLEMENTED_UNVERIFIED", MA+": 1 project, 29 tasks; code generation PLAN ONLY")
n("SF-02", "Component Marketplace (reusable components with evidence)", JUL15, "IMPLEMENTED_UNVERIFIED", "18 components")
n("SF-03", "Factories: Website, CRM, SaaS, Ecommerce, Mobile, ERP, AI-agent", "Factory directive Jul", "IN_PROGRESS", "Website Factory built (not re-checked); Dealer CRM in separate project; others not built")
n("SF-04", "Every factory product gets premium UI, roles, audit log, tests, SEO, deployment by default", "Platform Evolution Directive Jul", "PLANNED")
n("SF-05", "Builder AI / product build from an objective produces a live premium deliverable", "Register P0-EXEC-02/03", "IN_PROGRESS", "Product builds basic")

# Aura workspace (multi-user)
n("AU-01", "Login, SSO, onboarding (invite → profile → documents → HR review → workspace)", AUR+" phase 2", "PLANNED", "Basejump (MIT) chosen; schema approved 4 Nov")
n("AU-02", "Employee and brand workspaces; role vs brand membership; cross-brand denied at DB", AUR+" phase 2", "PLANNED", "Basejump; existing rbac_* tables empty")
n("AU-03", "AI associates per employee and AI relationship manager per brand (clearly AI names)", AUR+" phase 4", "PLANNED")
n("AU-04", "Relationship Engine: skill matching, relationship memory, performance", AUR+" phase 4", "PLANNED")
n("AU-05", "Unified workspace modes: Ask / Research / Write / Design / Develop / Analyse / Automate / Execute", AUR+" phase 7", "PLANNED")
n("AU-06", "Employee lifecycle to exit with access revocation", "Claude master plan 3 Nov", "PLANNED")
n("AU-07", "Aura pilot: founder + 1 employee + 1 associate + one brand + one real objective", KP, "PLANNED", "", "After GoMax passes twice")
n("AU-08", "Commercial multi-customer FKAIOS (isolation per customer)", "ChatGPT 2 Nov", "PLANNED", "", "", "P2")

# Voice and calls
n("VC-01", "Digital Rajeev call agent: routine calls always, all calls when busy; escalates money/new brand/family/legal", "Decision 25 Oct", "BLOCKED", "Plan: forwarding → Exotel/Plivo (paid) → Pipecat → speech layer", "Speech-test notebook; phone number needs approval")
n("VC-02", "Hindi speech-to-text (AI4Bharat IndicConformer / Whisper)", "HANDOFF 28 Oct", "MISSING")
n("VC-03", "Voice AI 'ARIA' sales calls to leads", "Tab check 29 Oct", "BLOCKED", "No phone line (paid)")
n("VC-04", "Rajeev AI inside every project via one shared service + widget", "Founder rule 25 Oct", "IN_PROGRESS")

# Continuity, governance, infrastructure
n("GV-01", "Cross-tool continuity: handover packet (objective, decisions, files, status, tests, next task)", "ChatGPT 2 Nov; PR #178", "IMPLEMENTED_UNVERIFIED", "PR #178 draft")
n("GV-02", "AGENTS.md rules for every AI tool", "Founder 4 Nov", "VERIFIED_COMPLETE", "PR #242")
n("GV-03", "Brand confidentiality enforced at DB level; no cross-brand learning", "Founder rule", "IN_PROGRESS", "avatar_conversations closed (#241); workspaces not built")
n("GV-04", "Public repo hygiene: no client data; scrub history", "Founder rule", "BLOCKED", "Client figures in git history", "Founder: SCRUB HISTORY")
n("GV-05", "Global Collaboration Intelligence + public visibility (LinkedIn, GitHub, Hugging Face)", "ChatGPT 29 Oct", "PLANNED", "", "", "P2")
n("GV-06", "FK DataCloud (self-hosted Postgres/MinIO/pgvector)", AUR+" phase 11", "PLANNED", "", "", "P2")
n("GV-07", "Own AI model path: open-weight + memory first, fine-tune later", "ChatGPT 2 Nov", "PLANNED", "", "", "P2")
n("GV-08", "Remove dummy functionality; label every part REAL/PARTIAL/MOCK/DUPLICATE/OBSOLETE", AUR+" phases 0 and 12", "MISSING")
n("GV-09", "Update FK HANDOFF at the end of every work session", "HANDOFF rule 6", "IN_PROGRESS")

# ── 4 Nov 2026 (second pass): items found by reading every Claude chat, 27 May → 4 Nov ──
H = "Full chat-history pass 4 Nov"
n("HX-01", "Event bus: every business event (lead, payment, stage change) triggers the right agent", "Master blueprint 18 Jun", "MISSING", "Designed (Postgres trigger → events table); dispatch is cron-based today")
n("HX-02", "50-agent workforce spec across 9 departments with per-agent role, input/output schema, escalation rule", "Master blueprint 18 Jun", "IMPLEMENTED_UNVERIFIED", "41 agents registered; 37 of 41 never completed a task (Sep audit)")
n("HX-03", "Lead and visa/immigration lifecycle state machines (study-abroad brand)", "Master blueprint 18 Jun", "MISSING")
n("HX-04", "Consolidate every existing tool, SOP, CRM and document into the one platform", "Roadmap A–J 23 Jun", "IN_PROGRESS", "Memory holds 881 sources; tools/CRMs still separate apps")
n("HX-05", "Founder AI Executive answers strategic questions and manages the founder's daily schedule", "Roadmap A–J 23 Jun; Phases 16–20 21 Jun", "MISSING", "Calendar connector available, not wired")
n("HX-06", "WhatsApp outbound to leads/clients (approval-gated)", "Roadmap A–J 23 Jun; Phases 16–20", "BLOCKED", "WhatsApp credentials missing; inbox 0 messages")
n("HX-07", "Accounting AI (books, Tally sync, GST)", "Roadmap A–J 23 Jun", "MISSING", "eBill2Tally exists as a separate Aura Tech app")
n("HX-08", "Customer-facing AI for each brand (chatbot answering franchise enquiries)", "Roadmap A–J 23 Jun", "IN_PROGRESS", "customer-assistant function exists; not verified")
n("HX-09", "Self-Running Expansion: system finds, qualifies and onboards franchise partners on its own", "Phases 16–20, 21 Jun", "MISSING")
n("HX-10", "Multi-Agent Collaboration runtime (agents work together on one goal)", "Phases 16–20, 21 Jun", "MISSING", "See AG-05")
n("HX-11", "Chairman features: accountability engine, decision hierarchy, Confusion Mode, Weekly Board Review, 72-hour Emergency Mode, decision log", "Chairman Partner OS 2–5 Jun", "MISSING", "Built in the separate Chairman Partner OS app, not in FKAIOS")
n("HX-12", "Five-horizon progress (day/week/month/year/2030) with velocity signal and daily snapshot", "Chairman Partner OS 5 Jun", "IMPLEMENTED_UNVERIFIED", "₹5 Cr progress engine in FKAIOS; five-horizon engine only in the separate app")
n("HX-13", "Brief delivery by WhatsApp, SMS and email (7:30 AM brief, 8 PM report, intraday assistant, 2030 visual dashboard)", "Chairman Partner OS 5 Jun", "MISSING", "Reading founder's WhatsApp messages was explicitly dropped")
n("HX-14", "Capital & holding view: SPV registry, investor pool/CRM, brand scorecard, acquisitions, capital raising calendar", "FK Chairman OS 3 Jun; ₹1,100 Cr plan 30 May", "MISSING")
n("HX-15", "AI answers become reopenable work objects in a Founder Workspace", "Recovery plan P0-1, 16 Jul", "IMPLEMENTED_UNVERIFIED", "work_objects bridge built 16 Jul; not re-checked")
n("HX-16", "CEO Strategic Planning Engine", "Roadmap 15 Jul item 2", "MISSING")
n("HX-17", "Executive KPI & Employee Operating System", "Roadmap 15 Jul item 3", "MISSING")
n("HX-18", "Autonomous Business Development Engine", "Roadmap 15 Jul item 7", "MISSING")
n("HX-19", "Revenue Automation Engine", "Roadmap 15 Jul item 9", "MISSING", "Revenue Desk is manual-approve only")
n("HX-20", "Scenario simulation ('what if 100 franchises') and business simulation", "Organism audit 21 Jul; C32", "MISSING", "Open-ended imagination exists; scenario model does not")
n("HX-21", "Nightly reflection cycle ('dreams') once the heartbeat runs", "Organism audit 21 Jul", "MISSING", "Heartbeat now runs every minute, so this is unblocked")
n("HX-22", "Immune system: AI self-check of agent, avatar and business decisions (not only code)", "Organism audit 21 Jul", "IN_PROGRESS", "Independent verifier for objectives only")
n("HX-23", "Eyes: market and competitor intelligence sensing", "Organism audit 21 Jul", "IMPLEMENTED_UNVERIFIED", "market-intelligence function; 5 rows (Jul)")
n("HX-24", "Multi-LLM council (several models deliberate on one decision)", "C32 21 Jul", "MISSING")
n("HX-25", "Reconcile the three constitutions (AHI DNA doc, engineering_constitution table, founder_memory amendments)", "Blocker list Jul", "BLOCKED", "Needs export of live tables")
n("HX-26", "Six governance documents kept in the repo: Constitution, AHI mandate, Transformation Program, Build Memory, Agent Registry, Mission Memory", "Governance freeze 21–22 Jul", "IN_PROGRESS", "docs/FKAIOS_CONSTITUTION_V1.md present; Build/Agent/Mission Memory not maintained")
n("HX-27", "Thinking Engine and Inner Voice (brain reasons aloud before acting)", "Master objective spec 10–12 Oct", "MISSING", "Master objective d8ca136f ran 10 projects, 1 complete")
n("HX-28", "Unified Digital Founder loop across the portfolio: sense → interpret → prioritise → decide → act → verify → update → escalate", "Founder Execution Register 21 Oct", "MISSING", "Written protocol only; acceptance test defined")
n("HX-29", "FKAIOS's first real job: maintain Bhavishya Command (daily 3 actions, proof, cash gap)", "Register P01 'done when'", "MISSING")
n("HX-30", "Brand Discovery questionnaire / readiness scoring inside FKAIOS", "PR #191; Brand Readiness Scanner 31 May–1 Jun", "IMPLEMENTED_UNVERIFIED", "PR #191 open")
n("HX-31", "Software Factory phase 3+: code generation, testing, deployment factory, continuous evolution", "Software Factory 15 Jul", "MISSING", "Stamped PLAN ONLY by design until real")
n("HX-32", "Move paid-key engines (Business Creator, Project Review, AI Company) to the free chain", KP+" step 7", "MISSING")
n("HX-33", "Reconcile duplicate department taxonomy (dept vs department; ACCOUNTS vs AT_ACCOUNTS)", "Live audit 21 Sep", "MISSING")
n("HX-34", "Employee AI OS for brand staff (route staff questions to AI, approvals to owner)", "Bharat Paints Employee AI OS 7 Jun; register P21", "PLANNED", "Separate project; fits Aura associates (AU-03)")

# Reuse and self-improvement (founder asks 4 Nov, missed from this register until 5 Nov)
RU = "Founder 4 Nov chat (reuse, repos, tools, tokens); added 5 Nov"
n("RU-01", "Karpathy-style skill: extract only the working core of a repo, keep it small, prove it with tests", RU, "MISSING", "Method agreed; no skill built with it yet", "Use it for the first repo→skill (RU-06)")
n("RU-02", "Same result with less work: reuse before build, smallest change that does the job", RU+"; founder rule", "IN_PROGRESS", "Rule is in founder_principles; reuse-first search live (task 29)")
n("RU-03", "Token efficiency: find what burns tokens and cut it (brain ticks, writer input, repeated context)", RU, "IN_PROGRESS", "Writer input capped and brain thinks only with work (fixes 3–4, 4 Nov); cost per objective not measured", "Cost per objective (item 6)", "P0")
n("RU-04", "Founder's reuse order for every task: 1) open-source repo, 2) free AI tool, 3) previous FKAIOS work, then build", RU, "IMPLEMENTED_UNVERIFIED", "5 Nov: PR #253 merged and CI-deployed; every objective contract records the order own repos → open-source repos → free tools → previous work → build new, and the planner is told to follow it (7/7 tests)", "Founder submits one objective; check its contract shows the order", "P0")
n("RU-05", "Search the founder's own repos (contactmmx-ship-it) first, before public repos", RU, "IMPLEMENTED_UNVERIFIED", "5 Nov: PR #253 deployed; own-repo query checked live on GitHub ('fkaios user:contactmmx-ship-it' → 4 own repos); own repos saved as the top solution options", "Same objective test as RU-04", "P0")
n("RU-06", "Find a free repo, turn it into a skill, plug it into FKAIOS (repo→skill worker)", RU+"; SK-04", "MISSING", "Needs an always-on runner (decision 23) and secrets (24)", "", "P0", "Founder decisions 23 and 24")
n("RU-07", "Continuous check of new repos/updates; adopt only with a before/after test (fewer tokens, better results, better reasoning, more capability)", RU+"; RD-02", "MISSING", "Radar collects 337 candidates; nothing evaluated or adopted", "Radar weekly top 5 for approval", "P0")
n("RU-08", "FKAIOS has the capabilities of the AI tools the founder uses, through API or repos, behind one interface, one skill per task", RU, "IN_PROGRESS", "Excel skill live; PDF/Word/slides and skill picker missing (SK-02, SK-03)", "PDF, Word, slides + skill picker")
n("RU-09", "Shortlist of open-source equivalents of top AI tools (LibreChat, OpenHands, OpenCode, Goose, Open Interpreter, LiteLLM, Docling, browser-use, Presenton, RAGFlow, Perplexica, AnythingLLM, Cline, Ollama); licence-restricted: Open WebUI, LobeChat, n8n, Dify", RU, "PLANNED", "List made 4 Nov; none evaluated")
n("RU-10", "Check open source before spending paid credits", RU+"; founder rule", "IN_PROGRESS", "No paid services without approval is enforced by rule; no automatic check before a paid call")
n("RU-11", "Workspaces and login on the approved schema (Basejump)", RU+"; 24-item list 18", "MISSING", "Approved, not built", "", "P1")
n("RU-12", "Fix first: repair what exists before adding new features", RU+"; founder rule", "IN_PROGRESS", "Applied 5 Nov: security fix, approvals archive, idle jobs paused")
n("FD-01", "GoMax and Turning Point dormant: left out of every plan, task, search and execution until reactivated", "Founder decision 5 Nov", "VERIFIED_COMPLETE", "Migration 20261105140000 (PR #250): brands paused, 5 projects paused, founder principle active; memory search drops paused brands (test passes)")
n("FD-02", "Commit to FK's own work, never promise results; no 'no guarantee' lines in proposals", "Founder decision 5 Nov", "VERIFIED_COMPLETE", "Founder principle active for every AI job (PR #250)")
n("FD-03", "Public memory search functions closed to anonymous callers", "Investigation 5 Nov (security)", "VERIFIED_COMPLETE", "Migration 20261105100000 (PR #249): anon execute=false, service role=true")

counts = Counter(x["status"] for x in R)
order = ["VERIFIED_COMPLETE","IMPLEMENTED_UNVERIFIED","IN_PROGRESS","BLOCKED","PLANNED","MISSING","CONFLICTING"]
here = os.path.dirname(os.path.abspath(__file__))
docs = os.path.join(here, "..", "docs")
with open(os.path.join(docs, "fkaios_requirements_register.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=FIELDS); w.writeheader(); w.writerows(R)
esc = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
lines = [
 "# FKAIOS master requirements register", "",
 f"Generated by `tools/requirements_register.py` from one list (machine-readable copy: [`fkaios_requirements_register.csv`](fkaios_requirements_register.csv)). Last updated {LAST}.", "",
 "A requirement is VERIFIED_COMPLETE only with accessible production evidence. Code alone is IMPLEMENTED_UNVERIFIED. Documentation, plans and duplicates are never counted as implemented.", "",
 "## Totals", "", "| Status | Count |", "|---|---|"] + [f"| {s} | {counts.get(s,0)} |" for s in order] + [f"| **Total** | **{len(R)}** |", "",
 "## Register", "", "| ID | Original intent | Source | Pri | Status | Evidence | Blocker | Next action | Last verified |", "|---|---|---|---|---|---|---|---|---|"]
for x in R:
    lines.append("| " + " | ".join(esc(x[k]) for k in ["id","intent","source","priority","status","evidence","blocker","next","verified"]) + " |")
lines += ["", "Full fields (decision, files, dependencies, acceptance criteria, test result) are in the CSV.", ""]
open(os.path.join(docs, "FKAIOS_MASTER_REQUIREMENTS_REGISTER.md"), "w").write("\n".join(lines))
print(dict(counts), len(R))
