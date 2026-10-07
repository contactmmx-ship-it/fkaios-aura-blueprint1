// founder-objective — the Command Center's front door into the EXISTING
// objective pipeline. Not a new objective system: it runs the same three
// steps cognitiveTick's Assign stage already runs (assessRisk ->
// routeToDepartment -> createTask), so a Founder-typed objective lands in
// orchestrator_requests exactly like a Brain-generated one
// (requested_by:'founder-brain', status 'processing' or 'awaiting_approval'
// with a real `approvals` row for high/critical risk). From there the
// existing founder-brain-tick cron (runObjectiveLoop -> planObjective ->
// allocateProjectWork -> ai-engine -> evaluateObjective) takes over.
//
// Before this function, nothing reachable from the browser could call
// createTask(): the console only READ orchestrator_requests.
//
// Auth: the caller's Supabase access token is verified server-side with
// auth.getUser() (signature + expiry checked by Supabase Auth, not a bare
// base64 decode). If FOUNDER_EMAILS (comma-separated) is set, only those
// accounts may submit; unset means any signed-in console user, the same
// bar the rest of /console already uses. The service-role key never
// leaves this function.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { assessRisk, createTask, routeToDepartment } from "../_shared/founder-brain.ts";
import { summarizeObjectiveProgress } from "../_shared/objective-progress.ts";
import { canRerun, FOUNDER_OBJECTIVE_CLASSIFICATION, rerunUpdate } from "../_shared/objective-rerun.ts";
import { runObjectiveLoop } from "../_shared/objective-loop.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MIN_OBJECTIVE_CHARS = 10;
const MAX_OBJECTIVE_CHARS = 2000;
const STATUS_LIST_LIMIT = 5;

