/// <reference lib="deno.ns" />
// Regression tests for fact-grounding.ts (worker grounding + objective task
// gate). Task titles/descriptions below are copied from real
// orchestration_tasks rows in production, including the 2026-09-23 Bharat
// Paints objective (79ef3604) whose distributor task was answered with 20
// invented companies.
import {
  assessObjectiveTasks,
  assessTaskEvidence,
  buildNoDataSourceResult,
  checkWorkerGrounding,
  NO_DATA_SOURCE,
  requiresExternalFacts,
} from "./fact-grounding.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const DISTRIBUTOR_TASK = {
  title: "Identify and Shortlist 20 Potential Distributors",
  description: "Research and compile a targeted list of 20 high-potential regional paint distributors in key tier-1 and tier-2 Indian markets that fit Bharat Paints' profile for partnership.",
};
const MARKET_TASK = {
  title: "Analyze Indian Paint Market Size and Segments",
  description: "Conduct comprehensive research on the Indian paint industry, focusing on regional growth trends, competitive landscape, and market share to align distribution strategy with revenue milestones.",
};
const EVALUATE_TASK = {
  title: "Evaluate Distributor Profiles and Outreach Strategy",
  description: "Assess the shortlisted distributors based on logistics capabilities, existing network reach, and financial standing, and prepare a preliminary outreach plan to secure initial partnership meetings.",
};

// Shape of the real fabricated result stored on job d2fe6be4.
const FABRICATED_RESULT = {
  status: "completed",
  task_id: "fbb164e5-e1ee-4069-8428-eae6f265d821",
  deliverable: {
    shortlisted_distributors: [
      { id: "DIST-01", city: "Ahmedabad", region: "West India", fit_score: 92, company_name: "Shreeji Paints & Hardware Agency", warehouse_sq_ft: 5000, active_dealers: 120 },
      { id: "DIST-02", city: "Indore", region: "Central India", fit_score: 90, company_name: "Khandelwal Enterprises", warehouse_sq_ft: 4200, active_dealers: 95 },
    ],
  },
};

const INTERNAL_TASKS = [
  { title: "Record V1 Autonomous Loop Initiation Entry in fleet_memory", description: "Write a structured entry into fleet_memory documenting the start of the V1 autonomous-loop test." },
  { title: "Audit System Readiness and Document Broken Components", description: "Conduct an immediate audit of all operational systems. Explicitly confirm which components are non-functional and which are operational." },
  { title: "Check research engine connection status", description: "Check whether the research engine's external Apify data connection is currently active and report the status honestly." },
  { title: "Search knowledge vault for capability registry documentation", description: "Search the company knowledge vault for any indexed documents mentioning \"capability registry\". Report what is found." },
  { title: "Draft Commission-Only Power-of-Attorney", description: "Prepare a signed digital power-of-attorney and commission-only agreement." },
  { title: "Acknowledge test completion (Task 24 negative test)", description: "This is a narrative-only acknowledgment task with no downstream capability dispatch involved. Confirm it is done." },
];

// ── A: factual external task with no research capability ─────────────────
Deno.test("A1: the real distributor task is classified as needing external facts", () => {
  assert(requiresExternalFacts(DISTRIBUTOR_TASK), "distributor shortlist must need external facts");
  assert(requiresExternalFacts(MARKET_TASK), "market-size research must need external facts");
  assert(requiresExternalFacts(EVALUATE_TASK), "assessing distributors the worker does not have must need external facts");
});

Deno.test("A2: an external-facts answer without a capability is rejected as no_data_source, not completed", () => {
  const verdict = checkWorkerGrounding(DISTRIBUTOR_TASK, FABRICATED_RESULT);
  assert(!verdict.ok, "fabricated distributor list must not be accepted");
});

Deno.test("A3: the stored no_data_source result carries only the explanation, none of the invented facts", () => {
  const stored = buildNoDataSourceResult("task requires real-world facts", "d2fe6be4");
  const text = JSON.stringify(stored);
  assert(stored.status === NO_DATA_SOURCE, "status must be no_data_source");
  assert(!text.includes("Shreeji") && !text.includes("shortlisted_distributors") && !text.includes("fit_score"), "no fabricated content may be stored");
});

Deno.test("A4: a worker that reports no_data_source itself is rejected even for an internal-looking task", () => {
  const verdict = checkWorkerGrounding(INTERNAL_TASKS[1], { status: "no_data_source", reason: "no system inventory available" });
  assert(!verdict.ok && verdict.reason === "no system inventory available", "self-reported no_data_source must be honored with its reason");
});

Deno.test("A5: an external-facts task that requests a capability is allowed through to real dispatch", () => {
  const verdict = checkWorkerGrounding(MARKET_TASK, { capability: "knowledge.search", payload: { query: "Indian paint market" } });
  assert(verdict.ok, "a capability request produces measured evidence later and must not be blocked here");
});

