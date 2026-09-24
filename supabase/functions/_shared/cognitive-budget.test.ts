/// <reference lib="deno.ns" />
import { cognitiveIntervalMinutes, DEFAULT_COGNITIVE_INTERVAL_MINUTES, shouldRunCognitiveCycle } from "./cognitive-budget.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const NOW = new Date("2026-09-24T07:15:00Z");

Deno.test("first cycle ever runs", () => {
  assert(shouldRunCognitiveCycle(null, NOW, 60).run, "no history -> run");
});

Deno.test("a cycle 15 minutes ago skips; one 60+ minutes ago runs", () => {
  const recent = shouldRunCognitiveCycle("2026-09-24T07:00:05Z", NOW, 60);
  assert(!recent.run && recent.reason.includes("at most every 60 min"), `expected skip, got ${recent.reason}`);
  assert(shouldRunCognitiveCycle("2026-09-24T06:15:00Z", NOW, 60).run, "60 min elapsed -> run");
});

Deno.test("unreadable timestamp does not block the cycle forever", () => {
  assert(shouldRunCognitiveCycle("not-a-date", NOW, 60).run, "bad timestamp -> run");
});

Deno.test("interval override is bounded", () => {
  assert(cognitiveIntervalMinutes(undefined) === DEFAULT_COGNITIVE_INTERVAL_MINUTES, "default");
  assert(cognitiveIntervalMinutes("120") === 120, "override");
  assert(cognitiveIntervalMinutes("5") === DEFAULT_COGNITIVE_INTERVAL_MINUTES, "below tick interval -> default");
  assert(cognitiveIntervalMinutes("abc") === DEFAULT_COGNITIVE_INTERVAL_MINUTES, "garbage -> default");
});