// Read-only status for the Command Center: the objective rows plus progress
// derived from their real tasks and jobs. Uses the service role so the
// founder sees progress regardless of per-table RLS, after the same auth
// check as submission. Never returns task output (see objective-progress.ts).
function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readLiveExecution(admin: ReturnType<typeof adminClient>, objectiveId: string, objectiveStatus: string, tasks: Record<string, unknown>[], jobs: Record<string, unknown>[]) {
  const [{ data: controller }, { data: workPackages }, { data: handoffs }, { data: solutions }] = await Promise.all([
    admin.from("fkaios_controller_state").select("tick_count,last_tick_at,next_action,next_requirement_description,next_requirement_status,open_requirement_count,human_blocked_count,verified_count,total_count,objective_state,active_run_count,available_workers,pending_worker_allocation_count,latest_open_handoff_id").eq("objective_id", objectiveId).maybeSingle(),
    admin.from("work_packages").select("id,sequence,task_type,status,selected_provider,state,handoff_notes,updated_at,created_at").eq("objective_id", objectiveId).order("sequence", { ascending: true }),
    admin.from("provider_handoffs").select("id,work_package_id,from_provider,to_provider,reason,status,attempt,created_at,updated_at").eq("objective_id", objectiveId).order("created_at", { ascending: false }).limit(10),
    admin.from("objective_solution_options").select("source_type,source_id,name,score,rank,recommendation,selected,fit_score,quality_score,availability_score,cost_score,risk_score,created_at").eq("objective_id", objectiveId).order("score", { ascending: false }).limit(10),
  ]);
  const activeTask = tasks.find((t) => ["assigned","running","working"].includes(String(t.status ?? "")));
  const pendingTask = tasks.find((t) => String(t.status ?? "") === "pending");
  const activeJob = activeTask ? jobs.find((j) => String((j.payload as Record<string, unknown> | null)?.task_id ?? "") === String(activeTask.id ?? "") && ["pending","running","retry"].includes(String(j.status ?? ""))) : undefined;
  const activeWp = (workPackages ?? []).find((w) => ["running","handoff","blocked"].includes(String(w.status ?? ""))) ?? (workPackages ?? []).find((w) => String(w.status ?? "") === "ready");
  const failedTasks = tasks.filter((t) => ["failed","rework"].includes(String(t.status ?? ""))).map((t) => ({ title: String(t.title ?? "Task"), status: String(t.status ?? ""), reason: typeof t.output === "string" ? t.output.slice(0, 500) : null }));
  const lastTimes = [controller?.last_tick_at, ...((workPackages ?? []).map((w) => w.updated_at)), ...((handoffs ?? []).map((h) => h.updated_at)), ...jobs.map((j) => j.created_at)].filter(Boolean).map((x) => new Date(String(x)).getTime()).filter(Number.isFinite);
  const lastActivityAt = lastTimes.length ? new Date(Math.max(...lastTimes)).toISOString() : null;
  const { data: contractRow } = await admin.from("objective_contracts").select("status").eq("objective_id", objectiveId).maybeSingle();
  const cs = String(contractRow?.status ?? "");
  let stage = "Accepted";
  if (objectiveStatus === "completed") stage = "Completed";
  else if (objectiveStatus === "failed") stage = "Failed";
  else if (objectiveStatus === "awaiting_approval") stage = "Blocked";
  else if (cs === "draft") stage = "Contracting";
  else if (!workPackages?.length) stage = "Planning";
  else if (activeTask || activeJob || activeWp?.status === "running") stage = "Executing";
  else if ((workPackages ?? []).some((w) => String(w.status ?? "") === "handoff")) stage = "Handing off";
  else if ((workPackages ?? []).some((w) => String(w.status ?? "") === "blocked") || Number(controller?.human_blocked_count ?? 0) > 0) stage = "Blocked";
  else if ((workPackages ?? []).length && (workPackages ?? []).every((w) => ["completed","failed"].includes(String(w.status ?? "")))) stage = "Verifying";
  else if ((workPackages ?? []).length) stage = "Planning";
  const currentAction = activeJob?.status === "running" ? "Executing " + String(activeTask?.title ?? activeWp?.task_type ?? "work") :
    activeJob?.status === "retry" ? "Retrying " + String(activeTask?.title ?? activeWp?.task_type ?? "work") :
    activeTask ? "Working on " + String(activeTask.title ?? "current task") :
    activeWp?.status === "handoff" ? "Handing off " + String(activeWp.task_type ?? "work") :
    activeWp?.status === "blocked" ? "Blocked on " + String(activeWp.task_type ?? "work") :
    pendingTask ? "Queued: " + String(pendingTask.title ?? "next task") :
    String(controller?.next_action ?? "Evaluating objective against the contract");
  const nextAction = pendingTask ? "Execute next: " + String(pendingTask.title ?? "pending task") : String(controller?.next_action ?? "Verify the completed work against the objective contract");
  return {
    stage, current_action: currentAction, next_action: nextAction,
    current_task: activeTask ? String(activeTask.title ?? "") : activeWp ? String(activeWp.task_type ?? "") : null,
    current_provider: activeWp?.selected_provider ? String(activeWp.selected_provider) : null,
    last_activity_at: lastActivityAt, controller: controller ?? null,
    work_packages: (workPackages ?? []).map((w) => ({ id: String(w.id), sequence: Number(w.sequence ?? 0), task_type: String(w.task_type ?? ""), status: String(w.status ?? ""), selected_provider: w.selected_provider ? String(w.selected_provider) : null, updated_at: w.updated_at ?? null })),
    handoffs: (handoffs ?? []).map((h) => ({ id: String(h.id), from_provider: h.from_provider ?? null, to_provider: h.to_provider ?? null, reason: String(h.reason ?? ""), status: String(h.status ?? ""), attempt: Number(h.attempt ?? 1), created_at: h.created_at ?? null, updated_at: h.updated_at ?? null })),
    solution_options: (solutions ?? []).map((s) => ({ source_type: String(s.source_type ?? ""), name: String(s.name ?? ""), score: Number(s.score ?? 0), selected: Boolean(s.selected), recommendation: s.recommendation ?? null })),
    blockers: failedTasks.concat((workPackages ?? []).filter((w) => String(w.status ?? "") === "blocked").map((w) => ({ title: String(w.task_type ?? "Work package"), status: "blocked", reason: String(w.handoff_notes ?? "Work package is blocked") }))),
  };
}

