import { assertEquals } from "jsr:@std/assert@1";
import { checkWorkerGrounding, needsResearchBeforeAnswer, requiresExternalFacts } from "./fact-grounding.ts";

// The task that blocked Kids DPS 20cbf892 on 9 Oct 2026 13:30 UTC.
const KIDS_DPS_TASK_3 = {
  title: "90-Day Action Plan, KPIs, Dependencies, and Missing Information List",
  description: "Develop a practical 90-day execution plan for Kids DPS featuring prioritized milestones, measurable KPIs, and operational dependencies, alongside an explicit list of missing internal data required prior to investment or pricing decisions.",
};

Deno.test("research decision: the Kids DPS action-plan task gets research before it is answered", () => {
  assertEquals(requiresExternalFacts(KIDS_DPS_TASK_3), true);
  assertEquals(needsResearchBeforeAnswer(KIDS_DPS_TASK_3), true);
});

Deno.test("research decision: any task the grounding check would reject is researched first", () => {
  const tasks = [
    KIDS_DPS_TASK_3,
    { title: "Shortlist 20 distributors in Pune", description: "" },
    { title: "Compare competitors' franchise pricing", description: "" },
    { title: "Identify prospects", description: "with phone numbers" },
    { title: "Profile the competitive landscape", description: "" },
  ];
  for (const t of tasks) {
    const rejectedWithoutResearch = !checkWorkerGrounding(t, { answer: "text" }).ok;
    if (rejectedWithoutResearch) assertEquals(needsResearchBeforeAnswer(t), true, t.title);
  }
});

Deno.test("research decision: plural forms count (competitors, distributors)", () => {
  assertEquals(needsResearchBeforeAnswer({ title: "Benchmark the competitors" }), true);
  assertEquals(needsResearchBeforeAnswer({ title: "Contact distributors" }), true);
});

Deno.test("research decision: internal work and rectification need no research", () => {
  assertEquals(needsResearchBeforeAnswer({ title: "Draft the welcome email", description: "Use the approved tone." }), false);
  assertEquals(needsResearchBeforeAnswer({ title: "Rectify: corrected final deliverable (round 1)", description: "market competitors pricing" }), false);
});
