// ROUTED STRUCTURED REASONING — for engines that must emit schema-bound JSON
// (opportunity, evolution and executive-brain engines). The engine states the
// capability it needs (a task class and an output schema); resource selection
// picks the model (policy, health, verified learning), the router fails over
// between resources, the schema is enforced for every provider, and each
// attempt is an evidence row. No engine is tied to one vendor.

import { buildDefaultRouterConfig, callLLMOnResources } from "./llm-router.ts";
import { selectResources } from "./resource-selection.ts";
import { recordLLMAttempts } from "./execution-evidence.ts";
import { workerRef } from "./resource-identity.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface StructuredCallInput {
  engine: string;
  taskClass: "reasoning" | "planning" | "research_synthesis" | "writing";
  system: string;
  user: string;
  toolSchema: { name: string; description?: string; input_schema: unknown };
  maxTokens?: number;
}

export interface StructuredCallResult {
  ok: boolean;
  input: Record<string, unknown> | null;
  resourceRef: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  attempts: Array<{ provider: string; model: string; outcome: string; category: string | null }>;
  failure: string | null;
}

export async function routedStructuredCall(db: Db, input: StructuredCallInput): Promise<StructuredCallResult> {
  const selection = await selectResources(db, input.taskClass);
  const started = new Date();
  const r = await callLLMOnResources({
    systemPrompt: input.system, userContent: input.user, toolSchema: input.toolSchema,
    maxTokens: input.maxTokens ?? 4000, functionName: input.engine, functionClass: "background_agent",
  }, buildDefaultRouterConfig(), selection.resources);
  await recordLLMAttempts(db, { stepKind: "task_execution", taskClass: input.taskClass, workerRef: workerRef(input.engine) }, r.log, selection, null, started);
  const attempts = r.log.attempts.map((a) => ({ provider: a.provider, model: a.model, outcome: a.outcome, category: a.failureCategory }));
  const value = r.toolCall && typeof r.toolCall === "object" ? r.toolCall as Record<string, unknown> : null;
  if (r.status !== "success" || !value) {
    const why = selection.resources.length === 0
      ? `no usable resource for ${input.taskClass}: ${selection.skipped.slice(0, 6).map((s) => `${s.ref} (${s.reason})`).join("; ")}`
      : r.log.failure_reason ?? "no schema-valid answer from any resource";
    return { ok: false, input: null, resourceRef: null, provider: null, model: null, inputTokens: 0, outputTokens: 0, costUsd: 0, attempts, failure: why };
  }
  return {
    ok: true, input: value, resourceRef: r.resource?.ref ?? null, provider: r.log.successful_provider, model: r.log.successful_model,
    inputTokens: r.log.token_usage?.input ?? 0, outputTokens: r.log.token_usage?.output ?? 0, costUsd: r.log.estimated_cost_usd ?? 0, attempts, failure: null,
  };
}
