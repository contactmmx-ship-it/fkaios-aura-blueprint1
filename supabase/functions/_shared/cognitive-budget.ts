// LLM budget for the Founder Brain's background thinking (cognitiveTick).
//
// founder-brain-tick runs every 15 minutes. The objective loop needs LLM
// calls only when an objective has work to plan or evaluate, but
// cognitiveTick() makes 6-10 LLM calls on every run regardless. On a free
// provider tier that alone exhausts the daily quota (observed 2026-09-23:
// Gemini served 129 calls, then 429 for the rest of the day), leaving none
// for founder objectives. The cognitive cycle is therefore limited to once
// per interval; the objective loop still runs on every tick.
//
// Pure and import-free so it is unit-tested.

export const COGNITIVE_CYCLE_ACTION = "cognitive_cycle";
export const DEFAULT_COGNITIVE_INTERVAL_MINUTES = 60;
const MIN_COGNITIVE_INTERVAL_MINUTES = 15;

// COGNITIVE_CYCLE_INTERVAL_MINUTES overrides the default; values below the
// tick interval (15) or unparseable values fall back to the default.
export function cognitiveIntervalMinutes(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= MIN_COGNITIVE_INTERVAL_MINUTES ? n : DEFAULT_COGNITIVE_INTERVAL_MINUTES;
}

export function shouldRunCognitiveCycle(
  lastCycleAt: string | null | undefined,
  now: Date,
  intervalMinutes: number,
): { run: boolean; reason: string } {
  if (!lastCycleAt) return { run: true, reason: "no previous cognitive cycle recorded" };
  const last = Date.parse(lastCycleAt);
  if (!Number.isFinite(last)) return { run: true, reason: "previous cognitive cycle time unreadable" };
  const elapsedMin = (now.getTime() - last) / 60000;
  if (elapsedMin >= intervalMinutes) return { run: true, reason: `${Math.floor(elapsedMin)} min since last cognitive cycle` };
  return {
    run: false,
    reason: `last cognitive cycle ${Math.floor(elapsedMin)} min ago; runs at most every ${intervalMinutes} min to keep LLM quota for objectives`,
  };
}

// 4 Nov 2026 (token audit): the hourly cognitive cycle made ~11 LLM calls every hour all day (214 calls,
// ~620k input tokens by 5 PM) even when nothing had changed, and kept running while a founder objective was
// using the same free quota. It now also waits when (a) a founder objective is running, or (b) nothing new
// has arrived since the last cycle — up to IDLE_MAX_HOURS, after which it runs once anyway.
export const IDLE_MAX_HOURS = 6;

export function idleCognitiveGate(input: {
  lastCycleAt: string | null | undefined;
  now: Date;
  newSignalsSinceLastCycle: number;
  founderObjectiveRunning: boolean;
}): { run: boolean; reason: string } | null {
  if (input.founderObjectiveRunning) {
    return { run: false, reason: "a founder objective is running; the free AI quota goes to it first" };
  }
  if (!input.lastCycleAt) return null;
  const last = Date.parse(input.lastCycleAt);
  if (!Number.isFinite(last)) return null;
  const hours = (input.now.getTime() - last) / 3600000;
  if (input.newSignalsSinceLastCycle <= 0 && hours < IDLE_MAX_HOURS) {
    return { run: false, reason: `nothing new since the last cognitive cycle ${Math.floor(hours * 60)} min ago; idle cycles run at most every ${IDLE_MAX_HOURS} h` };
  }
  return null; // no idle reason to skip: the normal interval rule decides
}
