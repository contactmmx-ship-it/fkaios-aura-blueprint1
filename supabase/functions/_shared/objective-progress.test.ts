/// <reference lib="deno.ns" />
// Regression tests for objective-progress.ts and the blocked summary text,
// using the live Bharat Paints task set (objective 79ef3604).
import { summarizeObjectiveProgress } from "./objective-progress.ts";
import { assessObjectiveTasks, formatBlockedSummary } from "./fact-grounding.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// Same shapes as the live rows; the distributor output is truncated to invalid
// JSON exactly as returnCompletedWork() stored it.
const FABRICATED = JSON.stringify({ status: "completed", deliverable: { shortlisted_distributors: [{ company_name: "Shreeji Paints & Hardware Agency", fit_score: 92 }] } }).slice(0, 90);
const LIVE_TASKS = [
  { id: "77f5d311", title: "Evaluate Distributor Profiles and Outreach Strategy", description: "Assess the shortlisted distributors based on logistics capabilities, existing network reach, and financial standing.", status: "assigned", output: null },
  { id: "97318820", title: "Analyze Indian Paint Market Size and Segments", description: "Conduct comprehensive research on the Indian paint industry, focusing on competitive landscape and market share.", status: "done", output: JSON.stringify({ llmResult: { capability: "knowledge.search" }, companyOsDispatch: { capability: "knowledge.search", status: "error", error: "HTTP 401" } }) },
  { id: "fbb164e5", title: "Identify and Shortlist 20 Potential Distributors", description: "Research and compile a targeted list of 20 high-potential regional paint distributors.", status: "done", output: FABRICATED },
];
const LIVE_JOBS = [
  { status: "completed", retry_count: 0 },
  { status: "completed", retry_count: 0 },
  { status: "pending", retry_count: 1 },
];

Deno.test("progress: live task set counts come from real rows", () => {
  const p = summarizeObjectiveProgress(1, LIVE_TASKS, LIVE_JOBS);
  assert(p.tasksTotal === 3 && p.tasksVerified === 0, "0/3 verified");
  assert(p.tasksActive === 1 && p.jobsRetrying === 1, "1 active, 1 retrying");
  assert(p.tasksNoDataSource === 1 && p.tasksFailed === 1, "1 no_data_source, 1 failed dispatch");
});

Deno.test("progress: never carries task output, so fabricated content cannot reach the UI", () => {
  const text = JSON.stringify(summarizeObjectiveProgress(1, LIVE_TASKS, LIVE_JOBS));
  assert(!text.includes("Shreeji") && !text.includes("shortlisted_distributors") && !text.includes("fit_score"), "no output content");
});

Deno.test("blocked summary: names the rejected task and next action, quotes no output", () => {
  const gate = assessObjectiveTasks(LIVE_TASKS);
  assert(gate.blocked, "live set is blocked while a task is still active");
  const summary = formatBlockedSummary(gate);
  assert(summary.startsWith("BLOCKED: FKAIOS could not complete this objective"), "result line");
  assert(summary.includes('"Identify and Shortlist 20 Potential Distributors"') && summary.includes("rejected as ungrounded"), "reason names the task");
  assert(summary.includes("NEXT ACTION: Connect or enable a verified research capability"), "next action");
  assert(!summary.includes("Shreeji"), "no fabricated content");
});
