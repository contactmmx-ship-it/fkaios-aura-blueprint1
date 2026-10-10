/// <reference lib="deno.ns" />
import { objectiveDeadline, objectiveDeadlineMinutes, resolveObjectiveStartAt, DEFAULT_OBJECTIVE_DEADLINE_MINUTES } from "./objective-deadline.ts";

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

Deno.test("deadline start persists across rerun flag clearing", () => {
  const now = new Date("2026-10-10T12:00:00.000Z");
  const requested = "Re-run requested at 2026-10-10T11:00:00.000Z. New planning pass starts next tick.";
  const start = resolveObjectiveStartAt("2026-10-01T00:00:00.000Z", requested, null, true, now);
  assert(start === "2026-10-10T11:00:00.000Z", "rerun must use requested timestamp");
  const afterFlagCleared = resolveObjectiveStartAt("2026-10-01T00:00:00.000Z", null, start, false, now);
  assert(afterFlagCleared === start, "persisted timestamp must win after rerun marker is cleared");
});

Deno.test("verification repair gets a fresh deadline instead of the original submission date", () => {
  const now = new Date("2026-10-10T12:00:00.000Z");
  const summary = "Reopened for verification evidence repair at 2026-10-10T11:55:00.000Z: verify again.";
  const start = resolveObjectiveStartAt("2026-10-01T00:00:00.000Z", summary, "2026-10-01T00:00:00.000Z", true, now);
  assert(start === "2026-10-10T11:55:00.000Z", "verification repair must start a fresh bounded run");
});
