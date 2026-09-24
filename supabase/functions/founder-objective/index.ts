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
//
// Service callers (e.g. Rajeev AI's server, which has no FKAIOS user
// session): the platform's own JWT check stays on (Authorization must
// still be a valid Supabase-issued token — the publishable anon key
// works, since it is one). A SEPARATE header, X-Fkaios-Service-Token,
// is compared against the FKAIOS_SERVICE_TOKEN secret; a match unlocks
// ONLY the read-only brain_context action, no founder session needed.
// Objective submission and rerun always require a real signed-in founder
// session below — a leaked service token can read the Brain, never spend
// budget or create work. Unset (the default) disables this path entirely.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { assessRisk, createTask, routeToDepartment } from "../_shared/founder-brain.ts";
import { summarizeObjectiveProgress } from "../_shared/objective-progress.ts";
import { canRerun, FOUNDER_OBJECTIVE_CLASSIFICATION, rerunUpdate } from "../_shared/objective-rerun.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Fkaios-Service-Token",
};

const MIN_OBJECTIVE_CHARS = 10;
const MAX_OBJECTIVE_CHARS = 2000;
const STATUS_LIST_LIMIT = 5;
const MIN_TOPIC_CHARS = 2;
const MAX_TOPIC_CHARS = 200;

// Read-only status for the Command Center: the objective rows plus progress
// derived from their real tasks and jobs. Uses the service role so the
// founder sees progress regardless of per-table RLS, after the same auth
// check as submission. Never returns task output (see objective-progress.ts).
function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
      .select("id").like("request", `[objective:${objective.id}]%`).order("created_at", { ascending: false });
    const latestProjectId = projects?.[0]?.id;
    let tasks: Record<string, unknown>[] = [];
    let jobs: Record<string, unknown>[] = [];
    if (latestProjectId) {
      const { data: taskRows } = await admin.from("orchestration_tasks")
        .select("id, title, description, status, output").eq("project_id", latestProjectId);
      tasks = taskRows ?? [];
      const taskIds = tasks.map((t) => String(t.id));
      if (taskIds.length > 0) {
        const { data: jobRows } = await admin.from("ai_jobs")
          .select("status, retry_count, payload").eq("type", "work_engine_task").in("payload->>task_id", taskIds);
        jobs = jobRows ?? [];
      }
    }
    return { ...objective, progress: summarizeObjectiveProgress(projects?.length ?? 0, tasks, jobs) };
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

    let body: { objective?: unknown; action?: unknown; objectiveId?: unknown; topic?: unknown };
    try { body = await req.json(); } catch { return json({ ok: false, error: "Body must be JSON" }, 400); }

    // Service-to-service path: a matching X-Fkaios-Service-Token header
    // grants brain_context ONLY, no founder session needed. The
    // Authorization header above must still be a valid Supabase JWT
    // (platform-enforced) — the caller sends the publishable anon key.
    // Everything else falls through to the normal user-JWT check below.
    const serviceHeader = req.headers.get("X-Fkaios-Service-Token") ?? "";
    const serviceToken = Deno.env.get("FKAIOS_SERVICE_TOKEN") ?? "";
    if (serviceToken && serviceHeader && serviceHeader === serviceToken) {
      if (body.action !== "brain_context") {
        return json({ ok: false, error: "Service token may only call brain_context" }, 403);
      }
      const topic = typeof body.topic === "string" ? body.topic.trim() : "";
      if (topic.length < MIN_TOPIC_CHARS || topic.length > MAX_TOPIC_CHARS) {
        return json({ ok: false, error: `topic must be ${MIN_TOPIC_CHARS}-${MAX_TOPIC_CHARS} characters` }, 400);
      }
      const { data, error } = await adminClient().rpc("fkaios_brain_context", { topic });
      if (error) return json({ ok: false, error: `brain context failed: ${error.message}` }, 500);
      return json({ ok: true, context: data });
    }

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

    if (body.action === "status") {
      const objectiveId = typeof body.objectiveId === "string" ? body.objectiveId : null;
      return json({ ok: true, objectives: await readObjectiveStatus(objectiveId) });
    }
    // Rajeev AI / Command Center: what FKAIOS already knows about a topic
    // (objectives, tasks, knowledge with provenance, research, handoffs,
    // capabilities) from the canonical Brain, fkaios_brain_context().
    if (body.action === "brain_context") {
      const topic = typeof body.topic === "string" ? body.topic.trim() : "";
      if (topic.length < MIN_TOPIC_CHARS || topic.length > MAX_TOPIC_CHARS) {
        return json({ ok: false, error: `topic must be ${MIN_TOPIC_CHARS}-${MAX_TOPIC_CHARS} characters` }, 400);
      }
      const { data, error } = await adminClient().rpc("fkaios_brain_context", { topic });
      if (error) return json({ ok: false, error: `brain context failed: ${error.message}` }, 500);
      return json({ ok: true, context: data });
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
