import { quoteFoundInOrder } from "./objective-verifier.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const hay = "1. franchise pitch deck creation (2025-12-15) chatgpt: franchise pitch deck creation. 2. tiers: master arena 800–1200 sq ft costs ₹50–70 l";
Deno.test("verbatim quote passes", () => assert(quoteFoundInOrder(hay, "master arena 800–1200 sq ft"), "verbatim"));
Deno.test("ellipsis-joined real excerpts in order pass", () => assert(quoteFoundInOrder(hay, "franchise pitch deck creation (2025-12-15) ... master arena 800–1200 sq ft"), "in order"));
Deno.test("excerpts out of order fail", () => assert(!quoteFoundInOrder(hay, "master arena 800–1200 sq ft ... franchise pitch deck creation (2025-12-15)"), "order"));
Deno.test("paraphrase fails", () => assert(!quoteFoundInOrder(hay, "the flagship outlet needs fifty lakh"), "paraphrase"));
Deno.test("tiny fragments fail", () => assert(!quoteFoundInOrder(hay, "tiers ... sq"), "tiny"));

import { parseVerdict } from "./objective-verifier.ts";
const verdictJson = (criterion: string, quote: string) => JSON.stringify({ criteria: [{ criterion, met: true, evidence_quote: quote, issue: null }], needs_human_decision: false, human_decision_reason: null, quality: 0.9, issues: [] });
const deliverable = "## Proposed numbers\n- WO-11 opening package priced per opening (Review Association Model)";
const evidence = "[FOUNDER MEMORY]\nWO-11 [Franchise] opening package (₹40,000 per opening, proposed): launch plan, 3 days of training";
Deno.test("evidence criterion may quote the recorded evidence verbatim (brackets ignored)", () => {
  const v = parseVerdict(verdictJson("No claims unsupported by the recorded evidence", "WO-11 Franchise opening package (₹40,000 per opening, proposed): launch plan,"), deliverable, { ok: true, problems: [] }, evidence);
  assert(v && v.criteria[0].met, "evidence quote accepted");
});
Deno.test("other criteria must still quote the deliverable", () => {
  const v = parseVerdict(verdictJson("Contains proposed franchise numbers", "WO-11 Franchise opening package (₹40,000 per opening, proposed): launch plan,"), deliverable, { ok: true, problems: [] }, evidence);
  assert(v && !v.criteria[0].met, "evidence quote not accepted for content criterion");
});
