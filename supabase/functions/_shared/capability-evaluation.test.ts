/// <reference lib="deno.ns" />

import { adoptionEvidenceGate, backgroundEvaluationPriorityGate, MAX_BACKGROUND_EVAL_TICKS_PER_DAY, MIN_ADOPTION_CASES_PER_CLASS } from "./capability-evaluation.ts";

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
