/// <reference lib="deno.ns" />
// Regression tests for the research-evidence rules and the BLOCKED -> re-run
// path, using the live Bharat Paints task set (objective 79ef3604).
import { buildObjectiveDeliverable, canRerun, isRerunRequested, MAX_DELIVERABLE_CHARS, PROJECT_STATUSES, projectUpdateForObjective, rerunUpdate } from "./objective-rerun.ts";
import {
  assessCurrentTaskSet,
  assessTaskEvidence,
  compactDispatchForStorage,
  formatBlockedSummary,
  KNOWLEDGE_MATCH_MIN_SIMILARITY,
  NO_DATA_SOURCE,
} from "./fact-grounding.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const DISTRIBUTOR_TASK = {
  title: "Identify and Shortlist 20 Potential Distributors",
  description: "Research and compile a targeted list of 20 high-potential regional paint distributors in key tier-1 and tier-2 Indian markets.",
};

// A real vault-engine search response shape (match_knowledge_chunks rows).
const vaultDispatch = (similarities: number[]) => ({
  capability: "knowledge.search",
  status: "success",
  attempts: 1,
  data: {
    query: "Indian paint distributors",
    matches: similarities.map((s, i) => ({ id: `chunk-${i}`, document_id: `doc-${i}`, chunk_text: "x".repeat(1400), similarity: s })),
  },
});
const doneWith = (task: typeof DISTRIBUTOR_TASK, dispatch: unknown) => ({
  ...task,
  status: "done",
  output: JSON.stringify({ llmResult: { capability: "knowledge.search" }, companyOsDispatch: compactDispatchForStorage(dispatch) }).slice(0, 5000),
});

Deno.test("stored research evidence keeps verifiable source metadata and fits the 5000-char column", () => {
  const stored = compactDispatchForStorage(vaultDispatch([0.91, 0.88, 0.86, 0.84, 0.83]));
  const text = JSON.stringify({ companyOsDispatch: stored });
  assert(text.length < 5000, `stored evidence must not be truncated (was ${text.length})`);
  const matches = (stored.evidence as { matches: Array<Record<string, unknown>> }).matches;
  assert(matches.length === 5 && matches.every((m) => typeof m.document_id === "string" && typeof m.similarity === "number"), "every match has document_id + similarity");
  assert((stored.evidence as { query: string }).query === "Indian paint distributors", "query recorded");
});

Deno.test("a relevant, sourced vault match counts as evidence for a factual task", () => {
  const v = assessTaskEvidence(doneWith(DISTRIBUTOR_TASK, vaultDispatch([0.87])));
  assert(v.verdict === "verified", `expected verified, got ${v.verdict}: ${v.reason}`);
  assert(v.reason.includes("doc-0"), "reason names the source document");
});

Deno.test("ungrounded research cannot count: irrelevant vault matches are no_data_source", () => {
  // Only the FKAIOS charter is in the vault; a distributor query still "succeeds" with it.
  const v = assessTaskEvidence(doneWith(DISTRIBUTOR_TASK, vaultDispatch([0.72, 0.70])));
  assert(v.verdict === NO_DATA_SOURCE, `expected no_data_source, got ${v.verdict}`);
  assert(v.reason.includes(`below ${KNOWLEDGE_MATCH_MIN_SIMILARITY}`), "reason states the relevance floor");
  const empty = assessTaskEvidence(doneWith(DISTRIBUTOR_TASK, vaultDispatch([])));
  assert(empty.verdict === NO_DATA_SOURCE, "no matches is no evidence");
  const gate = assessCurrentTaskSet([{ id: "p1" }], [{ ...doneWith(DISTRIBUTOR_TASK, vaultDispatch([0.72])), project_id: "p1" }]);
  assert(gate.blocked && !gate.allVerified, "the objective blocks; it can never be achieved on irrelevant matches");
  assert(!formatBlockedSummary(gate).includes("xxxxxxxx"), "no search text is quoted into the founder summary");
});

