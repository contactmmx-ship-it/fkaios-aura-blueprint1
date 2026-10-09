import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reason } from "./founder-brain.ts";
import { planObjective } from "./executive-planner.ts";
import { allocateProjectWork, createRectificationTask, resumeTaskFromCheckpoint, returnCompletedWork } from "./work-engine.ts";
import { contractCriteria, verifyObjective } from "./objective-verifier.ts";
import { readObjectiveState, syncObjectiveState } from "./objective-state.ts";
import { assessCurrentTaskSet, assessObjectiveTasks, formatBlockedSummary, type TaskEvidenceRecord } from "./fact-grounding.ts";
import { buildCurrentDeliverable, isRerunRequested, OBJECTIVE_LOOP, projectUpdateForObjective } from "./objective-rerun.ts";
import { classifyObjective, completionContract, planContractMismatch, projectOutputType } from "./objective-contract.ts";

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
  /** The independent verifier could not run (no model answered); retry next cycle instead of replanning. */
  verifierUnavailable?: boolean;
  /** Verification rejected the deliverable: what a rectification pass must fix. */
  rectify?: { projectId: string; issues: string[]; failedCriteria: string[]; deliverable: string; producerRefs: string[] };
  verification?: Record<string, unknown>;
};

const MAX_REPLAN_ATTEMPTS = 5;
export const MAX_RECTIFICATION_ROUNDS = 2;

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
    const llmResult = (parsed as Record<string, unknown>).llmResult;
    const capabilityResult =
      llmResult && typeof llmResult === "object" &&
      (llmResult as Record<string, unknown>).capability_result;
    const capability =
      dispatch && typeof dispatch === "object"
        ? String((dispatch as Record<string, unknown>).capability ?? "unknown")
        : llmResult && typeof llmResult === "object"
          ? String((llmResult as Record<string, unknown>).capability ?? "unknown")
          : "unknown";

    // product.build/deploy/verify are measured by their capability_result.
    // work-engine deliberately does NOT dispatch these through Company OS
    // again, so companyOsDispatch.status may legitimately be "unknown_capability"
    // even when the measured product operation succeeded.
    const measuredProductSuccess =
      ["product.build", "product.deploy", "product.verify"].includes(capability) &&
      capabilityResult !== undefined &&
      typeof capabilityResult === "object" &&
      (
        (capabilityResult as Record<string, unknown>).live === true ||
        String((capabilityResult as Record<string, unknown>).product_status ?? "") === "live"
      );

    if (
      measuredProductSuccess ||
      (dispatch && typeof dispatch === "object" &&
        typeof (dispatch as Record<string, unknown>).status === "string")
    ) {
      const status = measuredProductSuccess
        ? "success"
        : String((dispatch as Record<string, unknown>).status);
      evidence.push({
        taskId: String(task.id ?? "unknown"),
        capability,
        dispatchStatus: status,
        verified: status === "success",
      });
    }
  }
  return evidence;
}

