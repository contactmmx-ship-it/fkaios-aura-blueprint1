/** Bounded wall-clock budget for one objective run. Pure and deterministic for tests. */
export const DEFAULT_OBJECTIVE_DEADLINE_MINUTES = 120;
export const MIN_OBJECTIVE_DEADLINE_MINUTES = 15;
export const MAX_OBJECTIVE_DEADLINE_MINUTES = 360;

export function objectiveDeadlineMinutes(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < MIN_OBJECTIVE_DEADLINE_MINUTES) return DEFAULT_OBJECTIVE_DEADLINE_MINUTES;
  return Math.min(MAX_OBJECTIVE_DEADLINE_MINUTES, Math.floor(n));
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

export function resolveObjectiveStartAt(
  createdAt: string | null | undefined,
  resultSummary: string | null | undefined,
  recordedStart: string | null | undefined,
  restart: boolean,
  now: Date,
): string | null {
  const summary = String(resultSummary ?? "");
  const match = summary.match(/(?:Re-run requested at|Reopened for verification evidence repair at)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)/);
  if (restart) return match?.[1] ?? now.toISOString();
  if (recordedStart) return recordedStart;
  return match?.[1] ?? createdAt ?? null;
}
