import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { approxTokens, payloadForPrompt } from "./prompt-budget.ts";

const bigOutput = { capability: "knowledge.search", matches: Array.from({ length: 40 }, (_, i) => ({ title: `chat ${i}`, text: "x".repeat(3000) })) };
const payload = {
  title: "Develop 90-Day Growth Plan", description: "plan", objective_id: "o1",
  prior_completed_tasks: Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, output: bigOutput })),
  rectification: { rejected_deliverable: "d".repeat(12000) },
};

Deno.test("earlier task outputs are not sent twice: the payload keeps only id and title", () => {
  const before = approxTokens(JSON.stringify(payload));
  const after = approxTokens(JSON.stringify(payloadForPrompt(payload)));
  assert(before > 350000, `fixture should mirror run 6 (got ${before})`);
  assert(after < 6000, `payload copy should be small (got ${after})`);
  const p = payloadForPrompt(payload) as Record<string, unknown>;
  const prior = p.prior_completed_tasks as Array<Record<string, unknown>>;
  assertEquals(prior.length, 12);
  assertEquals(prior[0].id, "t0");
  assertEquals(prior[0].title, "Task 0");
});

Deno.test("other fields survive; only very long strings are cut", () => {
  const p = payloadForPrompt({ title: "a", objective_id: "o1", note: "n".repeat(20000) }, 14000) as Record<string, string>;
  assertEquals(p.title, "a");
  assertEquals(p.objective_id, "o1");
  assert(p.note.length < 14100 && p.note.includes("[cut: 6000 more chars]"));
  const r = (payloadForPrompt(payload) as Record<string, Record<string, string>>).rectification;
  assertEquals(r.rejected_deliverable.length, 12000);
});

Deno.test("non-object payloads pass through", () => {
  assertEquals(payloadForPrompt(null), null);
  assertEquals(payloadForPrompt("short"), "short");
});