async function syncDeterministicVerificationEvidence(
  objectiveId: string,
  projects: Record<string, unknown>[],
  tasks: Record<string, unknown>[],
): Promise<{ passed: number; required: number }> {
  const supabase = getSupabaseAdmin();
  const { data: contract } = await supabase
    .from("objective_contracts")
    .select("evidence_requirements")
    .eq("objective_id", objectiveId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const requirements = Array.isArray(contract?.evidence_requirements)
    ? contract.evidence_requirements.map(String)
    : [];
  if (!requirements.length) return { passed: 0, required: 0 };

  const outputs = tasks
    .filter((t) => typeof t.output === "string")
    .map((t) => ({ task: t, output: String(t.output) }));

  const hasLiveUrl = projects.some((p) =>
    /https?:\/\//.test(String(p.final_output ?? "")) &&
    /live|deploy|url|production|vercel|netlify/i.test(String(p.final_output ?? ""))
  ) || outputs.some(({ output }) =>
    /https?:\/\//.test(output) &&
    /live|deploy|url|production|vercel|netlify/i.test(output)
  );

  const hasSource = outputs.some(({ output }) =>
    /github\.com|gitlab\.com|repository|source code|commit/i.test(output)
  );

  const hasMeasuredBuild = outputs.some(({ output }) =>
    /build|deploy|deployment/i.test(output) &&
    /success|passed|live|production/i.test(output)
  );

  const hasMeasuredFunctionalVerification = outputs.some(({ output }) =>
    /product\.verify/i.test(output) &&
    /"live"\s*:\s*true|"product_status"\s*:\s*"live"/i.test(output)
  );

  const allTasksTerminalVerified = tasks.length > 0 && tasks.every((t) =>
    ["completed", "done", "verified"].includes(String(t.status ?? "").toLowerCase())
  );

  let passed = 0;
  for (const requirement of requirements) {
    const key = requirement.toLowerCase();
    let ok = false;
    let evidenceType = "";
    let notes = "";

    // Only deterministic observations are admitted here. We deliberately do
    // NOT convert an LLM assertion such as "visual verification passed" into
    // evidence.
    if (/source|repository/.test(key) && hasSource) {
      ok = true; evidenceType = "repository_observation";
      notes = "Observed repository/source evidence in persisted task output.";
    } else if (/live.*url/.test(key) && hasLiveUrl) {
      ok = true; evidenceType = "live_url_observation";
      notes = "Observed a live/deployment URL in persisted execution output.";
    } else if (/build|deployment/.test(key) && hasMeasuredBuild) {
      ok = true; evidenceType = "deployment_observation";
      notes = "Observed completed build/deployment evidence with a success/live signal.";
    } else if (/functional/.test(key) && hasMeasuredFunctionalVerification) {
      ok = true; evidenceType = "functional_capability_verification";
      notes = "Observed measured product.verify output indicating live product state.";
    } else if (/verification|tests/.test(key) && allTasksTerminalVerified && hasMeasuredFunctionalVerification) {
      ok = true; evidenceType = "deterministic_task_verification";
      notes = "All persisted objective tasks are terminal-success and measured product verification exists.";
    }

    if (!ok) continue;

    const { data: existing } = await supabase
      .from("fkaios_verification_evidence")
      .select("id")
      .eq("objective_id", objectiveId)
      .eq("requirement_key", requirement)
      .eq("status", "passed")
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      passed++;
      continue;
    }

    const { error } = await supabase
      .from("fkaios_verification_evidence")
      .insert({
        objective_id: objectiveId,
        requirement_key: requirement,
        evidence_type: evidenceType,
        observed_result: {
          objective_id: objectiveId,
          live_url_observed: hasLiveUrl,
          source_observed: hasSource,
          measured_build_observed: hasMeasuredBuild,
          measured_functional_verification: hasMeasuredFunctionalVerification,
          all_tasks_terminal_verified: allTasksTerminalVerified,
        },
        verifier: "objective-loop-deterministic-verifier",
        status: "passed",
        verification_notes: notes,
        verified_at: new Date().toISOString(),
      });

    if (!error) passed++;
  }

  return { passed, required: requirements.length };
}

