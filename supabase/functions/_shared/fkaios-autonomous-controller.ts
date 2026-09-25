// ============================================================================
// FKAIOS AUTONOMOUS CONTROLLER — master spec requirement #49
// ============================================================================
// Closes the loop the acceptance matrix flagged as the central remaining
// gap: "there is no cron/heartbeat that autonomously re-invokes the
// controller between human messages." Wired into founder-brain-tick's
// existing 15-minute cron (not a new, parallel scheduling mechanism — see
// that file's own Promise.allSettled block, which this extends).
//
// SCOPE, STATED HONESTLY: this closes the allocate → dispatch → execute →
// verify loop for `kind='ai_model'` capabilities ONLY (fkaios-llm:anthropic/
// gemini/openai — routed through the existing llm-router.ts, which already
// does real cross-provider health/cost-aware fallback; reused here, not
// rebuilt). `kind='coding_worker'` capabilities (Claude Code sessions) have
// no HTTP-invocable execution path from an edge function — there is no API
// this cron tick can call to "start a Claude Code session and hand it a
// task." That is a real architectural boundary, not an oversight: those
// allocations still require a human or an explicitly-started worker session
// to pick up the work and call fkaios_complete_task itself, exactly as this
// build's own GoMax proof did. Do not read the presence of this file as
// "FKAIOS can now autonomously run coding work" — it cannot, and this file
// does not claim to change that.
//
// Two halves, each best-effort / independently caught (mirrors
// escalateBlocked/returnCompletedWork's existing pattern):
//
//   autoAllocateReadyTasks() — a 'pending' task with every dependency
//   'done' (or none) and no existing allocation needs required_capabilities
//   declared before fkaios_allocate_task will touch it (that function
//   deliberately refuses to guess — see 20260924055000_fkaios_task_
//   allocation.sql). This asks reason() to choose ONLY from the closed set
//   of capability tags actually present in capability_registry right now —
//   bounded classification against real registered vocabulary, the same
//   pattern executive-planner.ts's department routing already uses, never
//   free-text invention. An empty/unparseable answer allocates nothing —
//   it is never treated as a guess.
//
//   autoDispatchAiModelWork() — an 'allocated' row whose capability_name
//   resolves to a kind='ai_model' registry row that is currently
//   available/degraded gets dispatched (fkaios_dispatch_task), the
//   resulting worker instruction is put to that same LLM via reason(), and
//   its structured JSON reply is fed to fkaios_complete_task exactly as a
//   human-run worker session would. fkaios_complete_task's own verification
//   rules (recognized status + non-empty evidence) apply unchanged, so this
//   cannot rubber-stamp a completion the LLM didn't actually produce
//   content for — an LLM reply that fails to parse, or that has no
//   evidence, is recorded as verification_failed, not silently retried
//   forever (retried only on the next tick, capped at MAX_PER_TICK).
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { reason } from "./founder-brain.ts";
import { buildNoDataSourceResult, checkWorkerGrounding } from "./fact-grounding.ts";

function getClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key);
}

const MAX_PER_TICK = 5;

export interface AutoAllocateSummary {
  attempted: number;
  allocated: number;
  noCandidate: number;
  errors: number;
}

