#!/usr/bin/env python3
"""Generates docs/FKAIOS_MASTER_REQUIREMENTS_REGISTER.md and its CSV companion
from the single list below. Edit the list, then run:  python3 tools/requirements_register.py"""
import csv, io, os
from collections import Counter

LAST = "2026-10-09"
FIELDS = ["id", "intent", "source", "priority", "decision", "status", "files", "deps", "criteria", "test", "evidence", "blocker", "next", "verified"]
R = []
def r(id, intent, source, priority, status, criteria, evidence="", files="", deps="", test="", blocker="", next="", decision="Accepted", verified=LAST):
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