Deno.test("an internal (non-factual) vault search still succeeds on any sourced result", () => {
  const v = assessTaskEvidence(doneWith({ title: "Search knowledge vault for capability registry documentation", description: "Search the company knowledge vault. Report what is found." }, vaultDispatch([0.7])));
  assert(v.verdict === "verified", "internal lookups are not held to the external-facts rule");
});

Deno.test("the live 401 dispatch stays a failure, not evidence", () => {
  const v = assessTaskEvidence({
    title: "Analyze Indian Paint Market Size and Segments",
    description: "Conduct comprehensive research on the Indian paint industry, focusing on competitive landscape and market share.",
    status: "done",
    output: JSON.stringify({ llmResult: { capability: "knowledge.search" }, companyOsDispatch: { capability: "knowledge.search", status: "error", error: "HTTP 401: {\"error\":\"Unauthorized\"}", attempts: 2 } }),
  });
  assert(v.verdict === "failed" && v.reason.includes("HTTP 401"), "401 is recorded as a failed dispatch");
});

Deno.test("BLOCKED objective can be re-run; high-risk approval and running objectives cannot", () => {
  assert(canRerun({ status: "awaiting_approval", action_taken: "objective_loop" }), "blocked by the loop -> re-runnable");
  assert(canRerun({ status: "failed", action_taken: "objective_loop" }), "failed -> re-runnable");
  assert(!canRerun({ status: "awaiting_approval", action_taken: null }), "high-risk approval is not a re-run");
  assert(!canRerun({ status: "processing", action_taken: "objective_loop" }), "already running");
  const update = rerunUpdate("2026-09-23T17:00:00Z");
  assert(update.status === "processing" && isRerunRequested(update), "re-run moves it to processing with the flag the loop reads");
});

Deno.test("after a re-run, the new planning pass decides; the old blocked pass stays as history", () => {
  const oldBlocked = { ...DISTRIBUTOR_TASK, status: "done", output: '{"status":"completed","deliverable":{"shortlisted_distri', project_id: "old" };
  const newPending = { ...DISTRIBUTOR_TASK, status: "assigned", output: null, project_id: "new" };
  const running = assessCurrentTaskSet([{ id: "new" }, { id: "old" }], [oldBlocked, newPending]);
  assert(!running.blocked && !running.allVerified, "new pass is executing, not blocked by the old one");
  const newVerified = { ...doneWith(DISTRIBUTOR_TASK, vaultDispatch([0.9])), project_id: "new" };
  const done = assessCurrentTaskSet([{ id: "new" }, { id: "old" }], [oldBlocked, newVerified]);
  assert(done.allVerified, "with real evidence the new pass can be achieved");
  const stillOld = assessCurrentTaskSet([{ id: "old" }], [oldBlocked]);
  assert(stillOld.blocked, "without a new pass the objective stays blocked");
});

// ── Project projection of an objective decision ──────────────────────────
// Live failure, objective 6217332e on 2026-10-04: the loop wrote the
// objective status 'awaiting_approval' onto orchestration_projects and hit
// orchestration_projects_status_check, so the blocked objective's project
// stayed 'working' with no recorded blocker.
const allowedProjectStatus = (update: Record<string, unknown>) =>
  !("status" in update) || (PROJECT_STATUSES as readonly unknown[]).includes(update.status);

Deno.test("P1: completed objective -> project 'complete' (allowed by the constraint)", () => {
  const update = projectUpdateForObjective("completed", "Objective achieved.");
  assert(update.status === "complete", "a completed objective must complete its project as 'complete', not 'completed'");
  assert(allowedProjectStatus(update), "project status must satisfy orchestration_projects_status_check");
});

Deno.test("P2: failed objective -> project 'failed' with the reason recorded", () => {
  const update = projectUpdateForObjective("failed", "FAILED: terminal error");
  assert(update.status === "failed", "a failed objective must fail its project");
  assert(update.error_message === "FAILED: terminal error", "the failure reason must be recorded");
  assert(allowedProjectStatus(update), "project status must satisfy orchestration_projects_status_check");
});

