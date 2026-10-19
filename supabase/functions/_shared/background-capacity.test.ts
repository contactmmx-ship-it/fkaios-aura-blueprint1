import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { backgroundEvaluationDeferralReason, MAX_BACKGROUND_EVALUATION_CALLS_PER_24H } from "./background-capacity.ts";

Deno.test("objective-attached evaluation is never deferred by the background budget", () => {
  assertEquals(backgroundEvaluationDeferralReason({
    isEvaluation: true, hasObjective: true, activeObjectiveCount: 10, callsLast24Hours: 999,
  }), null);
});

Deno.test("background evaluation defers while any founder objective is processing", () => {
  assertEquals(backgroundEvaluationDeferralReason({
    isEvaluation: true, hasObjective: false, activeObjectiveCount: 1, callsLast24Hours: 0,
  }), "Deferred: objective work has priority for scarce model capacity.");
});

Deno.test("background evaluation defers after the rolling daily cap", () => {
  const reason = backgroundEvaluationDeferralReason({
    isEvaluation: true, hasObjective: false, activeObjectiveCount: 0,
    callsLast24Hours: MAX_BACKGROUND_EVALUATION_CALLS_PER_24H,
  });
  if (!reason?.includes("daily cap reached")) throw new Error("expected the daily evaluation cap to defer work");
});

Deno.test("ordinary non-evaluation jobs are not affected by the evaluation budget", () => {
  assertEquals(backgroundEvaluationDeferralReason({
    isEvaluation: false, hasObjective: false, activeObjectiveCount: 5, callsLast24Hours: 100,
  }), null);
});
