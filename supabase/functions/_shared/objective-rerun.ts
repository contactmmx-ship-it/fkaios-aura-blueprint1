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
// completes its project with the summary as final_output; a failed one fails
// it. A blocked objective (awaiting_approval) is not finished and can be
// re-run, so the project keeps its current non-terminal status and only
// records the blocker.
export function projectUpdateForObjective(status: ObjectiveDecision, summary: string): Record<string, unknown> {
  if (status === "completed") {
    return { status: "complete", final_output: summary, draft_final_output: null, error_message: null };
  }
  if (status === "failed") return { status: "failed", error_message: summary };
  return { error_message: summary };
}