export async function autoAllocateReadyTasks(): Promise<AutoAllocateSummary> {
  const client = getClient();
  const summary: AutoAllocateSummary = { attempted: 0, allocated: 0, noCandidate: 0, errors: 0 };

  const { data: registryRows } = await client
    .from("capability_registry")
    .select("capabilities")
    .in("availability", ["available", "degraded"]);
  const vocabulary = Array.from(new Set((registryRows ?? []).flatMap((r: { capabilities: string[] | null }) => r.capabilities ?? [])));
  if (vocabulary.length === 0) return summary; // nothing genuinely available right now — nothing honest to classify against

  // Only tasks FKAIOS itself planned (project request tagged
  // "[objective:<id>]" by planObjective). Older pipelines' pending tasks and
  // "[test:...]" fixtures live in the same table; auto-executing those would
  // hijack another system's work and spend the LLM quota objectives need.
  const { data: objectiveProjects } = await client
    .from("orchestration_projects")
    .select("id")
    .like("request", "[objective:%");
  const objectiveProjectIds = (objectiveProjects ?? []).map((p: { id: string }) => p.id);
  if (objectiveProjectIds.length === 0) return summary;

  const { data: candidateTasks } = await client
    .from("orchestration_tasks")
    .select("id, title, description, depends_on_task_ids")
    .eq("status", "pending")
    .in("project_id", objectiveProjectIds)
    .limit(50);
  if (!candidateTasks || candidateTasks.length === 0) return summary;

  const { data: existingAllocs } = await client.from("orchestration_task_allocations").select("task_id");
  const alreadyAllocated = new Set((existingAllocs ?? []).map((a: { task_id: string }) => a.task_id));

  let processed = 0;
  for (const t of candidateTasks) {
    if (processed >= MAX_PER_TICK) break;
    if (alreadyAllocated.has(t.id)) continue;

    const deps: string[] = t.depends_on_task_ids ?? [];
    if (deps.length > 0) {
      const { data: depRows } = await client.from("orchestration_tasks").select("status").in("id", deps);
      const allDone = (depRows ?? []).length === deps.length && (depRows ?? []).every((d: { status: string }) => d.status === "done");
      if (!allDone) continue; // not actually ready yet — a real unmet dependency, not skipped arbitrarily
    }

    processed++;
    summary.attempted++;
    try {
      const classification = await reason(
        "You are FKAIOS's capability classifier. Choose ONLY from the exact list of registered capability tags below — never invent a tag that is not listed. " +
          "Reply with ONLY a JSON array of the 1-3 tags this task genuinely requires. If nothing in the list genuinely fits, reply with exactly []. " +
          `Registered tags: ${JSON.stringify(vocabulary)}`,
        `Task: ${t.title}\n\nDescription: ${(t.description ?? "").slice(0, 1000)}`,
        200,
        `auto-classify-${String(t.id).slice(0, 8)}`,
      );
      let tags: string[] = [];
      try {
        const parsed = JSON.parse((classification.text ?? "").trim());
        if (Array.isArray(parsed)) tags = parsed.filter((x): x is string => typeof x === "string" && vocabulary.includes(x));
      } catch { /* unparseable reply — tags stays empty, never guessed */ }

      if (tags.length === 0) {
        // Persist the outcome so this task is not re-classified (another
        // LLM call) on every 15-minute tick; it surfaces as a capability gap
        // exactly like fkaios_allocate_task's own no_candidate rows.
        await client.from("orchestration_task_allocations").insert({
          task_id: t.id,
          required_capabilities: [],
          status: "no_candidate",
          reason: "autoAllocateReadyTasks: classifier found no registered capability tag that fits this task",
        });
        summary.noCandidate++;
        continue;
      }

      const { data: allocResult, error: allocError } = await client.rpc("fkaios_allocate_task", {
        p_task_id: t.id,
        required_capabilities: tags,
        p_actual_executor: null,
      });
      if (allocError) { summary.errors++; continue; }
      if (allocResult?.status === "allocated") summary.allocated++; else summary.noCandidate++;
    } catch {
      summary.errors++;
    }
  }
  return summary;
}

export interface AutoDispatchSummary {
  attempted: number;
  completed: number;
  verificationFailed: number;
  errors: number;
}