Deno.test("P3: blocked (awaiting_approval) objective keeps an allowed project status and records the blocker", () => {
  const blocker = "BLOCKED: FKAIOS could not complete this objective ... no_data_source";
  const update = projectUpdateForObjective("awaiting_approval", blocker);
  assert(update.status !== "awaiting_approval", "the objective status must never be copied onto the project");
  assert(allowedProjectStatus(update), "project status must satisfy orchestration_projects_status_check");
  assert(!("status" in update), "a blocked objective is not finished: the project keeps its current non-terminal status");
  assert(update.error_message === blocker, "the blocker must be persisted in error_message");
  assert(!("final_output" in update), "a blocked objective must not write a final output");
});

Deno.test("P4: a genuinely completed objective persists final_output and clears stale draft/error", () => {
  const update = projectUpdateForObjective("completed", "Verified report: 3 risks, 3 actions, P1/P2/P3 plan.");
  assert(update.final_output === "Verified report: 3 risks, 3 actions, P1/P2/P3 plan.", "final_output must be the objective summary");
  assert(update.draft_final_output === null && update.error_message === null, "draft and error must be cleared on completion");
});

// Shapes taken from the live charter objective 78f7828e (project 5258374c).
const CHARTER_TASKS = [
  {
    title: "Develop Prioritized Execution Plan",
    status: "done",
    created_at: "2026-10-04 14:46:17.973715+00",
    output: JSON.stringify({ status: "completed", task_id: "fc7446eb", deliverable: { title: "Prioritized Execution Plan: Path to ₹5 Crore Gate", phases: [{ phase_name: "Foundation (Months 1-3)" }] } }),
  },
  {
    title: "Identify Strategic Priorities and Source Evidence",
    status: "done",
    created_at: "2026-10-04 14:44:00+00",
    output: JSON.stringify({ companyOsDispatch: { capability: "knowledge.search", status: "success", evidence: { matches: [{ similarity: 0.902 }] } } }),
  },
  { title: "Never ran", status: "assigned", created_at: "2026-10-04 14:40:00+00", output: null },
];

Deno.test("V1: completed objective final_output carries the real work product, in execution order", () => {
  const text = buildObjectiveDeliverable("Charter analysed; plan produced.", CHARTER_TASKS);
  assert(text.startsWith("# Result\n\nCharter analysed; plan produced."), "the verdict leads the deliverable");
  assert(text.includes("Prioritized Execution Plan: Path to ₹5 Crore Gate"), "the task's explicit deliverable must be included");
  assert(text.includes("knowledge.search") && text.includes("0.902"), "evidence-bearing task output is kept as written");
  assert(text.indexOf("Identify Strategic Priorities") < text.indexOf("Develop Prioritized Execution Plan"), "tasks appear in execution order");
  assert(!text.includes("Never ran"), "unfinished tasks are not presented as delivered work");
});

Deno.test("V2: no completed task output -> the summary stands alone (nothing invented)", () => {
  assert(buildObjectiveDeliverable("Summary only.", [{ title: "x", status: "assigned", output: null }]) === "Summary only.", "no output means summary only");
});

Deno.test("V3: deliverable is bounded and says so when truncated", () => {
  const big = buildObjectiveDeliverable("S", [{ title: "Big", status: "completed", output: "y".repeat(MAX_DELIVERABLE_CHARS * 2) }]);
  assert(big.length < MAX_DELIVERABLE_CHARS + 300, "deliverable must be bounded");
  assert(big.includes("truncated at"), "truncation must be stated, not silent");
});

Deno.test("V4: projectUpdateForObjective stores the deliverable when given, the summary otherwise", () => {
  assert(projectUpdateForObjective("completed", "sum", "# Result\n\nwork").final_output === "# Result\n\nwork", "deliverable wins");
  assert(projectUpdateForObjective("completed", "sum").final_output === "sum", "summary fallback");
  assert(projectUpdateForObjective("failed", "why", "ignored").final_output === undefined, "a failed objective never gets a final_output");
});
