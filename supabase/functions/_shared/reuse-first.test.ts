import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brandsIn, classifyMemoryHits, githubQueries, rankRadar, reuseSummary, searchTerms } from "./reuse-first.ts";

const RUN6 = "Objective: Acme growth plan — reach ₹50 lakh+ monthly sales within 90 days. Use only Acme information in Founder Memory (register P08, dealer schemes, P&L files, chats). Deliver: receivables recovery plan, dealer plan, sales team targets, territories.";

Deno.test("search terms drop brand names, numbers and filler (run 6 shape)", () => {
  const t = searchTerms(RUN6, ["Acme"]);
  assertEquals(t.includes("acme"), false);
  assertEquals(t.some((w) => /\d/.test(w)), false);
  for (const w of ["growth", "plan", "sales", "dealer"]) assert(t.includes(w), `missing ${w}: ${t.join(",")}`);
  assert(t.length <= 6);
});

Deno.test("GitHub queries are short keyword searches, never the raw sentence", () => {
  const q = githubQueries(searchTerms(RUN6, ["Acme"]), "information");
  assert(q.length >= 1 && q.length <= 2);
  for (const s of q) assert(s.split(" ").length <= 4 && !/objective|lakh|₹/.test(s), s);
  assertEquals(githubQueries([], "information"), []);
});

Deno.test("brands are detected as whole words", () => {
  assertEquals(brandsIn("Use only Acme data", ["Acme", "Beta Paints", "Ace"]), ["Acme"]);
  assertEquals(brandsIn("Mr. Chick'n franchise plan", ["Mr. Chick'n"]), ["Mr. Chick'n"]);
});

Deno.test("other brands' past work is method only; same brand may supply data", () => {
  const hits = classifyMemoryHits([
    { source_id: "1", title: "Acme dealer scheme", brand: "Acme", score: 1 },
    { source_id: "2", title: "Beta Paints dealer plan", brand: "Beta Paints", score: 0.9 },
    { source_id: "3", title: "Generic sales SOP", brand: null, score: 0.5 },
  ], ["Acme"]);
  assertEquals(hits.map((h) => h.use), ["data_and_method", "method_only", "check_brand"]);
  assert(reuseSummary(hits, [], []).includes("1 same brand"));
});

Deno.test("Radar candidates are ranked by matched terms", () => {
  const r = rankRadar([
    { name: "dealer-crm", url: null, kind: "repository", license: "MIT", description: "Dealer sales pipeline" },
    { name: "image-model", url: null, kind: "model", license: null, description: "text to image" },
  ], ["dealer", "sales", "growth"]);
  assertEquals(r.length, 1);
  assertEquals(r[0].name, "dealer-crm");
  assertEquals(r[0].match, 2);
});
