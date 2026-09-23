import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reason } from "./founder-brain.ts";
import { planObjective } from "./executive-planner.ts";
import { allocateProjectWork, returnCompletedWork } from "./work-engine.ts";

type ObjectiveLoopResult = {
  objectiveId: string;
  action:
    | "continue_execution"
    | "replan"
    | "completed"
    | "blocked"
    | "failed"
    | "no_action";
  projectId?: string | null;
  tasksCreated?: number;
  summary: string;
};

type ObjectiveEvaluation = {
  achieved: boolean;
  blocked: boolean;
  failed: boolean;
  reason: string;
  next_action: string;
  // Task #24 positive-verification gate: set only when achieved=true was
  // downgraded because no deterministic evidence existed to confirm it —
  // distinguishes "we checked and it's not done" from "we had nothing to
  // check against". Optional so no existing consumer of this type breaks.
  verificationUnavailable?: boolean;
};

const MAX_REPLAN_ATTEMPTS = 5;

function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// ROBUST JSON EXTRACTION (reconciliation fix): reason() always returns an
// LLMResult object ({text, inputTokens, outputTokens, model, provider}),
// never a bare string — the original objective-loop draft's
// `typeof response === "string"` check was therefore always false, and
// casting the LLMResult wrapper itself as ObjectiveEvaluation meant
// achieved/blocked/failed read as undefined -> always false, so no
// objective could ever be marked completed/blocked/failed by this
// function; every idle objective would silently replan forever. Fixed by
// parsing response.text, with the same progressively-looser JSON
// extraction (raw -> stripped fences -> first {...} substring) already
// used for strategy parsing in founder-brain.ts's simulateStrategies() —
// same tolerance, applied to an object shape instead of an array.
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(),
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* try the next candidate */ }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* fall through to null below */ }
  }

  return null;
}

// TASK #24 — DETERMINISTIC VERIFICATION: work_engine_task tasks whose
// output already contains a companyOsDispatch record (written by
// returnCompletedWork() in work-engine.ts once Task #23 wired real
// capability dispatch through) carry a REAL, measured downstream-execution
// status — not an LLM's opinion. A capability dispatch that returned
// status!=="success" is a genuine, observed failure (a real HTTP 401, an
// unverified/unknown capability, etc.), confirmed live during Task #23's
// own verification (knowledge.search's companyOsDispatch.status:"error").
// Extracted here purely by reading the existing orchestration_tasks.output
// field — no schema change, no new table — so evaluateObjective() can be
// gated by measured fact instead of trusting the LLM's own achieved
// judgment to notice a failed dispatch on its own.
interface DeterministicEvidence {
  taskId: string;
  capability: string;
  dispatchStatus: string;
  verified: boolean;
}

