/** Capacity guard for non-objective model evaluation jobs.
 * Objectives own scarce provider quota. Background evaluations are deferred,
 * not failed, while objective work is active or the rolling daily budget is spent.
 */
export const MAX_BACKGROUND_EVALUATION_CALLS_PER_24H = 20;

export interface BackgroundEvaluationBudget {
  isEvaluation: boolean;
  hasObjective: boolean;
  activeObjectiveCount: number;
  callsLast24Hours: number;
  dailyCap?: number;
}

export function backgroundEvaluationDeferralReason(input: BackgroundEvaluationBudget): string | null {
  if (!input.isEvaluation || input.hasObjective) return null;
  if (input.activeObjectiveCount > 0) {
    return "Deferred: objective work has priority for scarce model capacity.";
  }
  const cap = input.dailyCap ?? MAX_BACKGROUND_EVALUATION_CALLS_PER_24H;
  if (input.callsLast24Hours >= cap) {
    return `Deferred: background evaluation daily cap reached (${cap} calls in the rolling 24-hour window).`;
  }
  return null;
}
