// CANONICAL OBJECTIVE STATE — one authoritative record per objective
// (fkaios_objective_state), independent of any model's context window. It is
// rebuilt from the tables of record on every objective-loop pass and written
// with compare-and-swap (fkaios_objective_state_apply), so a slow or stale
// writer can never overwrite newer state, and only legal phase transitions
// happen. Any worker or model taking over reads this record to continue.

// deno-lint-ignore no-explicit-any
type Db = any;

export type Phase = "understanding" | "planning" | "executing" | "verifying" | "rectifying" | "completed" | "blocked" | "failed";

// Mirror of public.fkaios_phase_transition_allowed (the database enforces it).
const TRANSITIONS: Record<Phase, Phase[]> = {
  understanding: ["planning", "executing", "blocked", "failed"],
  planning: ["executing", "blocked", "failed"],
  executing: ["planning", "verifying", "blocked", "failed"],
  verifying: ["rectifying", "planning", "executing", "completed", "blocked", "failed"],
  rectifying: ["executing", "verifying", "planning", "blocked", "failed"],
  blocked: ["planning", "executing", "verifying", "failed"],
  // A completed objective may re-enter verification only for evidence repair; the scheduler gate checks that the passing verifier record is missing.
  completed: ["verifying"],
  failed: [],
};

/** Shortest legal path from one phase to another (excluding the start), or null if unreachable. */
export function phasePath(from: Phase, to: Phase): Phase[] | null {
  if (from === to) return [];
  // Completed objectives may be reopened for verification evidence repair, but
  // that exception must not create a route back into planning or execution.
  if (from === "completed" && !["verifying", "rectifying", "blocked", "failed"].includes(to)) return null;
  const queue: Array<{ p: Phase; path: Phase[] }> = [{ p: from, path: [] }];
  const seen = new Set<Phase>([from]);
  while (queue.length) {
    const { p, path } = queue.shift()!;
    for (const next of TRANSITIONS[p]) {
      if (seen.has(next)) continue;
      const np = [...path, next];
      if (next === to) return np;
      seen.add(next);
      queue.push({ p: next, path: np });
    }
  }
  return null;
}

export interface TaskFact {
  id: string;
  title: string;
  status: string;
  project_id: string;
  created_at: string;
  attempts?: number | null;
  output?: unknown;
}

export interface StepFact {
  task_id: string | null;
  resource_ref: string | null;
  outcome: string;
  failure_category: string | null;
  error: string | null;
  verification_status: string;
  created_at: string;
}

const ACTIVE = new Set(["assigned", "running", "working"]);
const DONE = new Set(["done", "approved", "completed", "verified"]);

