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
