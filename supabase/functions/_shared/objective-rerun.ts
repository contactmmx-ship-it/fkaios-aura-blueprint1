// Founder-requested re-run of an objective that stopped (BLOCKED or FAILED),
// using existing orchestrator_requests fields only.
//
// founder-objective's `rerun` action sets status='processing' and
// action_taken=RERUN_REQUESTED. On its next run the objective loop sees the
// flag, creates a new planning pass (a new orchestration_projects row) and
// clears the flag; from then on the objective is judged on that new task set.
// Earlier projects and tasks are left untouched as history.
//
// Pure and import-free so both edge functions share it and it is unit-tested.

export const RERUN_REQUESTED = "rerun_requested";
export const OBJECTIVE_LOOP = "objective_loop";

// Marks an objective submitted from the Command Center. requested_by stays
// 'founder-brain' (that is what the objective loop picks up); classification
// is otherwise unused for these rows.
export const FOUNDER_OBJECTIVE_CLASSIFICATION = "founder_objective";

export interface ObjectiveLifecycleRow {
  status?: unknown;
  action_taken?: unknown;
}

// BLOCKED (the loop parked it in awaiting_approval) or FAILED can be re-run.
// A high-risk objective awaiting approval cannot: that needs an approval
// transition, which does not exist yet.
export function canRerun(row: ObjectiveLifecycleRow): boolean {
  if (row.status === "failed") return true;
  return row.status === "awaiting_approval" && row.action_taken === OBJECTIVE_LOOP;
}

export function isRerunRequested(row: ObjectiveLifecycleRow): boolean {
  return row.status === "processing" && row.action_taken === RERUN_REQUESTED;
}

export function rerunUpdate(requestedAt: string): { status: string; action_taken: string; result_summary: string } {
  return {
    status: "processing",
    action_taken: RERUN_REQUESTED,
    result_summary: `Re-run requested at ${requestedAt}. The objective loop will plan it again on its next run.`,
  };
}

// orchestration_projects.status check constraint. Objective and project
// statuses are different vocabularies: copying the objective status onto the
// project ('completed', 'awaiting_approval') violates this constraint.
export const PROJECT_STATUSES = ["planning", "working", "reviewing", "reworking", "merging", "complete", "failed"] as const;

export type ObjectiveDecision = "completed" | "failed" | "awaiting_approval";

// The project projection of an objective decision. A completed objective
// completes its project with the deliverable (or, failing that, the summary)
// as final_output; a failed one fails
// it. A blocked objective (awaiting_approval) is not finished and can be
// re-run, so the project keeps its current non-terminal status and only
// records the blocker.
export function projectUpdateForObjective(status: ObjectiveDecision, summary: string, deliverable?: string): Record<string, unknown> {
  if (status === "completed") {
    return { status: "complete", final_output: deliverable || summary, draft_final_output: null, error_message: null };
  }
  if (status === "failed") return { status: "failed", error_message: summary };
  return { error_message: summary };
}

export const MAX_DELIVERABLE_CHARS = 60000;

export interface DeliverableTask {
  title?: unknown;
  status?: unknown;
  output?: unknown;
  created_at?: unknown;
}

// Pull the human-readable part out of a persisted task output. Worker results
// are JSON envelopes; when one carries an explicit deliverable, that is the
// work product. Otherwise the output is kept as written (pretty-printed when
// it is JSON) so nothing the worker produced is hidden or reworded.
function taskWorkProduct(output: string): string {
  const trimmed = output.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const product = obj.deliverable ?? obj.content ?? obj.result;
      if (typeof product === "string" && product.trim()) return product.trim();
      if (product && typeof product === "object") return JSON.stringify(product, null, 2);
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    // not JSON: plain text output
  }
  return trimmed;
}

// The final_output of a completed objective: the verdict followed by every
// completed task's actual work product, in execution order. Built only from
// persisted task outputs, never generated, so it is exactly what was verified.
export function buildObjectiveDeliverable(summary: string, tasks: DeliverableTask[]): string {
  const done = tasks
    .filter((t) => typeof t.output === "string" && String(t.output).trim() &&
      ["completed", "done", "verified"].includes(String(t.status ?? "").toLowerCase()))
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  if (!done.length) return summary;
  const sections = done.map((t, i) => `## ${i + 1}. ${String(t.title ?? "Task").trim()}\n\n${taskWorkProduct(String(t.output))}`);
  const text = `# Result\n\n${summary.trim()}\n\n${sections.join("\n\n")}\n`;
  return text.length > MAX_DELIVERABLE_CHARS
    ? `${text.slice(0, MAX_DELIVERABLE_CHARS)}\n\n…(truncated at ${MAX_DELIVERABLE_CHARS} characters; full task outputs remain in orchestration_tasks)\n`
    : text;
}

/**
 * The deliverable as it stands now. Once a rectification task has produced a
 * corrected deliverable, that corrected version IS the result (the rejected
 * draft must not be presented alongside it); otherwise every completed task's
 * work product, in order.
 */
export function buildCurrentDeliverable(summary: string, tasks: DeliverableTask[]): string {
  const rectified = tasks
    .filter((t) => /^Rectify:/i.test(String(t.title ?? "")) && typeof t.output === "string" && String(t.output).trim() &&
      ["completed", "done", "verified", "approved"].includes(String(t.status ?? "").toLowerCase()))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  if (!rectified.length) return buildObjectiveDeliverable(summary, tasks);
  const text = `# Result\n\n${summary.trim() ? summary.trim() + "\n\n" : ""}${taskWorkProduct(String(rectified[0].output))}\n`;
  return text.length > MAX_DELIVERABLE_CHARS ? text.slice(0, MAX_DELIVERABLE_CHARS) : text;
}
