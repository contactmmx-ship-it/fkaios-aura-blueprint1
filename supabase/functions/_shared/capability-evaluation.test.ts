/// <reference lib="deno.ns" />

import { activeObjectiveCutoff, ACTIVE_OBJECTIVE_MAX_AGE_HOURS, adoptionEvidenceGate, backgroundEvaluationPriorityGate, MAX_BACKGROUND_EVAL_TICKS_PER_DAY, MIN_ADOPTION_CASES_PER_CLASS, runCapabilityTestStep } from "./capability-evaluation.ts";

Deno.test("adoption evidence gate holds classes below three paired successful cases", () => {
  const gate = adoptionEvidenceGate(["coding", "reasoning"], { coding: 2, reasoning: 0 });
  if (gate.coding.eligible) throw new Error("two paired cases must not qualify for adoption");
  if (gate.coding.paired_successful_cases !== 2) throw new Error("paired count should be preserved");
  if (gate.reasoning.eligible) throw new Error("zero paired cases must not qualify for adoption");
  if (gate.reasoning.minimum_required !== MIN_ADOPTION_CASES_PER_CLASS) throw new Error("minimum threshold should be explicit");
});

Deno.test("adoption evidence gate allows exactly three paired successful cases", () => {
  const gate = adoptionEvidenceGate(["coding", "coding", "reasoning"], { coding: 3, reasoning: 4 });
  if (!gate.coding.eligible) throw new Error("three paired cases should meet the minimum gate");
  if (!gate.reasoning.eligible) throw new Error("four paired cases should meet the minimum gate");
});

Deno.test("adoption evidence gate deduplicates task classes and treats missing counts as zero", () => {
  const gate = adoptionEvidenceGate(["coding", "coding", "planning"], { coding: 3 });
  if (Object.keys(gate).length !== 2) throw new Error("task classes should be unique");
  if (gate.planning.paired_successful_cases !== 0 || gate.planning.eligible) throw new Error("missing counts must be held");
});


Deno.test("objective work has priority over background capability evaluation", () => {
  const gate = backgroundEvaluationPriorityGate({ activeObjectives: 1, queuedTests: 20 });
  if (gate.allowed || gate.reason !== "objective_priority") {
    throw new Error("background evaluations must defer while objectives are active");
  }
});

Deno.test("background capability evaluation idles when there is no queued test", () => {
  const gate = backgroundEvaluationPriorityGate({ activeObjectives: 0, queuedTests: 0 });
  if (gate.allowed || gate.reason !== "no_queued_tests") {
    throw new Error("an empty evaluation queue must not claim quota");
  }
});

Deno.test("background capability evaluation has a hard five-tick daily cap", () => {
  if (MAX_BACKGROUND_EVAL_TICKS_PER_DAY !== 5) {
    throw new Error("background evaluation daily cap must remain five ticks");
  }
  const gate = backgroundEvaluationPriorityGate({ activeObjectives: 0, queuedTests: 1 });
  if (!gate.allowed) throw new Error("a queued test may run when no objective is active");
});

// A request abandoned in 'processing' (24 Sep 2026) blocked every evaluation
// from 19 Oct until this fix: only recent requests may hold the priority gate.
function fakeDb(requests: Array<{ status: string; created_at: string }>, queued: number) {
  const rpcCalls: string[] = [];
  return {
    rpcCalls,
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      let rows: Array<Record<string, unknown>> = table === "orchestrator_requests" ? requests.map((r) => ({ id: "r", ...r }))
        : table === "capability_test_queue" ? Array.from({ length: queued }, () => ({ id: "t", status: "queued" })) : [];
      const q = {
        select: () => q,
        in: (col: string, vals: string[]) => { rows = rows.filter((r) => vals.includes(String(r[col]))); return q; },
        gte: (col: string, v: string) => { rows = rows.filter((r) => String(r[col]) >= v); return q; },
        limit: (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null }),
      };
      return q;
    },
    rpc(name: string) { rpcCalls.push(name); return Promise.resolve({ data: { allowed: false, reason: "test_stop" }, error: null }); },
  };
}

Deno.test("a stale 'processing' request no longer blocks background evaluation", async () => {
  const stale = new Date(Date.now() - 35 * 86400_000).toISOString();
  const db = fakeDb([{ status: "processing", created_at: stale }], 3);
  const out = await runCapabilityTestStep(db);
  if (out.deferred === "objective_priority") throw new Error("a 35-day-old request must not hold the priority gate");
  if (!db.rpcCalls.includes("fkaios_claim_background_eval_budget")) throw new Error("evaluation should proceed to the budget claim");
});

Deno.test("a recent active objective still has priority over evaluation", async () => {
  const db = fakeDb([{ status: "processing", created_at: new Date().toISOString() }], 3);
  const out = await runCapabilityTestStep(db);
  if (out.deferred !== "objective_priority") throw new Error("recent objectives must keep priority");
});

Deno.test("active-objective cutoff is 48 hours", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  if (ACTIVE_OBJECTIVE_MAX_AGE_HOURS !== 48) throw new Error("cutoff changed");
  if (activeObjectiveCutoff(now) !== "2026-10-27T12:00:00.000Z") throw new Error("cutoff arithmetic wrong");
});