Deno.test("A6: legitimate internal tasks are not classified as external research and still complete", () => {
  for (const task of INTERNAL_TASKS) {
    assert(!requiresExternalFacts(task), `internal task misclassified: ${task.title}`);
    assert(checkWorkerGrounding(task, { status: "completed", summary: "done" }).ok, `internal task blocked: ${task.title}`);
  }
});

// ── B / C: objective verification over the full task set ─────────────────
const doneInternal = (id: string, title: string) => ({ id, title, description: "Write a structured entry into fleet_memory.", status: "done", output: JSON.stringify({ status: "completed", entry: "ok" }) });
const doneDispatch = (id: string, status: string) => ({ id, title: "Search knowledge vault", description: "Search the knowledge vault.", status: "done", output: JSON.stringify({ llmResult: {}, companyOsDispatch: { capability: "knowledge.search", status } }) });

Deno.test("B1: 2 succeeded + 1 no_data_source -> not achieved, blocked", () => {
  const gate = assessObjectiveTasks([
    doneInternal("a", "Task A"),
    doneDispatch("b", "success"),
    { id: "c", title: "Task C", status: "rework", output: JSON.stringify(buildNoDataSourceResult("no research capability")) },
  ]);
  assert(!gate.allVerified, "must not be achievable");
  assert(gate.blocked, "a no_data_source task must block the objective");
});

Deno.test("B2: 2 succeeded + 1 still retrying -> not achieved", () => {
  const gate = assessObjectiveTasks([doneInternal("a", "Task A"), doneDispatch("b", "success"), { id: "c", title: "Task C", status: "assigned", output: null }]);
  assert(!gate.allVerified && !gate.blocked, "an active task means not achieved, not blocked");
});

Deno.test("B3: 2 succeeded + 1 failed capability dispatch -> not achieved", () => {
  const gate = assessObjectiveTasks([doneInternal("a", "Task A"), doneInternal("b", "Task B"), doneDispatch("c", "error")]);
  assert(!gate.allVerified, "a failed dispatch must prevent achievement");
});

Deno.test("B4: the live Bharat Paints task set can never verify (fabricated output stored before this fix)", () => {
  const gate = assessObjectiveTasks([
    { id: "97318820", ...MARKET_TASK, status: "done", output: JSON.stringify({ llmResult: { capability: "knowledge.search" }, companyOsDispatch: { capability: "knowledge.search", status: "error", error: "HTTP 401" } }) },
    { id: "fbb164e5", ...DISTRIBUTOR_TASK, status: "done", output: JSON.stringify(FABRICATED_RESULT) },
    { id: "77f5d311", ...EVALUATE_TASK, status: "done", output: JSON.stringify({ status: "completed", plan: "outreach" }) },
  ]);
  assert(!gate.allVerified, "must not be achievable");
  assert(gate.blocked, "unverifiable external-facts output must block, not count as evidence");
  const distributor = gate.tasks.find((t) => t.id === "fbb164e5");
  assert(distributor?.verdict === NO_DATA_SOURCE, "the fabricated distributor output must be classified no_data_source");
});

Deno.test("B5: live shape — fabricated output truncated to 5000 chars (invalid JSON) still blocks as no_data_source", () => {
  const truncated = JSON.stringify(FABRICATED_RESULT).slice(0, 120);
  const gate = assessObjectiveTasks([
    { id: "97318820", ...MARKET_TASK, status: "done", output: JSON.stringify({ llmResult: { capability: "knowledge.search" }, companyOsDispatch: { capability: "knowledge.search", status: "error", error: "HTTP 401" } }) },
    { id: "fbb164e5", ...DISTRIBUTOR_TASK, status: "done", output: truncated },
    { id: "77f5d311", ...EVALUATE_TASK, status: "rework", output: JSON.stringify(buildNoDataSourceResult("no research capability")) },
  ]);
  assert(!gate.allVerified && gate.blocked, "truncated fabricated output must block, not merely fail");
  assert(gate.tasks.find((t) => t.id === "fbb164e5")?.verdict === NO_DATA_SOURCE, "truncated distributor output must be no_data_source");
});

Deno.test("C1: 3 tasks all succeeded with successful evidence -> achievable", () => {
  const gate = assessObjectiveTasks([doneInternal("a", "Task A"), doneDispatch("b", "success"), doneInternal("c", "Task C")]);
  assert(gate.allVerified && !gate.blocked, "all verified tasks must allow achievement");
});

Deno.test("C2: an empty task set is never achievable", () => {
  assert(!assessObjectiveTasks([]).allVerified, "no tasks means nothing was verified");
});

Deno.test("C3: a done task with no recorded output is not evidence", () => {
  assert(assessTaskEvidence({ id: "x", title: "Task", status: "done", output: null }).verdict === "failed", "missing output must not verify");
});
