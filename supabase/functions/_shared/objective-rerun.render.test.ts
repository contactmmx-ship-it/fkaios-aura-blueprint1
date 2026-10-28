import { taskWorkProduct } from "./objective-rerun.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
Deno.test("string deliverable stays verbatim and gets named sources", () => {
  const out = taskWorkProduct(JSON.stringify({ deliverable: "# Brief\nMaster Arena ₹50–70 L", sources: [{ title: "ChatGPT: Franchise plan for Chaat (2025-10-10)", url: "fkaios-memory://abc" }], prior_evidence: { x: 1 } }));
  assert(out.startsWith("# Brief\nMaster Arena ₹50–70 L"), "verbatim");
  assert(out.includes("ChatGPT: Franchise plan for Chaat (2025-10-10) — fkaios-memory://abc"), "named source");
  assert(!out.includes("prior_evidence"), "internal key hidden");
});
Deno.test("object report renders as headings and bullets, not JSON", () => {
  const out = taskWorkProduct(JSON.stringify({ llmResult: { report: { section_1_what_was_built_and_when: ["Franchise plan (2025-10-10)"], next_actions: [{ action: "Sign Product C", owner: "Accounts", deadline: "15 Nov" }] } } }));
  assert(out.includes("## What was built and when") && out.includes("- Franchise plan (2025-10-10)"), "section");
  assert(out.includes("- Action: Sign Product C | Owner: Accounts | Deadline: 15 Nov"), "row");
  assert(!out.trim().startsWith("{"), "not raw JSON");
});
Deno.test("plain text output unchanged", () => assert(taskWorkProduct("hello") === "hello", "plain"));

import { buildObjectiveDeliverable } from "./objective-rerun.ts";
Deno.test("information deliverable = final report task only", () => {
  const out = buildObjectiveDeliverable("", [
    { title: "Search memory", status: "done", output: JSON.stringify({ report: "raw search notes" }), created_at: "2026-10-28T10:00:00Z" },
    { title: "Final Compliance Review", status: "done", output: "review notes", created_at: "2026-10-28T10:01:00Z" },
    { title: "Compile and verify the final report", status: "done", output: JSON.stringify({ deliverable: "# One-page brief\n1. Built" }), created_at: "2026-10-28T10:02:00Z" },
  ] as any);
  assert(out.includes("# One-page brief") && !out.includes("review notes") && !out.includes("raw search notes"), "only final report");
});
