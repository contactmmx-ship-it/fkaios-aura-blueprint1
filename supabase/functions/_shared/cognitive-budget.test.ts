/// <reference lib="deno.ns" />
import { cognitiveIntervalMinutes, DEFAULT_COGNITIVE_INTERVAL_MINUTES, idleCognitiveGate, shouldRunCognitiveCycle } from "./cognitive-budget.ts";

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

Deno.test("idle gate: a running founder objective always wins the quota", () => {
  const g = idleCognitiveGate({ lastCycleAt: null, now: new Date("2026-11-04T12:00:00Z"), newSignalsSinceLastCycle: 5, founderObjectiveRunning: true });
  assert(g?.run === false, "objective running → skip");
});
Deno.test("idle gate: nothing new → skip until 6 h, then run once", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  assert(idleCognitiveGate({ lastCycleAt: "2026-11-04T10:30:00Z", now, newSignalsSinceLastCycle: 0, founderObjectiveRunning: false })?.run === false, "idle < 6h → skip");
  assert(idleCognitiveGate({ lastCycleAt: "2026-11-04T05:30:00Z", now, newSignalsSinceLastCycle: 0, founderObjectiveRunning: false }) === null, "idle ≥ 6h → run");
});
Deno.test("idle gate: something new → defer to the hourly rule", () => {
  assert(idleCognitiveGate({ lastCycleAt: "2026-11-04T10:30:00Z", now: new Date("2026-11-04T12:00:00Z"), newSignalsSinceLastCycle: 2, founderObjectiveRunning: false }) === null, "new signals → hourly rule");
  assert(idleCognitiveGate({ lastCycleAt: null, now: new Date(), newSignalsSinceLastCycle: 0, founderObjectiveRunning: false }) === null, "first cycle → hourly rule");
});
