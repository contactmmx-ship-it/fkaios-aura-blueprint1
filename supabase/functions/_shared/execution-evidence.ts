// EXECUTION EVIDENCE — one fkaios_execution_steps row per attempt, with the
// resource identity (model:<provider>:<model>), timing, tokens, cost, failure
// category and any resource switch. Also keeps per-model health on
// model_registry so a quota hit on one model never hides the provider's
// other models. Every write here is non-blocking telemetry: a failed insert is
// logged and never breaks the work it describes.

import type { AttemptRecord, LLMCallLogEntry } from "./llm-router.ts";
import { modelRef } from "./resource-identity.ts";
import type { SelectionDecision } from "./resource-selection.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type StepKind = "task_execution" | "continuation" | "verification" | "rectification" | "evaluation" | "discovery" | "planning";

export interface StepContext {
  objectiveId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  jobId?: string | null;
  agentRunId?: string | null;
  stepKind: StepKind;
  taskClass?: string | null;
  workerRef?: string | null;
  capabilityRef?: string | null;
}

/** How long a model stays deprioritised after each kind of model-scoped failure. */
export const RESOURCE_COOLDOWN_MIN: Record<string, number> = {
  rate_limit: 15,
  model_unavailable: 24 * 60,
  timeout: 5,
  invalid_response: 5,
};

export function stepRowsFromLog(ctx: StepContext, log: LLMCallLogEntry, selection: SelectionDecision | null, outputExcerpt: string | null, startedAt: Date): Record<string, unknown>[] {
  let cursor = startedAt.getTime();
  let previousRef: string | null = null;
  return log.attempts.map((a: AttemptRecord, i: number) => {
    const ref = modelRef(a.provider, a.model);
    const started = new Date(cursor);
    cursor += a.latencyMs ?? 0;
    const row = {
      objective_id: ctx.objectiveId ?? null,
      project_id: ctx.projectId ?? null,
      task_id: ctx.taskId ?? null,
      job_id: ctx.jobId ?? null,
      agent_run_id: ctx.agentRunId ?? null,
      step_kind: ctx.stepKind,
      task_class: ctx.taskClass ?? null,
      resource_ref: ref,
      provider: a.provider,
      model: a.model,
      worker_ref: ctx.workerRef ?? null,
      capability_ref: ctx.capabilityRef ?? null,
      attempt: i + 1, // resource try within this call; job retries are separate rows on the same job_id
      switched_from_ref: previousRef,
      routing_policy_id: selection?.policyId ?? null,
      selection: i === 0 && selection
        ? { policy_version: selection.policyVersion, order: selection.resources.map((r) => r.ref), reasons: selection.reasons, skipped: selection.skipped.slice(0, 20) }
        : {},
      started_at: started.toISOString(),
      finished_at: new Date(cursor).toISOString(),
      duration_ms: a.latencyMs ?? null,
      input_tokens: a.outcome === "success" ? a.inputTokens ?? null : null,
      output_tokens: a.outcome === "success" ? a.outputTokens ?? null : null,
      cost_usd: a.estimatedCostUsd ?? null,
      outcome: a.outcome === "success" ? "completed" : "failed",
      failure_category: a.failureCategory,
      error: a.failureDetail ?? null,
      output_excerpt: a.outcome === "success" && outputExcerpt ? outputExcerpt.slice(0, 2000) : null,
    };
    previousRef = ref;
    return row;
  });
}

export async function recordLLMAttempts(db: Db, ctx: StepContext, log: LLMCallLogEntry, selection: SelectionDecision | null, outputExcerpt: string | null, startedAt: Date): Promise<string[]> {
  const rows = stepRowsFromLog(ctx, log, selection, outputExcerpt, startedAt);
  if (!rows.length) return [];
  try {
    const { data, error } = await db.from("fkaios_execution_steps").insert(rows).select("id");
    if (error) throw new Error(error.message);
    await updateResourceHealth(db, log.attempts);
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  } catch (err) {
    console.error(JSON.stringify({ level: "WARN", message: "execution evidence write failed (non-blocking)", error: err instanceof Error ? err.message : String(err) }));
    return [];
  }
}

/** Per-model health on the resource registry. Provider-wide failures are tracked by the router on provider_health_state. */
export async function updateResourceHealth(db: Db, attempts: AttemptRecord[], now = new Date()): Promise<void> {
  for (const a of attempts) {
    const ref = modelRef(a.provider, a.model);
    try {
      if (a.outcome === "success") {
        await db.from("model_registry").update({ health_status: "available", consecutive_failures: 0, unavailable_until: null, last_success_at: now.toISOString(), updated_at: now.toISOString() }).eq("resource_ref", ref);
        continue;
      }
      const cooldown = a.failureCategory ? RESOURCE_COOLDOWN_MIN[a.failureCategory] : undefined;
      if (!cooldown) continue;
      const { data: row } = await db.from("model_registry").select("consecutive_failures").eq("resource_ref", ref).maybeSingle();
      await db.from("model_registry").update({
        health_status: a.failureCategory === "model_unavailable" ? "unavailable" : "degraded",
        unavailable_until: new Date(now.getTime() + cooldown * 60_000).toISOString(),
        consecutive_failures: ((row?.consecutive_failures as number) ?? 0) + 1,
        last_failure_at: now.toISOString(),
        last_failure_category: a.failureCategory,
        updated_at: now.toISOString(),
      }).eq("resource_ref", ref);
    } catch { /* telemetry only */ }
  }
}

/** Marks the steps that produced a piece of work with its verification verdict (the only path by which outcomes become learning data). */
export async function markStepsVerified(db: Db, filter: { taskIds?: string[]; jobIds?: string[]; stepIds?: string[] }, status: "verified" | "rejected" | "partially_verified" | "superseded", evidenceId: string | null, qualityScore: number | null): Promise<number> {
  let q = db.from("fkaios_execution_steps").update({ verification_status: status, verification_evidence_id: evidenceId, quality_score: qualityScore })
    .eq("outcome", "completed").eq("verification_status", "unverified");
  if (filter.stepIds?.length) q = q.in("id", filter.stepIds);
  else if (filter.jobIds?.length) q = q.in("job_id", filter.jobIds);
  else if (filter.taskIds?.length) q = q.in("task_id", filter.taskIds);
  else return 0;
  const { data, error } = await q.select("id");
  if (error) return 0;
  return (data ?? []).length;
}
