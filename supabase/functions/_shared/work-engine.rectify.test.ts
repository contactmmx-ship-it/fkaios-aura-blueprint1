// 29 Oct 2026: rectification re-searches founder memory when the verifier reports missing / not-found items.
import { missingItemsQuery } from "./work-engine.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

Deno.test("missing/not-found feedback becomes a memory re-search query", () => {
  const q = missingItemsQuery(
    ["Section 2 says the Platinum tier fee is 'not found'", "Formatting is fine"],
    ["The brief states the franchise model numbers (fees, equity, tiers)"],
  );
  assert(q.includes("Platinum") && q.includes("franchise model numbers"), q);
  assert(!q.includes("Formatting is fine"), "unrelated issue excluded");
});

Deno.test("purely stylistic feedback triggers no re-search", () => {
  assert(missingItemsQuery(["Use a numbered list for next actions", "Shorten the intro"], ["One page only"]) === "", "no query");
});
