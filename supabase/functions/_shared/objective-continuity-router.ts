/**
 * First provider adapter for AI Continuity: reuse FKAIOS's existing shared
 * LLM router rather than creating another set of provider credentials/adapters.
 *
 * The router may fail over across configured providers according to its existing
 * policy. This resumes from the saved packet, but does not access private
 * ChatGPT/Claude/Gemini UI histories or claim a task is complete.
 */
import { buildDefaultRouterConfig, callLLM } from "./llm-router.ts";
import { dispatchSavedContinuityHandoff } from "./objective-continuity.ts";

type Db = Parameters<typeof dispatchSavedContinuityHandoff>[0];

/** Resume one saved task through FKAIOS's configured provider router. */
export async function resumeSavedContinuityThroughFKAIOSRouter(
  db: Db,
  objectiveId: string,
  options: { functionClass?: "founder_intelligence" | "business_agent" | "background_agent" | "customer_agent"; maxTokens?: number } = {},
) {
  const config = buildDefaultRouterConfig();
  return await dispatchSavedContinuityHandoff(
    db,
    objectiveId,
    (request) => callLLM(request, config),
    options,
  );
}
