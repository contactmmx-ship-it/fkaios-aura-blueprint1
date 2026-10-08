/// <reference lib="deno.ns" />
import { callWithContinuation, continuationPrompt } from "./continuation.ts";
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
