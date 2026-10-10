/// <reference lib="deno.ns" />
import { objectiveDeadline, objectiveDeadlineMinutes, objectiveRunStartedAt, DEFAULT_OBJECTIVE_DEADLINE_MINUTES } from "./objective-deadline.ts";

function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }

Deno.test("objective deadline expires at the configured budget", () => {
  const start = "2026-10-10T10:00:00.000Z";
  assert(!objectiveDeadline(start, new Date("2026-10-10T11:59:00.000Z"), 120).expired, "119 min should remain active");
  const expired = objectiveDeadline(start, new Date("2026-10-10T12:00:00.000Z"), 120);
  assert(expired.expired && expired.elapsedMinutes === 120 && expired.remainingMinutes === 0, "must expire at 120 min");
});

Deno.test("future start time does not create a negative elapsed duration", () => {
  const result = objectiveDeadline("2026-10-10T12:00:00.000Z", new Date("2026-10-10T11:00:00.000Z"), 120);
  assert(!result.expired && result.elapsedMinutes === 0, "future timestamp is clamped to zero elapsed");
});

Deno.test("missing or invalid timestamps are not falsely expired", () => {
  assert(!objectiveDeadline(null, new Date(), 120).expired, "missing start is not inferred as expired");
  assert(!objectiveDeadline("bad-date", new Date(), 120).expired, "invalid start is not inferred as expired");
});

Deno.test("deadline configuration is bounded", () => {
  assert(objectiveDeadlineMinutes(undefined) === DEFAULT_OBJECTIVE_DEADLINE_MINUTES, "default budget");
  assert(objectiveDeadlineMinutes("5") === DEFAULT_OBJECTIVE_DEADLINE_MINUTES, "too-small budget uses default");
  assert(objectiveDeadlineMinutes("999") === 360, "too-large budget is capped");
  assert(objectiveDeadlineMinutes("90") === 90, "valid override is honored");
});

Deno.test("deliberate rerun uses its recorded request time when the table has no updated_at", () => {
  const row = {
    created_at: "2026-10-09T08:03:40.589Z",
    action_taken: "rerun_requested",
    result_summary: "Re-run requested at 2026-10-10T09:30:00.000Z. The objective loop will plan it again on its next run.",
  };
  const started = objectiveRunStartedAt(row);
  assert(started === "2026-10-10T09:30:00.000Z", `expected rerun timestamp, got ${started}`);
  const deadline = objectiveDeadline(started, new Date("2026-10-10T10:00:00.000Z"), 120);
  assert(!deadline.expired && deadline.elapsedMinutes === 30, "a fresh rerun must not immediately expire from its original creation time");
});

Deno.test("ordinary scheduler passes remain anchored to the original objective creation time", () => {
  const started = objectiveRunStartedAt({
    created_at: "2026-10-10T08:00:00.000Z",
    action_taken: "objective_loop",
    result_summary: "old status summary",
  });
  assert(started === "2026-10-10T08:00:00.000Z", "scheduler ticks must not reset the budget");
});
