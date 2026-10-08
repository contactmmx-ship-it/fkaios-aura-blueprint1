// OUTPUT-LIMIT CONTINUATION — a response cut off at the output-token limit is
// a checkpoint, not a result. The partial output is handed to the next call
// (whichever resource the router picks, possibly a different model) with an
// instruction to continue exactly where it stopped, never to restart. Shared
// by ai-engine and the production self-test so both exercise the same code.

import type { LLMRequest, LLMResult } from "./llm-router.ts";

export const MAX_CONTINUATIONS = 2;

export function continuationPrompt(originalUserContent: string, partial: string, n: number): string {
  return `${originalUserContent}\n\n[CONTINUATION CHECKPOINT ${n}] Your previous response was cut off at the output-token limit. The partial output so far is below between the markers. Continue EXACTLY from where it stops. Do not repeat anything already written and do not restart.\n<<<PARTIAL_OUTPUT\n${partial}\nPARTIAL_OUTPUT>>>`;
}

const MIN_OVERLAP = 4;
const MAX_CHECKPOINT_TRIM = 200;

/**
 * The checkpoint handed to a continuation: the partial output cut back to its
 * last whitespace, so every seam falls right after a space or newline. Models
 * drop leading whitespace when continuing, which glued words and lines
 * together in production ("branchlocations", "owners.3."); with the seam on
 * whitespace that no longer matters. The cut-off fragment is regenerated.
 */
export function checkpointText(partial: string): string {
  const m = /\s(?=\S*$)/.exec(partial);
  if (!m || partial.length - (m.index + 1) > MAX_CHECKPOINT_TRIM) return partial;
  return partial.slice(0, m.index + 1);
}

/**
 * Joins a continuation onto the checkpoint. If the model repeats the last
 * words anyway, the repeat is merged away: the longest overlap of at least
 * MIN_OVERLAP chars that starts on a word boundary ("networknetwork" seen in
 * production). Otherwise the continuation is appended, so nothing is dropped.
 */
export function stitch(partial: string, next: string): string {
  const tail = partial.slice(-400);
  const head = next.replace(/^\s+/, "");
  for (let k = Math.min(tail.length, head.length); k >= MIN_OVERLAP; k--) {
    const start = tail.length - k;
    const atWordStart = start === 0 || /\s/.test(tail[start - 1]);
    if (atWordStart && tail.endsWith(head.slice(0, k))) return partial + head.slice(k);
  }
  return /\s$/.test(partial) ? partial + head : partial + next;
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
    text = checkpointText(text);
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
