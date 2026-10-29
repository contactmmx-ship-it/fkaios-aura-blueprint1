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

Deno.test("paid-research criterion is decided by measurement, not quotes", () => {
  const ok = parseVerdict(verdictJson("Zero paid web research is used", "nonexistent quote text"), deliverable, { ok: true, problems: [] }, evidence, true);
  assert(ok && ok.criteria[0].met, "met when measured none");
  const bad = parseVerdict(verdictJson("Do not use paid web research", "WO-11 opening package priced per opening"), deliverable, { ok: true, problems: [] }, evidence, false);
  assert(bad && !bad.criteria[0].met, "not met when research ran");
});

import { quoteMostlyPresent } from "./objective-verifier.ts";

Deno.test("quote tolerance: title glued to its memory link still verifies", () => {
  const hay = "section 2 (source: chatgpt: chaat masters franchise manual (2025-06-17)) sources: - chatgpt: chaat masters franchise manual (2025-06-17), p.1 — fkaios-memory://67e3136a-09b5-4756-9828-a3c8108d933e";
  const q = "(source: chatgpt: chaat masters franchise manual (2025-06-17); fkaios-memory://67e3136a-09b5-4756-9828-a3c8108d933e)";
  if (!quoteMostlyPresent(hay, q)) throw new Error("should pass");
});

Deno.test("quote tolerance never accepts a changed figure", () => {
  const hay = "platinum tier: ₹10,00,000+ and diamond tier: ₹7,50,000 per franchise partner as proposed";
  if (quoteMostlyPresent(hay, "platinum tier: ₹12,00,000+ and diamond tier: ₹7,50,000 per franchise partner")) throw new Error("changed figure must fail");
  if (!quoteMostlyPresent(hay, "platinum tier: ₹10,00,000+ and diamond tier: ₹7,50,000 per franchise partner")) throw new Error("same figures pass");
});

Deno.test("quote tolerance rejects a link that is not in the text", () => {
  const hay = "chatgpt: chaat masters franchise manual (2025-06-17) franchise model numbers and the tiers";
  if (quoteMostlyPresent(hay, "chatgpt: chaat masters franchise manual (2025-06-17) fkaios-memory://99999999-0000-0000-0000-000000000000 franchise model numbers")) throw new Error("unknown link must fail");
});
