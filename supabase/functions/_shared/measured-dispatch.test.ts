import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { alreadyMeasuredDispatch, compactDispatchForStorage, summarizePriorEvidence } from "./fact-grounding.ts";

Deno.test("a knowledge.search ai-engine already ran is stored as evidence, not re-run (GoMax 13f48641, 3 Nov 2026)", () => {
  const CITED = "c5b18836-bb44-4a4f-b2b3-47dfc5d306d8";
  const matches = Array.from({ length: 30 }, (_, i) => ({
    id: null, chunk_id: null, similarity: 0.99 - i * 0.005, chunk_text: `[Register: P${i}] text`, source: "founder_memory",
    document_id: i === 25 ? CITED : `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
  }));
  const workerResult = { status: "success", capability: "knowledge.search", payload: { query: "GoMax" }, capability_result: { query: "GoMax", matches } };
  const measured = alreadyMeasuredDispatch(workerResult);
  assert(measured !== null, "knowledge.search with a measured result is not re-dispatched");
  assertEquals(measured!.data, workerResult.capability_result);
  const stored = compactDispatchForStorage(measured);
  const prior = [{ id: "t1", title: "Sales Team Execution Framework", status: "done", output: { llmResult: workerResult, companyOsDispatch: stored } }];
  const summary = summarizePriorEvidence(prior);
  assert(summary.sources.some((s) => s.url === `fkaios-memory://${CITED}`), "the 26th match is citable by the next task");
});

Deno.test("alreadyMeasuredDispatch: no measured result means dispatch as before", () => {
  assertEquals(alreadyMeasuredDispatch({ capability: "knowledge.search", payload: { query: "x" } }), null);
  assertEquals(alreadyMeasuredDispatch({ capability: "knowledge.search", capability_result: { error: "x" } }), null);
  assertEquals(alreadyMeasuredDispatch({ capability: "whatsapp.send", capability_result: {} }), null);
  assertEquals(alreadyMeasuredDispatch(null), null);
  assertEquals(alreadyMeasuredDispatch({ capability: "research.run", capability_result: { queries: [] }, capability_attempts: 2 })?.attempts, 2);
  assertEquals(alreadyMeasuredDispatch({ capability: "product.verify", capability_result: { ok: true } })?.status, "success");
});