function extractDeterministicEvidence(
  tasks: Record<string, unknown>[],
): DeterministicEvidence[] {
  const evidence: DeterministicEvidence[] = [];
  for (const task of tasks) {
    const raw = task.output;
    if (typeof raw !== "string" || !raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const dispatch = (parsed as Record<string, unknown>).companyOsDispatch;
    if (
      dispatch && typeof dispatch === "object" &&
      typeof (dispatch as Record<string, unknown>).status === "string"
    ) {
      const status = (dispatch as Record<string, unknown>).status as string;
      evidence.push({
        taskId: String(task.id ?? "unknown"),
        capability: String(
          (dispatch as Record<string, unknown>).capability ?? "unknown",
        ),
        dispatchStatus: status,
        verified: status === "success",
      });
    }
  }
  return evidence;
}

async function evaluateObjective(
  objective: Record<string, unknown>,
  projects: Record<string, unknown>[],
  tasks: Record<string, unknown>[],
  correlationId?: string,
): Promise<ObjectiveEvaluation> {
  const deterministicEvidence = extractDeterministicEvidence(tasks);
  const failedDispatches = deterministicEvidence.filter((e) => !e.verified);

  const prompt = `
You are the Objective Evaluator for FKAIOS.

Your job is NOT to judge whether the tasks merely finished.
Your job is to determine whether the ORIGINAL BUSINESS OBJECTIVE has actually been achieved.

Original objective:
${String(objective.raw_request ?? "")}

Current projects:
${JSON.stringify(projects, null, 2)}

Current task execution records:
${JSON.stringify(tasks, null, 2)}

DETERMINISTIC EXECUTION EVIDENCE (measured fact — real downstream capability
dispatch results, extracted directly from task output, not anyone's
interpretation):
${
    deterministicEvidence.length > 0
      ? JSON.stringify(deterministicEvidence, null, 2)
      : "None available for this objective's tasks."
  }

Evaluate using only the evidence supplied above.

Rules:
1. completed tasks do NOT automatically mean the objective is achieved.
2. If evidence shows the business objective is achieved, return achieved=true.
3. If work is still required and another executable cycle should happen, return achieved=false, blocked=false, failed=false.
4. If execution cannot continue without a human decision/approval, return blocked=true.
5. If the objective cannot reasonably be completed because of a terminal failure, return failed=true.
6. Never invent business facts.
7. If evidence is insufficient, prefer achieved=false and blocked=false.
8. If the deterministic execution evidence above shows ANY failed capability dispatch, you MUST NOT return achieved=true — real downstream execution has not succeeded, whatever a task's own narrative claims.
9. Return ONLY valid JSON.

Schema:
{
  "achieved": boolean,
  "blocked": boolean,
  "failed": boolean,
  "reason": string,
  "next_action": string
}
`;

  const response = await reason(
    "You are the FKAIOS Objective Evaluator. Evaluate whether the original business objective has actually been achieved using only the supplied execution evidence.",
    prompt,
    800,
    correlationId,
  );

  if (!response || typeof response.text !== "string" || response.text.trim().length === 0) {
    return {
      achieved: false,
      blocked: false,
      failed: false,
      reason: "Objective evaluation returned no response.",
      next_action: "Continue execution and evaluate again.",
    };
  }

  const parsed = extractJsonObject(response.text);

  if (!parsed) {
    return {
      achieved: false,
      blocked: false,
      failed: false,
      reason: "Objective evaluation returned invalid JSON.",
      next_action: "Retry evaluation on the next cycle.",
    };
  }

  const evaluation: ObjectiveEvaluation = {
    achieved: parsed.achieved === true,
    blocked: parsed.blocked === true,
    failed: parsed.failed === true,
    reason: String(parsed.reason ?? ""),
    next_action: String(parsed.next_action ?? ""),
  };

  // VERIFICATION GATE (not merely a prompt instruction — Task #22 already
  // showed a prompt-only instruction is not reliably followed): an LLM
  // achieved=true is NEVER sufficient by itself. Three cases:
  //   1. No deterministic evidence at all for this objective's tasks -> an
  //      empty evidence set is NOT proof of success. Reported explicitly as
  //      verificationUnavailable rather than silently trusting the LLM.
  //   2. Evidence exists and shows a real failure -> overridden (this is
  //      exactly the original Task #24 safeguard, unchanged in behavior).
  //   3. Evidence exists and none of it is a failure -> since `verified` is
  //      computed directly from company-os.ts's closed status enum
  //      (verified = status==="success", no other value possible), zero
  //      failures among non-empty evidence means every item is a genuine,
  //      independently-confirmed success, not merely "no failure noticed".
  //      achieved stands.
  // blocked/failed/replan/continuation branches in runObjectiveLoop() are
  // untouched — they only ever see the returned achieved/blocked/failed
  // booleans, exactly as before.
  if (evaluation.achieved) {
    if (deterministicEvidence.length === 0) {
      return {
        achieved: false,
        blocked: false,
        failed: false,
        verificationUnavailable: true,
        reason: `verification_unavailable: evaluator returned achieved=true, but no deterministic execution evidence exists for this objective's tasks to independently confirm it against. Evaluator's own reasoning: ${evaluation.reason || "(none given)"}`,
        next_action: "No deterministic verifier exists yet for this objective's task type — escalate for human review or extend evidence coverage before re-evaluating.",
      };
    }
    if (failedDispatches.length > 0) {
      return {
        achieved: false,
        blocked: false,
        failed: false,
        reason: `Overridden by deterministic evidence: evaluator returned achieved=true, but ${failedDispatches.length} real capability dispatch(es) failed (${
          failedDispatches.map((e) => `${e.capability}:${e.dispatchStatus}`).join(", ")
        }). Real downstream execution has not succeeded.`,
        next_action: "Diagnose and retry the failed capability dispatch(es) before re-evaluating.",
      };
    }
    // deterministicEvidence.length > 0 && failedDispatches.length === 0.
  }

  return evaluation;
}

async function loadObjectiveState(
  supabase: ReturnType<typeof createClient>,
  objectiveId: string,
) {
  const { data: projects, error: projectError } = await supabase
    .from("orchestration_projects")
    .select("*")
    .like("request", `[objective:${objectiveId}]%`)
    .order("created_at", { ascending: false });

  if (projectError) {
    throw new Error(`Failed loading objective projects: ${projectError.message}`);
  }

  const projectIds = (projects ?? [])
    .map((project) => project.id)
    .filter(Boolean);

  let tasks: Record<string, unknown>[] = [];

  if (projectIds.length > 0) {
    const { data: taskRows, error: taskError } = await supabase
      .from("orchestration_tasks")
      .select("*")
      .in("project_id", projectIds);

    if (taskError) {
      throw new Error(`Failed loading objective tasks: ${taskError.message}`);
    }

    tasks = taskRows ?? [];
  }

  return {
    projects: projects ?? [],
    tasks,
  };
}

async function markObjective(
  supabase: ReturnType<typeof createClient>,
  objectiveId: string,
  status: "completed" | "failed" | "awaiting_approval",
  summary: string,
) {
  const { error } = await supabase
    .from("orchestrator_requests")
    .update({
      status,
      result_summary: summary.slice(0, 5000),
      action_taken: "objective_loop",
    })
    .eq("id", objectiveId);

  if (error) {
    throw new Error(`Failed updating objective ${objectiveId}: ${error.message}`);
  }
}

async function createContinuationProject(
  objective: Record<string, unknown>,
  correlationId?: string,
) {
  const plan = await planObjective(
    {
      id: String(objective.id),
      raw_request: String(objective.raw_request ?? ""),
      department_code: objective.department_code
        ? String(objective.department_code)
        : null,
      status: String(objective.status ?? "processing"),
    },
    correlationId,
  );

  if (!plan.projectId) {
    return {
      projectId: null,
      tasksCreated: 0,
      error: plan.error ?? "Planner did not create a continuation project.",
    };
  }

  await allocateProjectWork(plan.projectId);

  return {
    projectId: plan.projectId,
    tasksCreated: plan.tasksCreated,
  };
}

export async function runObjectiveLoop(
  correlationId?: string,
): Promise<ObjectiveLoopResult[]> {
  const supabase = getSupabaseAdmin();

  const { data: objectives, error } = await supabase
    .from("orchestrator_requests")
    .select("*")
    .eq("requested_by", "founder-brain")
    .eq("status", "processing")
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    throw new Error(`Failed loading active objectives: ${error.message}`);
  }

  const results: ObjectiveLoopResult[] = [];

  for (const objective of objectives ?? []) {
    try {
      const state = await loadObjectiveState(
        supabase,
        String(objective.id),
      );

      const activeTasks = state.tasks.filter((task) =>
        ["pending", "assigned", "running", "working"].includes(
          String(task.status ?? ""),
        )
      );

      /*
       * If work is still executing, do not create duplicate projects.
       */
      if (activeTasks.length > 0) {
        results.push({
          objectiveId: String(objective.id),
          action: "continue_execution",
          projectId: state.projects[0]?.id
            ? String(state.projects[0].id)
            : null,
          summary: `${activeTasks.length} task(s) are still active.`,
        });
        continue;
      }

      /*
       * No active work remains.
       * Now evaluate the ORIGINAL OBJECTIVE rather than merely
       * checking whether tasks completed.
       */
      const evaluation = await evaluateObjective(
        objective,
        state.projects,
        state.tasks,
        correlationId,
      );

      if (evaluation.achieved) {
        await markObjective(
          supabase,
          String(objective.id),
          "completed",
          evaluation.reason || "Objective achieved.",
        );

        results.push({
          objectiveId: String(objective.id),
          action: "completed",
          projectId: state.projects[0]?.id
            ? String(state.projects[0].id)
            : null,
          summary: evaluation.reason || "Objective achieved.",
        });

        continue;
      }

      if (evaluation.blocked) {
        await markObjective(
          supabase,
          String(objective.id),
          "awaiting_approval",
          evaluation.reason || evaluation.next_action,
        );

        results.push({
          objectiveId: String(objective.id),
          action: "blocked",
          projectId: state.projects[0]?.id
            ? String(state.projects[0].id)
            : null,
          summary: evaluation.reason || "Human approval is required.",
        });

        continue;
      }

      if (evaluation.failed) {
        await markObjective(
          supabase,
          String(objective.id),
          "failed",
          evaluation.reason || "Objective reached a terminal failure.",
        );

        results.push({
          objectiveId: String(objective.id),
          action: "failed",
          projectId: state.projects[0]?.id
            ? String(state.projects[0].id)
            : null,
          summary: evaluation.reason || "Objective failed.",
        });

        continue;
      }

      /*
       * Objective is not achieved and execution is no longer active.
       * Re-enter the planner and create the next executable cycle —
       * unless it already has, too many times. planObjective() always
       * INSERTs a new orchestration_projects row (never updates one), so
       * state.projects.length is exactly the number of planning passes
       * this objective has already been through — a real, already-queried
       * signal, not a new counter/column. Without this cap, an objective
       * whose evaluation never reaches achieved/blocked/failed would
       * replan forever, once per tick, with no backoff — a genuine
       * unbounded-cost bug (Section 22: "avoid infinite retry loops").
       * Escalating to awaiting_approval mirrors how every other genuine
       * blocker in this codebase is surfaced — a stuck objective is a
       * real one, not silently dropped.
       */
      if (state.projects.length >= MAX_REPLAN_ATTEMPTS) {
        await markObjective(
          supabase,
          String(objective.id),
          "awaiting_approval",
          `Objective replanned ${state.projects.length} times without reaching achieved/blocked/failed. Last evaluator reason: ${evaluation.reason || evaluation.next_action || "none given"}.`,
        );
        results.push({
          objectiveId: String(objective.id),
          action: "blocked",
          projectId: state.projects[0]?.id ? String(state.projects[0].id) : null,
          summary: `Escalated after ${state.projects.length} replan attempts without convergence — needs human review.`,
        });
        continue;
      }

      const continuation = await createContinuationProject(
        objective,
        correlationId,
      );

      if (!continuation.projectId) {
        results.push({
          objectiveId: String(objective.id),
          action: "no_action",
          summary: continuation.error ??
            "Objective requires continuation but planning failed.",
        });
        continue;
      }

      results.push({
        objectiveId: String(objective.id),
        action: "replan",
        projectId: continuation.projectId,
        tasksCreated: continuation.tasksCreated,
        summary: evaluation.reason ||
          "Objective remains incomplete; continuation work created.",
      });
    } catch (objectiveError) {
      const message = objectiveError instanceof Error
        ? objectiveError.message
        : String(objectiveError);

      results.push({
        objectiveId: String(objective.id),
        action: "no_action",
        summary: `Objective loop error: ${message}`,
      });
    }
  }

  /*
   * Return completed work to the Company OS after processing the loop.
   * This keeps the existing execution/persistence path intact.
   */
  await returnCompletedWork();

  return results;
}
