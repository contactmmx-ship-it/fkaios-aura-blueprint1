import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MEMORY_RETRY_MAX_TERMS, memorySearchFailed, runMemorySearch, type MemoryRpc } from "./memory-search.ts";

const timeout = { message: "canceling statement due to statement timeout" };

Deno.test("a timed-out memory search is a failure, not an empty result (GoMax 5b312395, 3 Nov 2026)", async () => {
  const rpc: MemoryRpc = () => Promise.resolve({ data: null, error: timeout });
  const run = await runMemorySearch(rpc, [["gomax", "register", "p08", "dealer", "schemes", "files", "health", "bottlenecks"]], 5);
  assert(memorySearchFailed(run));
  assertEquals(run.sets.length, 0);
  assert(run.failures[0].includes("statement timeout"));
});

Deno.test("a failed term set is retried once with fewer terms", async () => {
  const calls: string[][] = [];
  const rpc: MemoryRpc = (terms) => {
    calls.push(terms);
    return Promise.resolve(terms.length > MEMORY_RETRY_MAX_TERMS ? { data: null, error: timeout } : { data: [{ source_id: "s1", matched_fraction: 1 }], error: null });
  };
  const run = await runMemorySearch(rpc, [["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"]], 5);
  assertEquals(calls.length, 2);
  assertEquals(calls[1].length, MEMORY_RETRY_MAX_TERMS);
  assert(!memorySearchFailed(run));
  assertEquals(run.sets[0].terms.length, MEMORY_RETRY_MAX_TERMS);
  assertEquals(run.sets[0].rows.length, 1);
});

Deno.test("one working term set is enough; a thrown error counts as a failure", async () => {
  const rpc: MemoryRpc = (terms) => terms[0] === "boom" ? Promise.reject(new Error("network")) : Promise.resolve({ data: [{ source_id: "s2" }], error: null });
  const run = await runMemorySearch(rpc, [["boom"], ["gomax"]], 5);
  assert(!memorySearchFailed(run));
  assertEquals(run.failed, 1);
  assertEquals(run.sets.length, 1);
});

Deno.test("a genuine empty result is not a failure", async () => {
  const rpc: MemoryRpc = () => Promise.resolve({ data: [], error: null });
  const run = await runMemorySearch(rpc, [["nothing"], []], 5);
  assertEquals(run.attempted, 1);
  assert(!memorySearchFailed(run));
  assertEquals(run.sets[0].rows.length, 0);
});