export async function autoDispatchAiModelWork(): Promise<AutoDispatchSummary> {
  const client = getClient();
  const summary: AutoDispatchSummary = { attempted: 0, completed: 0, verificationFailed: 0, errors: 0 };

  const { data: aiModelNames } = await client
    .from("capability_registry")
    .select("name")
    .eq("kind", "ai_model")
    .in("availability", ["available", "degraded"]);
  const eligibleCapabilityNames = new Set((aiModelNames ?? []).map((r: { name: string }) => r.name));
  if (eligibleCapabilityNames.size === 0) return summary; // no ai_model capability is genuinely available right now

  const { data: allocations } = await client
    .from("orchestration_task_allocations")
    .select("id, capability_name")
    .eq("status", "allocated")
    .limit(50);
  if (!allocations || allocations.length === 0) return summary;

  const workable = allocations.filter((a: { capability_name: string | null }) => a.capability_name && eligibleCapabilityNames.has(a.capability_name));

  let processed = 0;
  for (const a of workable) {
    if (processed >= MAX_PER_TICK) break;
    processed++;
    summary.attempted++;
    try {
      const { data: instruction, error: dispatchError } = await client.rpc("fkaios_dispatch_task", { p_allocation_id: a.id });
      if (dispatchError || !instruction) { summary.errors++; continue; }

      // Same structural rule the work-engine/ai-engine path already enforces
      // (fact-grounding.ts, added after the 2026-09-23 invented-distributors
      // incident): an ai_model worker has no research/web capability here,
      // so a task that needs real-world facts cannot be completed from its
      // answer. Checked before the LLM call (no quota spent on an answer
      // that would be discarded) and again on the reply (the worker may
      // itself report no_data_source). Only the explanation is stored;
      // fkaios_complete_task then records verification_failed.
      const task = (instruction as { task?: { title?: unknown; description?: unknown } }).task ?? {};
      const preGrounding = checkWorkerGrounding(task, {});
      if (!preGrounding.ok) {
        const { error: completeError } = await client.rpc("fkaios_complete_task", {
          p_allocation_id: a.id,
          p_result: { ...buildNoDataSourceResult(preGrounding.reason), evidence: [] },
        });
        if (completeError) summary.errors++; else summary.verificationFailed++;
        continue;
      }

      const workerReply = await reason(
        "You are an FKAIOS worker executing one assigned task end-to-end. You have been given the full objective, milestone, task, prior work already done in this project, and relevant Brain context as JSON below. " +
          "Produce the actual work product yourself (analysis, content, plan, decision — whatever the task genuinely calls for); do not describe what you WOULD do. " +
          "Reply with ONLY a JSON object: {\"status\": \"completed\"|\"partial_success\"|\"blocked\", \"summary\": string, \"evidence\": [string, ...], \"next_action\": string}. " +
          "\"evidence\" must contain the actual produced content/findings, not a claim that work happened — an empty evidence array can never be verified. " +
          "Use status=\"blocked\" ONLY if this genuinely requires a human action (e.g. an external account, a payment, a real-world confirmation) that no AI call can perform — name the exact action in next_action.",
        JSON.stringify(instruction).slice(0, 12000),
        2000,
        `auto-dispatch-${String(a.id).slice(0, 8)}`,
      );

      let result: Record<string, unknown>;
      try {
        const parsed = JSON.parse((workerReply.text ?? "").trim());
        result = (parsed && typeof parsed === "object") ? parsed as Record<string, unknown> : { status: "failed_to_parse", evidence: [] };
      } catch {
        // The raw reply is preserved as evidence of what actually happened,
        // rather than discarded — fkaios_complete_task will correctly mark
        // this verification_failed (no valid status, evidence is the raw
        // text itself, not a completion claim).
        result = { status: "failed_to_parse", evidence: [(workerReply.text ?? "").slice(0, 2000)], next_action: "worker reply was not valid JSON — needs a human or a retry" };
      }

      const grounding = checkWorkerGrounding(task, result);
      if (!grounding.ok) result = { ...buildNoDataSourceResult(grounding.reason), evidence: [] };

      const { data: completion, error: completeError } = await client.rpc("fkaios_complete_task", { p_allocation_id: a.id, p_result: result });
      if (completeError) { summary.errors++; continue; }
      if (completion?.verification === "passed") summary.completed++; else summary.verificationFailed++;
    } catch {
      summary.errors++;
    }
  }
  return summary;
}