// Lists only objectives submitted here (classification marks them); the
// Founder Brain also creates requested_by='founder-brain' rows every tick,
// which would otherwise push the founder's own objectives off the list.
async function readObjectiveStatus(objectiveId: string | null) {
  const admin = adminClient();
  let query = admin.from("orchestrator_requests")
    .select("id, raw_request, status, action_taken, result_summary, risk_level, department_code, created_at")
    .eq("requested_by", "founder-brain")
    .eq("classification", FOUNDER_OBJECTIVE_CLASSIFICATION)
    .order("created_at", { ascending: false })
    .limit(STATUS_LIST_LIMIT);
  if (objectiveId) query = query.eq("id", objectiveId);
  const { data: objectives, error } = await query;
  if (error) throw new Error(`status read failed: ${error.message}`);

  return await Promise.all((objectives ?? []).map(async (objective) => {
    const { data: projects } = await admin.from("orchestration_projects")
      .select("id, status, created_at")
      .like("request", `[objective:${objective.id}]%`)
      .order("created_at", { ascending: false });

    // Terminal objectives must report work from the project that actually
    // reached the same terminal state. A re-planning pass can leave newer
    // historical projects in "working"/"assigned" state; selecting the newest
    // project unconditionally made the Console say COMPLETED while also saying
    // "0/2 tasks completed" or "tasks still in progress". The objective row is
    // authoritative for terminal state, so prefer the matching terminal
    // project; only processing/blocked objectives use the newest project.
    const objectiveStatus = String(objective.status ?? "");
    const terminalProjectStatus =
      objectiveStatus === "completed" ? "complete" :
      objectiveStatus === "failed" ? "failed" :
      null;
    const selectedProject = terminalProjectStatus
      ? (projects ?? []).find((p) => String(p.status ?? "") === terminalProjectStatus) ?? projects?.[0]
      : projects?.[0];
    const selectedProjectId = selectedProject?.id;
    let tasks: Record<string, unknown>[] = [];
    let jobs: Record<string, unknown>[] = [];
    if (selectedProjectId) {
      const { data: taskRows } = await admin.from("orchestration_tasks")
        .select("id, title, description, status, output").eq("project_id", selectedProjectId);
      tasks = taskRows ?? [];
      const taskIds = tasks.map((t) => String(t.id));
      if (taskIds.length > 0) {
        const { data: jobRows } = await admin.from("ai_jobs")
          .select("status, retry_count, payload, created_at").eq("type", "work_engine_task").in("payload->>task_id", taskIds);
        jobs = jobRows ?? [];
      }
    }
    const progress = summarizeObjectiveProgress(projects?.length ?? 0, tasks, jobs) as Record<string, unknown>;
    const { data: contract } = await admin.from("objective_contracts")
      .select("objective_type,intent,requirements,acceptance_criteria,quality_benchmark,discovery,solution_plan,continuity,status,created_at,updated_at")
      .eq("objective_id", objective.id)
      .maybeSingle();
    if (contract) progress.contract = contract;
    // Completed objectives need the actual deliverable/evidence in the Console.
    // Processing responses stay lightweight; terminal completed responses may
    // include the already-recorded task output so the founder can inspect the
    // finished result without leaving the objective record.
    if (objectiveStatus === "completed") {
      // Keep the evidence assessor authoritative. A terminal objective must
      // never manufacture "verified" task verdicts in the UI.
      progress.tasks = tasks.map((task) => {
        const existing = (progress.tasks as Array<Record<string, unknown>> | undefined)?.find((t) => String(t.title ?? "") === String(task.title ?? ""));
        return existing ?? { title: String(task.title ?? "Completed task"), status: String(task.status ?? ""), verdict: "incomplete" };
      });
    }
    progress.live = await readLiveExecution(admin, String(objective.id), objectiveStatus, tasks, jobs);
    return { ...objective, progress };
  }));
}

