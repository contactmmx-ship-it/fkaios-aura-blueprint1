/// <reference lib="deno.ns" />

import { adoptionEvidenceGate, MIN_ADOPTION_CASES_PER_CLASS } from "./capability-evaluation.ts";

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
