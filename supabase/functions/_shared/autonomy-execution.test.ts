/// <reference lib="deno.ns" />
import { deriveSnapshot, phasePath } from "./objective-state.ts";
import { contractCriteria, deterministicChecks, independenceLevel, parseVerdict } from "./objective-verifier.ts";
import { buildCurrentDeliverable } from "./objective-rerun.ts";
import { requiresExternalFacts } from "./fact-grounding.ts";

function assert(condition: boolean, message = "assertion failed"): void {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}\n     got ${a}`);
}

Deno.test("state machine: legal paths are found, terminal phases never left", () => {
  assertEquals(phasePath("executing", "completed"), ["verifying", "completed"]);
  assertEquals(phasePath("rectifying", "completed"), ["verifying", "completed"]);
  assertEquals(phasePath("planning", "verifying"), ["executing", "verifying"]);
  assertEquals(phasePath("completed", "executing"), null);
  assertEquals(phasePath("failed", "planning"), null);
  assertEquals(phasePath("blocked", "blocked"), []);
});

const T = (id: string, title: string, status: string, project = "p2", at = id) => ({ id, title, status, project_id: project, created_at: at, attempts: 0 });

Deno.test("snapshot: phase and progress come from the current planning pass only", () => {
  const snap = deriveSnapshot({
    objectiveStatus: "processing",
    contract: { acceptance_criteria: ["three rules"], intent: { goal: "g" } },
    projects: [{ id: "p2" }, { id: "p1" }],
    tasks: [T("a", "Research", "done"), T("b", "Report", "assigned"), T("z", "Old", "rework", "p1")],
    steps: [{ task_id: "a", resource_ref: "model:gemini:x", outcome: "completed", failure_category: null, error: null, verification_status: "unverified", created_at: "1" },
            { task_id: "b", resource_ref: "model:gemini:y", outcome: "failed", failure_category: "rate_limit", error: "429", verification_status: "unverified", created_at: "2" }],
  });
  assertEquals(snap.phase, "executing");
  assertEquals((snap.patch.completed_work as unknown[]).length, 1);
  assertEquals((snap.patch.remaining_work as Array<{ task_id: string }>).map((r) => r.task_id), ["b"]);
  assertEquals((snap.patch.resource_assignments as Record<string, string>).b, "model:gemini:y");
  assertEquals((snap.patch.failures as unknown[]).length, 1);
  assertEquals(snap.patch.replan_count, 1);
});

Deno.test("snapshot: rectification and verification phases", () => {
  const base = { objectiveStatus: "processing", contract: null, projects: [{ id: "p2" }], steps: [] };
  assertEquals(deriveSnapshot({ ...base, tasks: [T("a", "Report", "done"), T("r", "Rectify: corrected final deliverable (round 1)", "assigned")] }).phase, "rectifying");
  assertEquals(deriveSnapshot({ ...base, tasks: [T("a", "Report", "done")] }).phase, "verifying");
  assertEquals(deriveSnapshot({ ...base, objectiveStatus: "awaiting_approval", tasks: [] }).phase, "blocked");
  assertEquals(deriveSnapshot({ ...base, projects: [], tasks: [] }).phase, "planning");
});

Deno.test("verifier: deterministic checks catch placeholders, refusals and leaked errors", () => {
  assert(deterministicChecks("A complete answer that lists rule one, rule two and rule three with quotes.").ok);
  assert(!deterministicChecks("short").ok);
  assert(!deterministicChecks("The answer is [insert rule here] and more text to pass the length check.").ok);
  assert(!deterministicChecks("As an AI language model I cannot access the charter, but here is a general idea of rules.").ok);
  assert(!deterministicChecks('{"status":"no_data_source","reason":"nothing"} plus some extra padding text here').ok);
});

const DELIVERABLE = "Rule 1: Agents may not move money. The charter says \"AI never moves money\". Rule 2: Agents need founder approval for irreversible actions. Rule 3: No fake data is ever recorded.";

Deno.test("verifier: a 'met' criterion needs a quote that really appears in the deliverable", () => {
  const det = deterministicChecks(DELIVERABLE);
  const v = parseVerdict(JSON.stringify({
    criteria: [
      { criterion: "Lists three rules", met: true, evidence_quote: "Rule 3: No fake data is ever recorded" },
      { criterion: "Quotes the charter for each rule", met: true, evidence_quote: "the charter explicitly states rule two verbatim" },
    ],
    needs_human_decision: false, quality: 0.9, issues: [],
  }), DELIVERABLE, det)!;
  assertEquals(v.criteria.map((c) => c.met), [true, false]);
  assert(/not found in the deliverable/.test(v.criteria[1].issue ?? ""));
  assertEquals(v.passed, false);
});

Deno.test("verifier: passes only when every criterion is met, quality is sufficient and no human decision is needed", () => {
  const det = deterministicChecks(DELIVERABLE);
  const ok = { criteria: [{ criterion: "Lists three rules", met: true, evidence_quote: "Rule 1: Agents may not move money" }], needs_human_decision: false, quality: 0.8, issues: [] };
  assertEquals(parseVerdict(JSON.stringify(ok), DELIVERABLE, det)!.passed, true);
  assertEquals(parseVerdict(JSON.stringify({ ...ok, quality: 0.3 }), DELIVERABLE, det)!.passed, false);
  const human = parseVerdict("```json\n" + JSON.stringify({ ...ok, needs_human_decision: true, human_decision_reason: "requires payment" }) + "\n```", DELIVERABLE, det)!;
  assertEquals(human.passed, false);
  assertEquals(human.needsHumanDecision, true);
  assertEquals(parseVerdict("not json at all", DELIVERABLE, det), null);
});

Deno.test("verifier: independence is measured, not assumed", () => {
  assertEquals(independenceLevel("model:anthropic:h", ["model:gemini:a"]), "different_provider");
  assertEquals(independenceLevel("model:gemini:b", ["model:gemini:a"]), "different_model");
  assertEquals(independenceLevel("model:gemini:a", ["model:gemini:a"]), "same_model");
  assertEquals(independenceLevel(null, []), "none");
  assertEquals(independenceLevel("model:gemini:a", []), "producers_unknown");
});

Deno.test("verifier: contract criteria normalise strings and metric objects", () => {
  assertEquals(contractCriteria(["  list three rules ", { metric: "Accounts reached", operator: "EQUALS", target: 2, unit: "accounts" }]), ["list three rules", "Accounts reached: EQUALS 2 accounts"]);
  assertEquals(contractCriteria(null), []);
});

Deno.test("deliverable: once rectified, the corrected version replaces the rejected draft", () => {
  const tasks = [
    { title: "Research", status: "done", output: JSON.stringify({ deliverable: "draft with errors" }), created_at: "1" },
    { title: "Rectify: corrected final deliverable (round 1)", status: "done", output: JSON.stringify({ deliverable: "corrected v1" }), created_at: "2" },
    { title: "Rectify: corrected final deliverable (round 2)", status: "done", output: JSON.stringify({ llmResult: { deliverable: "x" }, deliverable: "corrected v2" }), created_at: "3" },
  ];
  const d = buildCurrentDeliverable("", tasks);
  assert(d.includes("corrected v2") && !d.includes("draft with errors") && !d.includes("corrected v1"), d);
  assert(buildCurrentDeliverable("", tasks.slice(0, 1)).includes("draft with errors"));
});

Deno.test("grounding: rectification tasks revise recorded evidence and are not new fact-gathering", () => {
  assert(requiresExternalFacts({ title: "Identify distributors in Pune", description: "" }));
  assert(!requiresExternalFacts({ title: "Rectify: corrected final deliverable (round 1)", description: "Identify distributors in Pune" }));
});
