/** Bounded wall-clock budget for one objective run. Pure and deterministic for tests. */
export const DEFAULT_OBJECTIVE_DEADLINE_MINUTES = 120;
export const MIN_OBJECTIVE_DEADLINE_MINUTES = 15;
export const MAX_OBJECTIVE_DEADLINE_MINUTES = 360;

export function objectiveDeadlineMinutes(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < MIN_OBJECTIVE_DEADLINE_MINUTES) return DEFAULT_OBJECTIVE_DEADLINE_MINUTES;
  return Math.min(MAX_OBJECTIVE_DEADLINE_MINUTES, Math.floor(n));
}

/**
 * The orchestrator_requests table does not have an updated_at column.
 * A deliberate rerun stores its fresh start timestamp in result_summary.
 * Prefer that timestamp only while the rerun flag is active; ordinary runs
 * remain anchored to created_at so scheduler ticks cannot reset the budget.
 */
export function objectiveRunStartedAt(row: {
  created_at?: unknown;
  updated_at?: unknown;
  action_taken?: unknown;
  result_summary?: unknown;
}): string {
  if (row.action_taken === "rerun_requested" && typeof row.result_summary === "string") {
    const match = row.result_summary.match(/Re-run requested at (.+?)\. The objective loop/);
    if (match && Number.isFinite(Date.parse(match[1]))) return match[1];
  }
  return String(row.updated_at ?? row.created_at ?? "");
}

export function objectiveDeadline(
  startedAt: string | null | undefined,
  now: Date,
  budgetMinutes: number,
): { expired: boolean; elapsedMinutes: number | null; remainingMinutes: number | null; reason: string } {
  if (!startedAt) {
    return { expired: false, elapsedMinutes: null, remainingMinutes: budgetMinutes, reason: "No reliable start timestamp; deadline is not inferred." };
  }
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) {
    return { expired: false, elapsedMinutes: null, remainingMinutes: budgetMinutes, reason: "Start timestamp is unreadable; deadline is not inferred." };
  }
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - start) / 60000));
  const remainingMinutes = Math.max(0, budgetMinutes - elapsedMinutes);
  return {
    expired: elapsedMinutes >= budgetMinutes,
    elapsedMinutes,
    remainingMinutes,
    reason: elapsedMinutes >= budgetMinutes
      ? `Objective exceeded its ${budgetMinutes}-minute execution budget (${elapsedMinutes} minutes elapsed).`
      : `${remainingMinutes} minutes remain in the ${budgetMinutes}-minute objective budget.`,
  };
}