/** Pure: the facts-derived part of the state (plan, progress, resources, failures, artifacts). */
export function deriveSnapshot(input: {
  objectiveStatus: string;
  contract: Record<string, unknown> | null;
  projects: Array<{ id: string; created_at?: string; final_output?: string | null }>;
  tasks: TaskFact[];
  steps: StepFact[];
}): { phase: Phase; patch: Record<string, unknown> } {
  const latestProjectId = input.projects[0]?.id ?? null;
  const tasks = input.tasks.filter((t) => t.project_id === latestProjectId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lastStepByTask = new Map<string, StepFact>();
  for (const s of [...input.steps].sort((a, b) => a.created_at.localeCompare(b.created_at))) if (s.task_id) lastStepByTask.set(s.task_id, s);

  const plan = tasks.map((t) => ({ task_id: t.id, title: t.title, status: t.status, attempts: t.attempts ?? 0, resource: lastStepByTask.get(t.id)?.resource_ref ?? null }));
  const completed = tasks.filter((t) => DONE.has(t.status)).map((t) => ({ task_id: t.id, title: t.title }));
  const remaining = tasks.filter((t) => !DONE.has(t.status)).map((t) => ({ task_id: t.id, title: t.title, status: t.status }));
  const failures = input.steps.filter((s) => s.outcome === "failed").slice(-15).map((s) => ({ task_id: s.task_id, resource: s.resource_ref, category: s.failure_category, error: (s.error ?? "").slice(0, 200), at: s.created_at }));
  const assignments: Record<string, string | null> = {};
  for (const t of tasks) assignments[t.id] = lastStepByTask.get(t.id)?.resource_ref ?? null;
  const artifacts = input.projects.filter((p) => p.final_output).map((p) => ({ project_id: p.id, kind: "final_output", chars: String(p.final_output).length }));

  const c = input.contract ?? {};
  const understanding = { objective_type: c.objective_type ?? null, intent: c.intent ?? null, requirements: c.requirements ?? [], constraints: c.constraints ?? [], deliverables: c.deliverables ?? [], risk_level: c.risk_level ?? null, founder_approval_required: c.founder_approval_required ?? null };

  let phase: Phase;
  if (input.objectiveStatus === "completed") phase = "completed";
  else if (input.objectiveStatus === "failed") phase = "failed";
  else if (input.objectiveStatus === "awaiting_approval") phase = "blocked";
  else if (!latestProjectId || tasks.length === 0) phase = "planning";
  else if (tasks.some((t) => /^Rectify:/i.test(t.title) && !DONE.has(t.status))) phase = "rectifying";
  else if (tasks.some((t) => ACTIVE.has(t.status) || t.status === "pending" || t.status === "rework")) phase = "executing";
  else phase = "verifying";

  return {
    phase,
    patch: {
      understanding,
      success_criteria: Array.isArray(c.acceptance_criteria) ? c.acceptance_criteria : [],
      plan, completed_work: completed, remaining_work: remaining, failures,
      resource_assignments: assignments, artifacts, replan_count: Math.max(0, input.projects.length - 1),
    },
  };
}

export interface StateRow { phase: Phase; state_version: number; rectification_round: number; verification: Record<string, unknown> }

export async function readObjectiveState(db: Db, objectiveId: string): Promise<StateRow | null> {
  const { data } = await db.from("fkaios_objective_state").select("phase,state_version,rectification_round,verification").eq("objective_id", objectiveId).maybeSingle();
  return (data ?? null) as StateRow | null;
}

/**
 * Applies a target phase and patch with compare-and-swap, stepping through
 * intermediate phases when the target is not directly reachable. Retries once
 * on a stale version (another writer got there first) by re-reading.
 */
export async function applyObjectiveState(db: Db, objectiveId: string, target: Phase, patch: Record<string, unknown>, reason: string): Promise<{ ok: boolean; version?: number; error?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await readObjectiveState(db, objectiveId);
    try {
      if (!current) {
        const { data, error } = await db.rpc("fkaios_objective_state_apply", { p_objective_id: objectiveId, p_expected_version: null, p_phase: target, p_patch: patch, p_reason: reason });
        if (error) throw new Error(error.message);
        return { ok: true, version: data as number };
      }
      const path = phasePath(current.phase, target);
      if (path === null) return { ok: false, error: `no legal path ${current.phase} -> ${target}` };
      let version = current.state_version;
      const steps: Array<Phase | null> = path.length ? path : [null];
      for (let i = 0; i < steps.length; i++) {
        const last = i === steps.length - 1;
        const { data, error } = await db.rpc("fkaios_objective_state_apply", {
          p_objective_id: objectiveId, p_expected_version: version, p_phase: steps[i],
          p_patch: last ? patch : {}, p_reason: last ? reason : `${reason} (via ${steps[i]})`,
        });
        if (error) throw new Error(error.message);
        version = data as number;
      }
      return { ok: true, version };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0 && /stale_state/.test(msg)) continue;
      return { ok: false, error: msg };
    }
  }
  return { ok: false, error: "stale_state after retry" };
}

/** Rebuilds the snapshot from the tables of record and writes it. Non-blocking for callers. */
export async function syncObjectiveState(db: Db, objective: { id: string; status: string; raw_request?: string }, override?: { phase?: Phase; reason?: string; patch?: Record<string, unknown> }): Promise<{ ok: boolean; phase?: Phase; error?: string }> {
  try {
    const [{ data: contract }, { data: projects }] = await Promise.all([
      db.from("objective_contracts").select("objective_type,intent,requirements,acceptance_criteria,constraints,deliverables,risk_level,founder_approval_required").eq("objective_id", objective.id).order("version", { ascending: false }).limit(1).maybeSingle(),
      db.from("orchestration_projects").select("id,created_at,final_output").like("request", `[objective:${objective.id}]%`).order("created_at", { ascending: false }),
    ]);
    const projectIds = ((projects ?? []) as Array<{ id: string }>).map((p) => p.id);
    const { data: tasks } = projectIds.length
      ? await db.from("orchestration_tasks").select("id,title,status,project_id,created_at,attempts").in("project_id", projectIds)
      : { data: [] };
    const { data: steps } = await db.from("fkaios_execution_steps").select("task_id,resource_ref,outcome,failure_category,error,verification_status,created_at")
      .eq("objective_id", objective.id).order("created_at", { ascending: false }).limit(200);
    const snap = deriveSnapshot({ objectiveStatus: objective.status, contract: contract ?? null, projects: (projects ?? []) as Array<{ id: string }>, tasks: (tasks ?? []) as TaskFact[], steps: (steps ?? []) as StepFact[] });
    const phase = override?.phase ?? snap.phase;
    const currentState = await readObjectiveState(db, objective.id);
    const incomingPatch = { ...(override?.patch ?? {}) };
    const currentDeadlineStart = currentState?.verification?.deadline_started_at;
    if (typeof currentDeadlineStart === "string") {
      const incomingVerification = incomingPatch.verification && typeof incomingPatch.verification === "object"
        ? incomingPatch.verification as Record<string, unknown>
        : {};
      incomingPatch.verification = {
        ...(currentState?.verification ?? {}),
        ...incomingVerification,
        deadline_started_at: currentDeadlineStart,
      };
    }
    const patch = { objective: objective.raw_request ?? undefined, ...snap.patch, ...incomingPatch };
    if (patch.objective === undefined) delete (patch as Record<string, unknown>).objective;
    const res = await applyObjectiveState(db, objective.id, phase, patch, override?.reason ?? `sync: ${phase}`);
    return { ok: res.ok, phase, error: res.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
