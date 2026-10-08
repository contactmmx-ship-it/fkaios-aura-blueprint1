/// <reference lib="deno.ns" />
import { callWithContinuation, checkpointText, continuationPrompt, stitch } from "./continuation.ts";
import type { LLMRequest, LLMResult } from "./llm-router.ts";

function assert(condition: boolean, message = "assertion failed"): void {
  if (!condition) throw new Error(message);
}

const base: LLMRequest = { systemPrompt: "s", userContent: "write", functionName: "t", functionClass: "background_agent" } as LLMRequest;
function result(content: string, truncated: boolean, status = "success"): LLMResult {
  return { status, content, truncated, log: { token_usage: { input: 10, output: 5 }, attempts: [] } } as unknown as LLMResult;
}

Deno.test("continuation: partial output is carried forward until complete", async () => {
  const seen: string[] = [];
  const parts = [result("one ", true), result("two ", true), result("three END", false)];
  const out = await callWithContinuation(async (req, kind) => { seen.push(kind); if (kind === "continuation") assert(req.userContent.includes("<<<PARTIAL_OUTPUT")); return parts.shift()!; }, base);
  assert(out.text === "one two three END", out.text);
  assert(out.continuations === 2);
  assert(out.inputTokens === 30 && out.outputTokens === 15);
  assert(seen.join(",") === "initial,continuation,continuation");
});

Deno.test("continuation: still truncated after the budget throws (task needs decomposition)", async () => {
  let threw = false;
  try { await callWithContinuation(async () => result("x", true), base, 2); } catch (e) { threw = /still truncated/.test(String(e)); }
  assert(threw);
});

Deno.test("continuation: a failed continuation throws, a failed first call is returned", async () => {
  const first = await callWithContinuation(async () => result("", false, "failed"), base);
  assert(first.last.status === "failed" && first.continuations === 0);
  let threw = false;
  const parts = [result("a", true), result("", false, "failed")];
  try { await callWithContinuation(async () => parts.shift()!, base); } catch (e) { threw = /continuation 1 failed/.test(String(e)); }
  assert(threw);
});

Deno.test("continuation: prompt keeps the original request and the partial output", () => {
  const p = continuationPrompt("ORIGINAL", "PARTIAL", 1);
  assert(p.startsWith("ORIGINAL") && p.includes("PARTIAL") && p.includes("CHECKPOINT 1"));
});

Deno.test("continuation: the checkpoint ends on whitespace so seams cannot glue words", () => {
  assert(checkpointText("open individual branch") === "open individual ");
  assert(checkpointText("training manuals for owners.") === "training manuals for ");
  assert(checkpointText("line one\nline tw") === "line one\nline ");
  assert(checkpointText("owners.\n3") === "owners.\n");
  assert(checkpointText("ends with space ") === "ends with space ");
  const blob = "x".repeat(300);
  assert(checkpointText(`a ${blob}`) === `a ${blob}`); // never discard a long fragment
});

Deno.test("continuation: repeats are merged away, everything else appended", () => {
  // production failures, replayed against checkpoints
  assert(stitch("open individual ", "branch locations") === "open individual branch locations");
  assert(stitch("for incoming business ", "owners.\n3. Capital") === "for incoming business owners.\n3. Capital");
  assert(stitch("as the network ", "network expands.") === "as the network expands.");
  assert(stitch("as the network ", " network expands.") === "as the network expands.");
  // a repeat is only recognised from a word start
  assert(stitch("the artwork ", "work continues") === "the artwork work continues");
  // a repeated last word counts as a repeat; overlaps under 4 chars are not trusted
  assert(stitch("the end ", "end of it") === "the end of it");
  assert(stitch("go to ", "to be") === "go to to be");
  assert(stitch("abc", " def") === "abc def");
});

Deno.test("continuation: a cut-off word is regenerated, not duplicated", async () => {
  const parts = [result("1. The franchise netw", true), result("network grows.\nEND", false)];
  const prompts: string[] = [];
  const out = await callWithContinuation(async (req) => { prompts.push(req.userContent); return parts.shift()!; }, base);
  assert(out.text === "1. The franchise network grows.\nEND", out.text);
  assert(prompts[1].includes("1. The franchise \nPARTIAL_OUTPUT>>>"));
});