// Re-run a BLOCKED or FAILED objective submitted here. Only flips the row
// to processing with the re-run flag; the objective loop does the planning.
async function requestRerun(objectiveId: string): Promise<{ ok: boolean; error?: string; status?: number }> {
  const admin = adminClient();
  const { data: row, error } = await admin.from("orchestrator_requests")
    .select("id, status, action_taken, classification")
    .eq("id", objectiveId)
    .eq("requested_by", "founder-brain")
    .maybeSingle();
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!row || row.classification !== FOUNDER_OBJECTIVE_CLASSIFICATION) return { ok: false, error: "Objective not found", status: 404 };
  if (!canRerun(row)) return { ok: false, error: `Objective is ${row.status}; only a blocked or failed objective can be re-run`, status: 409 };
  const { error: updateError } = await admin.from("orchestrator_requests")
    .update(rerunUpdate(new Date().toISOString()))
    .eq("id", objectiveId)
    .eq("status", row.status);
  if (updateError) return { ok: false, error: updateError.message, status: 500 };
  return { ok: true };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const correlationId = crypto.randomUUID().slice(0, 8);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ ok: false, error: "Sign in required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return json({ ok: false, error: "Invalid or expired session" }, 401);

    const allowList = (Deno.env.get("FOUNDER_EMAILS") ?? "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (allowList.length > 0 && !allowList.includes((user.email ?? "").toLowerCase())) {
      return json({ ok: false, error: "This account is not allowed to submit objectives" }, 403);
    }

    let body: { objective?: unknown; action?: unknown; objectiveId?: unknown };
    try { body = await req.json(); } catch { return json({ ok: false, error: "Body must be JSON" }, 400); }

    if (body.action === "status" || body.action === "refresh") {
      const objectiveId = typeof body.objectiveId === "string" ? body.objectiveId : null;
      // status performs one immediate reconciliation; refresh is read-only
      // so the Console can poll without repeatedly running the worker pipeline.
      if (body.action === "status") {
        try {
          await runObjectiveLoop(correlationId);
          const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
          if (supabaseUrl && serviceRoleKey) {
            const workerResponse = await fetch(`${supabaseUrl}/functions/v1/ai-engine/run_jobs`, {
              method: "POST",
              headers: { "Authorization": `Bearer ${serviceRoleKey}`, "apikey": serviceRoleKey, "Content-Type": "application/json", "X-Correlation-ID": crypto.randomUUID().slice(0, 8) },
              body: JSON.stringify({}),
            });
            if (!workerResponse.ok) console.error("founder-objective: ai-engine worker drain returned HTTP error", workerResponse.status);
          }
          await runObjectiveLoop(correlationId);
        } catch (err) {
          console.error(JSON.stringify({ level: "WARN", message: "objective status continuation failed", source: "founder-objective", correlationId, objectiveId, error: err instanceof Error ? err.message : String(err) }));
        }
      }
      return json({ ok: true, objectives: await readObjectiveStatus(objectiveId) });
    }
    if (body.action === "rerun") {
      if (typeof body.objectiveId !== "string" || !body.objectiveId) return json({ ok: false, error: "objectiveId required" }, 400);
      const rerun = await requestRerun(body.objectiveId);
      if (!rerun.ok) return json({ ok: false, error: rerun.error }, rerun.status ?? 500);
      console.log(JSON.stringify({ level: "INFO", message: "objective re-run requested", source: "founder-objective", correlationId, objectiveId: body.objectiveId, requestedBy: user.id }));
      return json({ ok: true, objectiveId: body.objectiveId, status: "processing" });
    }
    const objective = typeof body.objective === "string" ? body.objective.trim() : "";
    if (objective.length < MIN_OBJECTIVE_CHARS) return json({ ok: false, error: `Objective must be at least ${MIN_OBJECTIVE_CHARS} characters` }, 400);
    if (objective.length > MAX_OBJECTIVE_CHARS) return json({ ok: false, error: `Objective must be at most ${MAX_OBJECTIVE_CHARS} characters` }, 400);

    // Same order and functions as cognitiveTick's Assign stage.
    const riskLevel = await assessRisk(objective, correlationId);
    const departmentCode = await routeToDepartment(objective, correlationId);
    const result = await createTask("founder", { description: objective, department_code: departmentCode, risk_level: riskLevel }, correlationId);

    const row = result.data as { id?: string; status?: string } | null;
    if (result.status !== "success" || !row?.id) {
      console.error(JSON.stringify({ level: "ERROR", message: "createTask failed", source: "founder-objective", correlationId, error: result.error }));
      return json({ ok: false, error: "FKAIOS could not record the objective", correlationId }, 500);
    }

    // Mark it as a Command Center objective so the status list shows it.
    const { error: markError } = await adminClient().from("orchestrator_requests")
      .update({ classification: FOUNDER_OBJECTIVE_CLASSIFICATION }).eq("id", row.id);
    if (markError) console.error(JSON.stringify({ level: "WARN", message: "could not mark founder objective", source: "founder-objective", correlationId, objectiveId: row.id, error: markError.message }));

    console.log(JSON.stringify({ level: "INFO", message: "objective submitted", source: "founder-objective", correlationId, objectiveId: row.id, status: row.status, riskLevel, departmentCode, submittedBy: user.id }));
    return json({
      ok: true,
      objectiveId: row.id,
      status: row.status,
      riskLevel,
      departmentCode,
      correlationId,
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "ERROR", message: "founder-objective failed", source: "founder-objective", correlationId, error: err instanceof Error ? err.message : String(err) }));
    return json({ ok: false, error: "Unexpected server error", correlationId }, 500);
  }
});