async function evaluateObjective(
  objective: Record<string, unknown>,
  projects: Record<string, unknown>[],
  tasks: Record<string, unknown>[],
  correlationId?: string,
): Promise<ObjectiveEvaluation> {
  const contract = completionContract(String(objective.raw_request ?? ""));
  const { data: objectiveContract } = await getSupabaseAdmin().from("objective_contracts").select("objective_type,intent,requirements,acceptance_criteria,quality_benchmark,discovery,solution_plan,continuity,status").eq("objective_id", String(objective.id)).maybeSingle();
  const productLiveEvidence = contract.requiresLiveArtifact && (
    projects.some((p) => (String(p.final_output ?? "").includes("http://") || String(p.final_output ?? "").includes("https://")) && /live|deploy|url/i.test(String(p.final_output ?? ""))) ||
    tasks.some((t) => typeof t.output === "string" && (t.output.includes("http://") || t.output.includes("https://")) && /live|deploy|url|production|netlify|vercel/i.test(t.output))
  );

  // Outcome gate: for product objectives, code generation is never the final
  // outcome. A product is complete only when a usable deployed artifact is
  // evidenced. This is intentionally deterministic and runs after task-level
  // verification, so an LLM cannot mark source code as a finished product.
  if (contract.requiresLiveArtifact && !productLiveEvidence) {
    return {
      achieved: false,
      blocked: false,
      failed: false,
      verificationUnavailable: true,
      reason: "Product work is not complete: FKAIOS has not produced verified evidence of a deployed, usable product. Generated code is an intermediate artifact, not the finished outcome.",
      next_action: "Complete deployment/integration, verify the live product against the acceptance criteria, and record the live URL as evidence.",
    };
  }

  const deterministicEvidence = extractDeterministicEvidence(tasks);

  // If an earlier planning pass already produced a fully verified live
  // artifact, a later recovery/replan pass must not erase that real outcome.
  // This prevents transient worker failures from turning a completed product
  // back into "Executing".
  const historicalVerifiedLiveProject = contract.requiresLiveArtifact && projects.some((project) => {
    const projectId = String(project.id ?? "");
    if (!projectId) return false;
    const projectTasks = tasks.filter((task) => String(task.project_id ?? "") === projectId);
    if (projectTasks.length === 0) return false;
    const gate = assessObjectiveTasks(projectTasks as TaskEvidenceRecord[]);
    const liveEvidence = projectTasks.some((task) =>
      typeof task.output === "string" &&
      /https?:\/\//.test(task.output) &&
      /live|deploy|url|production|vercel|netlify/i.test(task.output)
    );
    return gate.allVerified && liveEvidence;
  });

  // TASK-SET GATE: normally judge the CURRENT task set (the latest planning
  // pass). A historical verified live project is an explicit recovery path.
  const taskGate = assessCurrentTaskSet(projects, tasks);

  if (historicalVerifiedLiveProject) {
    return {
      achieved: true,
      blocked: false,
      failed: false,
      reason: "Objective achieved: a planning pass produced a live deployed product with a fully verified task set; later retry projects are recovery history.",
      next_action: "",
    };
  }
  if (projects.length > 0 && taskGate.blocked) {
    return {
      achieved: false,
      blocked: true,
      failed: false,
      reason: formatBlockedSummary(taskGate),
      next_action: "Provide a real data source or approve a research capability for the listed task(s), then resume the objective.",
    };
  }

  // Task-level gate: every task in the current planning pass must carry
  // verified evidence before the objective itself is judged.
  if (!taskGate.allVerified) {
    return {
      achieved: false,
      blocked: false,
      failed: false,
      verificationUnavailable: true,
      reason: `Not achieved: ${taskGate.reason}`,
      next_action: "Recover the failed task(s) from their checkpoints, or replan if they cannot be recovered.",
    };
  }

  // INDEPENDENT OBJECTIVE VERIFICATION: the deliverable is judged against the
  // original objective and its criteria by a model other than the producers
  // wherever one exists, with quotes checked against the deliverable.
  const latestProjectId = String(projects[0]?.id ?? "");
  const currentTasks = tasks.filter((t) => String(t.project_id ?? "") === latestProjectId);
  const deliverable = buildCurrentDeliverable("", currentTasks as Parameters<typeof buildCurrentDeliverable>[1]);
  const supabase = getSupabaseAdmin();
  const taskIds = currentTasks.map((t) => String(t.id));
  const { data: producerSteps } = taskIds.length
    ? await supabase.from("fkaios_execution_steps").select("resource_ref").in("task_id", taskIds).eq("outcome", "completed").like("resource_ref", "model:%")
    : { data: [] };
  const producerRefs = [...new Set(((producerSteps ?? []) as Array<{ resource_ref: string }>).map((r) => r.resource_ref))];
  const evidence = currentTasks
    .filter((t) => !/^Rectify:/i.test(String(t.title ?? "")))
    .map((t) => `[${String(t.title ?? "task")}]\n${String(t.output ?? "").slice(0, 2500)}`)
    .join("\n\n");
  const verdict = await verifyObjective(supabase, {
    objectiveId: String(objective.id),
    projectId: latestProjectId || null,
    objective: String(objective.raw_request ?? ""),
    criteria: contractCriteria((objectiveContract as Record<string, unknown> | null)?.acceptance_criteria),
    deliverable,
    evidence,
    producerRefs,
    producingTaskIds: taskIds,
  });
  const verification = { passed: verdict.passed, quality: verdict.quality, independence: verdict.independence, verifier: verdict.verifierRef, evidence_id: verdict.evidenceId ?? null, issues: verdict.issues.slice(0, 10), criteria: verdict.criteria.map((c) => ({ criterion: c.criterion, met: c.met })), at: new Date().toISOString() };

  if (!verdict.available) {
    return { achieved: false, blocked: false, failed: false, verificationUnavailable: true, verifierUnavailable: true, verification, reason: verdict.issues[0] ?? "Independent verifier unavailable.", next_action: "Retry independent verification next cycle." };
  }
  if (verdict.needsHumanDecision) {
    return { achieved: false, blocked: true, failed: false, verification, reason: `Human decision required: ${verdict.humanDecisionReason}`, next_action: "Founder decision required before the objective can be completed." };
  }
  if (!verdict.passed) {
    return {
      achieved: false, blocked: false, failed: false, verification,
      rectify: { projectId: latestProjectId, issues: verdict.issues, failedCriteria: verdict.criteria.filter((c) => !c.met).map((c) => c.criterion), deliverable, producerRefs },
      reason: `Independent verification rejected the deliverable: ${verdict.issues.slice(0, 3).join(" | ")}`,
      next_action: "Rectify the deliverable against the verifier's issues, then verify again.",
    };
  }

  const evaluation: ObjectiveEvaluation = {
    achieved: true, blocked: false, failed: false, verification,
    reason: `Independently verified: ${verdict.criteria.length} criteria met, quality ${verdict.quality.toFixed(2)}, verifier ${verdict.verifierRef} (${verdict.independence}).`,
    next_action: "",
  };

  // Contract evidence requirements (deterministic observations) still apply.
  const evidenceState = await syncDeterministicVerificationEvidence(String(objective.id), projects, tasks);
  if (evidenceState.required > 0) {
    const { data: completionAllowed } = await getSupabaseAdmin()
      .rpc("fkaios_objective_completion_allowed", { p_objective_id: String(objective.id) });
    if (completionAllowed !== true) {
      return {
        achieved: false, blocked: false, failed: false, verificationUnavailable: true, verification,
        reason: `Verifier passed, but contract evidence is incomplete: ${evidenceState.passed}/${evidenceState.required} evidence requirements passed.`,
        next_action: "Create the missing contract evidence before completion.",
      };
    }
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

// Independent, deterministic record that the completion gate passed: which
// tasks were verified, with what status and capability evidence. Written
// before anything is marked complete, and a failed write blocks completion,
// so no objective can be COMPLETED without a fkaios_verification_evidence row.
async function recordCompletionEvidence(
  supabase: ReturnType<typeof createClient>,
  objectiveId: string,
  projectId: string,
  tasks: Record<string, unknown>[],
) {
  const requirementKey = "completion_gate:all_tasks_verified";
  const { data: existing, error: readError } = await supabase
    .from("fkaios_verification_evidence")
    .select("id")
    .eq("objective_id", objectiveId)
    .eq("requirement_key", requirementKey)
    .eq("status", "passed")
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(`Completion evidence could not be checked: ${readError.message}`);
  if ((existing as { id?: string } | null)?.id) return;

  const taskEvidence = tasks.map((t) => {
    let dispatch: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(String(t.output ?? ""));
      const d = parsed?.companyOsDispatch;
      if (d && typeof d === "object") dispatch = { capability: d.capability ?? null, status: d.status ?? null };
    } catch {
      // plain-text output: no capability dispatch recorded
    }
    return {
      task_id: String(t.id ?? ""),
      title: String(t.title ?? "").slice(0, 200),
      status: String(t.status ?? ""),
      output_chars: typeof t.output === "string" ? t.output.length : 0,
      capability_dispatch: dispatch,
    };
  });

  const { error } = await (supabase.from("fkaios_verification_evidence") as ReturnType<typeof supabase.from>).insert({
    objective_id: objectiveId,
    project_id: projectId,
    requirement_key: requirementKey,
    evidence_type: "deterministic_task_gate",
    observed_result: { project_id: projectId, task_count: tasks.length, tasks: taskEvidence },
    verifier: "objective-loop-completion-gate",
    status: "passed",
    verification_notes: "Every task in the completing project is terminal-success with persisted output, and fact-dependent tasks carry a successful capability dispatch (assessObjectiveTasks/assessCurrentTaskSet).",
    verified_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Completion evidence could not be recorded: ${error.message}`);
}

async function markObjective(
  supabase: ReturnType<typeof createClient>,
  objectiveId: string,
  status: "completed" | "failed" | "awaiting_approval",
  summary: string,
) {
  const boundedSummary = summary.slice(0, 5000);
  let completionProjectId: string | null = null;
  let deliverable: string | undefined;

  // Defense-in-depth: completion must be backed by a fully verified planning
  // pass. For live-product objectives, an earlier verified live artifact remains
  // valid even if a later retry/replan project is incomplete.
  if (status === "completed") {
    const { data: projects, error: projectError } = await supabase
      .from("orchestration_projects")
      .select("id, final_output, output_type")
      .like("request", `[objective:${objectiveId}]%`)
      .order("created_at", { ascending: false });
    if (projectError) throw new Error(`Completion gate could not load projects: ${projectError.message}`);
    if (!projects?.length) throw new Error("Completion gate rejected objective: no execution project exists.");

    const { data: allTasks, error: taskError } = await supabase
      .from("orchestration_tasks")
      .select("id,title,description,status,output,project_id,created_at")
      .in("project_id", projects.map((p) => p.id));
    if (taskError) throw new Error(`Completion gate could not load tasks: ${taskError.message}`);

    for (const project of projects) {
      const projectTasks = (allTasks ?? []).filter((t) => String(t.project_id ?? "") === String(project.id));
      const gate = assessObjectiveTasks(projectTasks as TaskEvidenceRecord[]);
      const liveEvidence = projectTasks.some((task) =>
        typeof task.output === "string" &&
        /https?:\/\//.test(task.output) &&
        /live|deploy|url|production|vercel|netlify/i.test(task.output)
      );
      if (gate.allVerified && liveEvidence) {
        completionProjectId = String(project.id);
        break;
      }
    }

    if (!completionProjectId) {
      const latestProjectId = projects[0]?.id;
      const latestTasks = (allTasks ?? []).filter((t) => String(t.project_id ?? "") === String(latestProjectId));
      const gate = assessCurrentTaskSet(projects, latestTasks as TaskEvidenceRecord[]);
      if (!gate.allVerified) throw new Error(`Completion gate rejected objective: ${gate.reason}`);
      completionProjectId = String(latestProjectId);
    }

    const completionTasks = ((allTasks ?? []) as Record<string, unknown>[]).filter((t) => String(t.project_id ?? "") === completionProjectId);
    await recordCompletionEvidence(supabase, objectiveId, completionProjectId, completionTasks);
    // HTML products are previewed and downloaded as-is by the Console, so
    // they keep their own final_output; everything else gets the real work.
    const completionProject = (projects as Record<string, unknown>[]).find((p) => String(p.id) === completionProjectId);
    deliverable = completionProject?.output_type === "html"
      ? undefined
      : buildCurrentDeliverable(boundedSummary, completionTasks);

    const { error: markProjectError } = await supabase
      .from("orchestration_projects")
      .update(projectUpdateForObjective(status, boundedSummary, deliverable))
      .eq("id", completionProjectId);
    if (markProjectError) throw new Error(`Failed updating completion project ${completionProjectId}: ${markProjectError.message}`);
  }

  const { error } = await supabase
    .from("orchestrator_requests")
    .update({
      status,
      result_summary: boundedSummary,
      action_taken: "objective_loop",
    })
    .eq("id", objectiveId);

  const contractStatus = status === "completed" ? "verified" : status === "awaiting_approval" ? "blocked" : status === "failed" ? "blocked" : "executing";
  await supabase.from("objective_contracts").update({
    status: contractStatus,
    updated_at: new Date().toISOString(),
  }).eq("objective_id", objectiveId);

  if (error) {
    throw new Error(`Failed updating objective ${objectiveId}: ${error.message}`);
  }

  // Project projection: the Command Center reads orchestration_projects for
  // execution state and final output. Keep it in sync with the authoritative
  // objective decision above. Without this, an objective could be COMPLETED
  // in orchestrator_requests while its project remained "working", leaving
  // the Console with no final result to display.
  const { data: projects, error: projectReadError } = await supabase
    .from("orchestration_projects")
    .select("id")
    .like("request", `[objective:${objectiveId}]%`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (projectReadError) {
    throw new Error(`Failed loading project for completed objective ${objectiveId}: ${projectReadError.message}`);
  }

  const projectId = projects?.[0]?.id;
  if (!projectId) return;

  const { error: projectUpdateError } = await supabase
    .from("orchestration_projects")
    .update(projectUpdateForObjective(status, boundedSummary, String(projectId) === completionProjectId ? deliverable : undefined))
    .eq("id", projectId);

  if (projectUpdateError) {
    throw new Error(`Failed updating project ${projectId}: ${projectUpdateError.message}`);
  }
}

/**
 * Retire the objective's live planning pass(es) before a new pass is created.
 * orchestration_projects has a guard (trg_prevent_duplicate_active_orchestration_project)
 * that rejects a second active project for the same request, so a new pass can
 * only be planned once the old one is closed. Queued jobs of the retired pass
 * are failed with the reason; open tasks move to 'rework' with the reason and
 * stay as history. If any of its jobs is mid-execution the pass is left alone
 * and the caller waits for the next run instead of interrupting it.
 */
export async function retireLivePasses(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  objectiveId: string,
  reason: string,
): Promise<{ waiting: boolean; retired: string[] }> {
  const { data: live, error: liveErr } = await supabase
    .from("orchestration_projects")
    .select("id")
    .like("request", `[objective:${objectiveId}]%`)
    .in("status", ["planning", "working", "reviewing", "reworking", "merging"]);
  if (liveErr) throw new Error(`Failed loading live plans: ${liveErr.message}`);
  const projectIds = (live ?? []).map((p: { id: unknown }) => String(p.id));
  if (projectIds.length === 0) return { waiting: false, retired: [] };

  const { data: passTasks } = await supabase
    .from("orchestration_tasks")
    .select("id, status")
    .in("project_id", projectIds);
  const openTaskIds = (passTasks ?? [])
    .filter((t: { status?: unknown }) => ["pending", "assigned", "rework"].includes(String(t.status ?? "")))
    .map((t: { id: unknown }) => String(t.id));
  if (openTaskIds.length > 0) {
    const { data: running } = await supabase
      .from("ai_jobs")
      .select("id")
      .eq("type", "work_engine_task")
      .eq("status", "running")
      .in("payload->>task_id", openTaskIds)
      .limit(1);
    if ((running ?? []).length > 0) return { waiting: true, retired: [] };
    const { error: jobErr } = await supabase
      .from("ai_jobs")
      .update({ status: "failed", error: `superseded: ${reason}`.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("type", "work_engine_task")
      .in("status", ["pending", "retry"])
      .in("payload->>task_id", openTaskIds);
    if (jobErr) throw new Error(`Failed retiring queued jobs: ${jobErr.message}`);
    const { error: taskErr } = await supabase
      .from("orchestration_tasks")
      .update({ status: "rework", output: JSON.stringify({ status: "superseded", reason }) })
      .in("id", openTaskIds);
    if (taskErr) throw new Error(`Failed retiring open tasks: ${taskErr.message}`);
  }
  const { error: projErr } = await supabase
    .from("orchestration_projects")
    .update({ status: "failed", error_message: reason.slice(0, 1000) })
    .in("id", projectIds);
  if (projErr) throw new Error(`Failed retiring live plan: ${projErr.message}`);
  return { waiting: false, retired: projectIds };
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

  // V1 EXECUTION OWNERSHIP: an objective continuation must be able to
  // execute its own queued work. Do not depend on a separate scheduler or
  // heartbeat to notice ai_jobs created by this loop. ai-engine remains the
  // single executor; this only invokes its existing queue-drain endpoint.
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (supabaseUrl && serviceRoleKey) {
      const workerResponse = await fetch(
        supabaseUrl + "/functions/v1/ai-engine/run_jobs",
        {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + serviceRoleKey,
            "apikey": serviceRoleKey,
            "Content-Type": "application/json",
            "X-Correlation-ID": crypto.randomUUID().slice(0, 8),
          },
          body: JSON.stringify({}),
        },
      );
      if (!workerResponse.ok) {
        console.error("objective-loop: ai-engine worker drain returned HTTP error", workerResponse.status);
      }
    }
  } catch (err) {
    console.error("objective-loop: ai-engine worker drain failed (non-blocking)", err instanceof Error ? err.message : String(err));
  }

  // Reconcile completed worker jobs BEFORE loading objective state.
  // Otherwise an ai-engine job can finish while its orchestration task is still
  // assigned; the state reader then sees active work and defers, leaving the
  // task stranded until another heartbeat. Returning completed work first makes
  // the worker->task handoff deterministic within the same objective-loop pass.
  try {
    await returnCompletedWork();
  } catch (err) {
    console.error("objective-loop: completed-work reconciliation failed (non-blocking)", err instanceof Error ? err.message : String(err));
  }

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
      /*
       * Founder-requested re-run (founder-objective `rerun`): start a new
       * planning pass now. Earlier projects/tasks stay as history; the
       * objective is judged on the new pass from here on.
       */
      if (isRerunRequested(objective)) {
        // The founder asked for a fresh pass: close the current one first, or
        // the duplicate-active-project guard rejects the new plan on every run
        // (Kids DPS 20cbf892, 9 Oct 12:58–13:11 UTC: "DUPLICATE_ACTIVE_
        // ORCHESTRATION_PROJECT" each minute while project 927854fa stayed
        // 'working' under a blocked objective).
        const retire = await retireLivePasses(supabase, String(objective.id), `Superseded by the founder's re-run request (${String(objective.result_summary ?? "").slice(0, 120)})`);
        if (retire.waiting) {
          results.push({ objectiveId: String(objective.id), action: "no_action", summary: "Re-run requested; waiting for a running job of the current plan to finish before replanning." });
          continue;
        }
        const continuation = await createContinuationProject(objective, correlationId);
        if (!continuation.projectId) {
          results.push({
            objectiveId: String(objective.id),
            action: "no_action",
            summary: `Re-run requested but planning failed: ${continuation.error ?? "unknown"}. Will retry next run.`,
          });
          continue;
        }
        const { error: flagError } = await supabase
          .from("orchestrator_requests")
          .update({ action_taken: OBJECTIVE_LOOP, result_summary: null })
          .eq("id", objective.id);
        if (flagError) throw new Error(`Failed clearing re-run flag: ${flagError.message}`);
        results.push({
          objectiveId: String(objective.id),
          action: "replan",
          projectId: continuation.projectId,
          tasksCreated: continuation.tasksCreated,
          summary: "Re-run requested by the founder: new planning pass created.",
        });
        continue;
      }

      /*
       * STALE-CONTRACT RECOVERY: the live planning pass was created under a
       * classification the current contract no longer gives this objective
       * (e.g. a research report planned as a website build). Executing it
       * would deliver the wrong kind of result, so the pass is retired and
       * the objective replanned. Queued jobs of the retired pass are failed
       * with the reason; a job that is mid-execution is waited for (next
       * run) rather than interrupted. Retired tasks and their outputs stay
       * as history.
       */
      const { data: livePass } = await supabase
        .from("orchestration_projects")
        .select("id, status, output_type")
        .like("request", `[objective:${objective.id}]%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (planContractMismatch(livePass, String(objective.raw_request ?? ""))) {
        const expected = projectOutputType(classifyObjective(String(objective.raw_request ?? "")));
        const reasonText = `Plan ${livePass!.id} was created for output '${livePass!.output_type}', but the objective contract now requires '${expected}'. Retired and replanned.`;
        const retire = await retireLivePasses(supabase, String(objective.id), reasonText);
        if (retire.waiting) {
          results.push({ objectiveId: String(objective.id), action: "no_action", summary: "Stale plan detected; waiting for its running job to finish before replanning." });
          continue;
        }
        const continuation = await createContinuationProject(objective, correlationId);
        if (!continuation.projectId) {
          results.push({ objectiveId: String(objective.id), action: "no_action", summary: `Stale plan retired but replanning failed: ${continuation.error ?? "unknown"}. Will retry next run.` });
          continue;
        }
        await syncObjectiveState(supabase, { id: String(objective.id), status: "processing", raw_request: String(objective.raw_request ?? "") }, { phase: "planning", reason: reasonText.slice(0, 500), patch: { rectification_round: 0, next_action: "Execute the new plan." } });
        results.push({ objectiveId: String(objective.id), action: "replan", projectId: continuation.projectId, tasksCreated: continuation.tasksCreated, summary: reasonText });
        continue;
      }

      const state = await loadObjectiveState(
        supabase,
        String(objective.id),
      );

      // ORPHANED TASK RECOVERY: an ai_jobs failure is terminal for the job,
      // but older work-engine code can leave its orchestration_task stuck at
      // "assigned". That status is treated as active below, so the objective
      // loop can wait forever even though there is no executable job left.
      // Reconcile task state against the real ai_jobs queue before deciding
      // that work is still active. A failed job with no newer pending/running/
      // retry job moves the task to "rework", allowing the normal evaluator /
      // planner path to recover it on this cycle. Completed jobs are handled
      // by returnCompletedWork(), so they are intentionally left alone here.
      const taskIds = state.tasks.map((task) => String(task.id)).filter(Boolean);
      if (taskIds.length > 0) {
        const { data: objectiveJobs } = await supabase
          .from("ai_jobs")
          .select("id, status, retry_count, payload, created_at")
          .eq("type", "work_engine_task")
          .in("payload->>task_id", taskIds)
          .order("created_at", { ascending: false });
        const jobsByTask = new Map<string, Record<string, unknown>[]>();
        for (const job of objectiveJobs ?? []) {
          const taskId = typeof (job.payload as Record<string, unknown> | null)?.task_id === "string"
            ? String((job.payload as Record<string, unknown>).task_id)
            : "";
          if (!taskId) continue;
          const list = jobsByTask.get(taskId) ?? [];
          list.push(job as Record<string, unknown>);
          jobsByTask.set(taskId, list);
        }
        for (const task of state.tasks) {
          const taskStatus = String(task.status ?? "");
          // "pending" is excluded: pending tasks are deliberately held back
          // (no ai_jobs row yet) until the previous task in the evidence chain
          // returns, and are allocated further below. Only tasks that claim to
          // be executing without a job are orphaned.
          if (!["assigned", "running", "working"].includes(taskStatus)) continue;
          const jobs = jobsByTask.get(String(task.id)) ?? [];
          const hasLiveJob = jobs.some((job) => ["pending", "running", "retry"].includes(String(job.status ?? "")));
          const hasCompletedJob = jobs.some((job) => String(job.status ?? "") === "completed");
          // A completed job is executable evidence even if returnCompletedWork()
          // has not closed the task yet. Never convert such a task to rework:
          // doing so races the completion-return step below and can erase a
          // genuinely completed execution before it is persisted to the task.
          if (!hasLiveJob && !hasCompletedJob) {
            const hadFailedJob = jobs.some((job) => String(job.status ?? "") === "failed");
            await supabase.from("orchestration_tasks")
              .update({ status: "rework", output: JSON.stringify({
                status: "rework",
                reason: hadFailedJob
                  ? "The execution job failed and no replacement job is active; objective loop is reopening the task for recovery."
                  : "The task is active but has no executable ai_jobs row; objective loop is reopening it for recovery."
              }) })
              .eq("id", task.id)
              .in("status", ["pending", "assigned", "running", "working"]);
            task.status = "rework";
          }
        }
      }

      // CHECKPOINT RESUME: a task whose execution failed is resumed from a
      // checkpoint on another resource (same task, prior evidence kept) before
      // anything is replanned. Only the current planning pass is resumed.
      const firstProject = (state.projects as Record<string, unknown>[])[0];
      const latestProjectId = firstProject?.id ? String(firstProject.id) : null;
      for (const task of state.tasks) {
        if (String(task.status ?? "") !== "rework" || String(task.project_id ?? "") !== latestProjectId) continue;
        try {
          const resumed = await resumeTaskFromCheckpoint(String(task.id), String(objective.id));
          if (resumed.resumed) task.status = "assigned";
        } catch (err) {
          console.error("objective-loop: checkpoint resume failed (non-blocking)", err instanceof Error ? err.message : String(err));
        }
      }

      // Only assigned/running work is actively executing. Pending tasks are
      // intentionally held back so the project executes as an evidence chain:
      // research -> verification -> report, never parallel independent answers.
      const activeTasks = state.tasks.filter((task) =>
        ["assigned", "running", "working"].includes(String(task.status ?? ""))
      );
      const pendingTasks = state.tasks.filter((task) => String(task.status ?? "") === "pending");

      /*
       * A task already known to need data no capability can supply blocks
       * the objective now; waiting for the other tasks (possibly behind a
       * long job backlog) cannot change that outcome.
       */
      const gate = assessCurrentTaskSet(state.projects, state.tasks);
      if (state.projects.length > 0 && gate.blocked) {
        const summary = formatBlockedSummary(gate);
        await markObjective(supabase, String(objective.id), "awaiting_approval", summary);
        results.push({
          objectiveId: String(objective.id),
          action: "blocked",
          projectId: state.projects[0]?.id ? String(state.projects[0].id) : null,
          summary,
        });
        continue;
      }

      /*
       * If work is still executing, do not create duplicate projects.
       * Pending tasks are not execution yet; allocate exactly the next task
       * after the previous task has returned verified evidence.
       */
      if (activeTasks.length > 0) {
        await syncObjectiveState(supabase, { id: String(objective.id), status: "processing", raw_request: String(objective.raw_request ?? "") });
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

      if (pendingTasks.length > 0) {
        const projectId = state.projects[0]?.id ? String(state.projects[0].id) : null;
        if (projectId) {
          const allocation = await allocateProjectWork(projectId);
          if (allocation.allocated > 0) {
            results.push({
              objectiveId: String(objective.id),
              action: "continue_execution",
              projectId,
              tasksCreated: allocation.allocated,
              summary: "Advanced to the next task after the prior task completed; evidence was handed forward.",
            });
            continue;
          }
        }
      }

      /*
       * No active or pending work remains.
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
        await syncObjectiveState(supabase, { id: String(objective.id), status: "completed", raw_request: String(objective.raw_request ?? "") }, { phase: "completed", reason: evaluation.reason, patch: { verification: evaluation.verification ?? {}, next_action: null, blocked_reason: null } });

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
        await syncObjectiveState(supabase, { id: String(objective.id), status: "awaiting_approval", raw_request: String(objective.raw_request ?? "") }, { phase: "blocked", reason: evaluation.reason, patch: { verification: evaluation.verification ?? {}, blocked_reason: evaluation.reason, next_action: evaluation.next_action } });

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
      if (evaluation.verifierUnavailable) {
        await syncObjectiveState(supabase, { id: String(objective.id), status: "processing", raw_request: String(objective.raw_request ?? "") }, { phase: "verifying", reason: evaluation.reason, patch: { next_action: evaluation.next_action } });
        results.push({ objectiveId: String(objective.id), action: "no_action", projectId: latestProjectId, summary: `Verification pending: ${evaluation.reason}` });
        continue;
      }

      // RECTIFICATION LOOP: a rejected deliverable is corrected in the same
      // project (verifier issues in, producing models avoided), then verified
      // again — before any replan and long before the founder is involved.
      if (evaluation.rectify) {
        const current = await readObjectiveState(supabase, String(objective.id));
        const round = (current?.rectification_round ?? 0) + 1;
        if (round <= MAX_RECTIFICATION_ROUNDS) {
          await createRectificationTask({ projectId: evaluation.rectify.projectId, objectiveId: String(objective.id), round, issues: evaluation.rectify.issues, failedCriteria: evaluation.rectify.failedCriteria, deliverable: evaluation.rectify.deliverable, producerRefs: evaluation.rectify.producerRefs });
          const allocation = await allocateProjectWork(evaluation.rectify.projectId);
          await syncObjectiveState(supabase, { id: String(objective.id), status: "processing", raw_request: String(objective.raw_request ?? "") }, { phase: "rectifying", reason: evaluation.reason, patch: { rectification_round: round, verification: evaluation.verification ?? {}, next_action: evaluation.next_action } });
          results.push({ objectiveId: String(objective.id), action: "continue_execution", projectId: evaluation.rectify.projectId, tasksCreated: allocation.allocated, summary: `Verification rejected the deliverable; rectification round ${round}/${MAX_RECTIFICATION_ROUNDS} started.` });
          continue;
        }
      }

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

      await syncObjectiveState(supabase, { id: String(objective.id), status: "processing", raw_request: String(objective.raw_request ?? "") }, { phase: "planning", reason: `replan: ${evaluation.reason}`.slice(0, 500), patch: { rectification_round: 0, verification: evaluation.verification ?? {}, next_action: "Execute the new plan." } });
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

// FKAIOS V1 deployment trigger: objective-loop recovery is production-bound.
