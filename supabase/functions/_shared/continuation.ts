// OUTPUT-LIMIT CONTINUATION — a response cut off at the output-token limit is
// a checkpoint, not a result. The partial output is handed to the next call
// (whichever resource the router picks, possibly a different model) with an
// instruction to continue exactly where it stopped, never to restart. Shared
// by ai-engine and the production self-test so both exercise the same code.

import type { LLMRequest, LLMResult } from "./llm-router.ts";

export const MAX_CONTINUATIONS = 2;

export function continuationPrompt(originalUserContent: string, partial: string, n: number): string {
  return `${originalUserContent}\n\n[CONTINUATION CHECKPOINT ${n}] Your previous response was cut off at the output-token limit. The partial output so far is below between the markers. Begin your reply by repeating, exactly, the last few words of the partial output (an anchor), then continue from there. Do not repeat anything earlier and do not restart.\n<<<PARTIAL_OUTPUT\n${partial}\nPARTIAL_OUTPUT>>>`;
}

const MIN_OVERLAP = 8;

/**
 * Joins a continuation onto the partial output. The continuation starts with
 * an anchor repeated from the end of the partial; merging on the longest
 * overlap keeps the seam exact (models drop leading whitespace, which glued
 * words together: "branch" + "locations" seen in production self-test).
 * Without a usable overlap the continuation is appended as is.
 */
export function stitch(partial: string, next: string): string {
  const tail = partial.slice(-400);
  const head = next.replace(/^\s+/, "");
  for (let k = Math.min(tail.length, head.length); k >= MIN_OVERLAP; k--) {
    if (tail.endsWith(head.slice(0, k))) return partial + head.slice(k);
  }
  return partial + next;
}

export interface ContinuedResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  continuations: number;
  last: LLMResult;
}

/**
 * Calls `route` and, while the answer is truncated, routes continuation
 * requests carrying the partial output. Throws when a continuation fails or
 * the output is still truncated after MAX_CONTINUATIONS.
 */
export async function callWithContinuation(
  route: (req: LLMRequest, kind: "initial" | "continuation") => Promise<LLMResult>,
  request: LLMRequest,
  maxContinuations = MAX_CONTINUATIONS,
): Promise<ContinuedResult> {
  let result = await route(request, "initial");
  if (result.status !== "success") return { text: "", inputTokens: 0, outputTokens: 0, continuations: 0, last: result };
  let text = result.content ?? "";
  let inputTokens = result.log.token_usage?.input ?? 0;
  let outputTokens = result.log.token_usage?.output ?? 0;
  let continuations = 0;
  while (result.truncated && !request.toolSchema && continuations < maxContinuations) {
    continuations++;
    const next = await route({ ...request, userContent: continuationPrompt(request.userContent, text, continuations) }, "continuation");
    if (next.status !== "success") throw new Error(`Output was truncated and continuation ${continuations} failed: ${next.log.failure_reason ?? next.status}`);
    text = stitch(text, next.content ?? "");
    inputTokens += next.log.token_usage?.input ?? 0;
    outputTokens += next.log.token_usage?.output ?? 0;
    result = next;
  }
  if (result.truncated && !request.toolSchema) throw new Error(`Output still truncated after ${maxContinuations} continuations (${text.length} chars); task needs decomposition.`);
  return { text, inputTokens, outputTokens, continuations, last: result };
}
