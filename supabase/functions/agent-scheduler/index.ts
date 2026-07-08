// agent-scheduler v27 — generic dispatcher over the agent_schedules table
// (cron/interval/event-based), distinct from heartbeat-engine's hardcoded
// scheduled_tasks. AUTH v27: added shared HEARTBEAT_SECRET path (additive,
// same pattern as heartbeat-engine/vault-engine) alongside the original
// service_role JWT / admin JWT checks.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Inlined from ../_shared/utils.ts — the deploy tool does not reliably
// resolve cross-file relative imports into subdirectories.
function generateCorrelationId(): string { return crypto.randomUUID().slice(0, 8); }
function structuredLog(level: string, message: string, data?: Record<string, unknown>, cid?: string): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, correlationId: cid || '', message, ...(data ? { data } : {}) }));
}
function errorResponse(message: string, status: number, details?: string, cid?: string): Response {
  structuredLog('ERROR', message, { status, details }, cid);
  return new Response(JSON.stringify({ error: message, ...(details ? { details } : {}), ...(cid ? { correlationId: cid } : {}) }), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE' } });
}
function successResponse(data: unknown, status = 200, cid?: string): Response {
  return new Response(JSON.stringify({ ...((data as Record<string, unknown>) || {}), ...(cid ? { correlationId: cid } : {}) }), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE' } });
}
function verifyEnvSecrets(required: Record<string, string | undefined>): string | null {
  const missing: string[] = [];
  for (const [name, value] of Object.entries(required)) { if (!value) missing.push(name); }
  return missing.length > 0 ? `Missing required secrets: ${missing.join(', ')}` : null;
}
async function verifyJWT(authHeader: string, supabaseUrl: string, supabaseAnonKey: string): Promise<{ userId: string; role: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { userId: payload.sub as string, role: (payload.user_role as string) || payload.role || 'authenticated' };
  } catch { return null; }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID, x-heartbeat-secret",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MAX_DISPATCHES_PER_TICK = 20;

// FIXED 2026-07-08: agent_schedules rows created with a cron_expression
// (e.g. "0 9,14,19 * * *") but no next_run_at were NEVER being picked up —
// the due-schedules query requires next_run_at to be non-null. Nothing in
// this system ever converted cron_expression into next_run_at, so every
// schedule using it (most of the 41 agents populated in the workforce-depth
// pass) has never fired, ever. This isn't a one-day blip — confirmed via
// agent_schedules.created_at vs agent_dispatch_log activity. Supports the
// exact pattern actually in use: "M H1,H2,H3 * * *" (minute, comma-separated
// hour list, every day) — the only shape these schedules use. Fails loudly
// (returns null, logged) rather than silently guessing for anything else.
function computeNextRunFromCron(cronExpr: string, from: Date): Date | null {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minStr, hourStr, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*" || dow !== "*") return null; // unsupported shape, fail loudly not silently
  const minute = parseInt(minStr, 10);
  const hours = hourStr.split(",").map((h) => parseInt(h, 10)).filter((h) => !Number.isNaN(h)).sort((a, b) => a - b);
  if (Number.isNaN(minute) || hours.length === 0) return null;

  const candidates: Date[] = [];
  for (const h of hours) {
    const todayRun = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), h, minute, 0));
    candidates.push(todayRun);
    const tomorrowRun = new Date(todayRun.getTime() + 86400000);
    candidates.push(tomorrowRun);
  }
  const future = candidates.filter((d) => d.getTime() > from.getTime()).sort((a, b) => a.getTime() - b.getTime());
  return future[0] ?? null;
}

async function backfillCronNextRunAt(cid: string): Promise<number> {
  const { data: unset, error } = await supabase
    .from("agent_schedules")
    .select("id, cron_expression, next_run_at")
    .eq("is_active", true)
    .not("cron_expression", "is", null)
    .is("next_run_at", null);
  if (error || !unset || unset.length === 0) return 0;

  let fixed = 0;
  const now = new Date();
  for (const s of unset) {
    const next = computeNextRunFromCron(s.cron_expression as string, now);
    if (!next) {
      structuredLog("WARN", "Could not parse cron_expression, leaving next_run_at null", { scheduleId: s.id, cronExpr: s.cron_expression }, cid);
      continue;
    }
    const { error: updErr } = await supabase.from("agent_schedules").update({ next_run_at: next.toISOString() }).eq("id", s.id);
    if (!updErr) fixed++;
  }
  if (fixed > 0) structuredLog("INFO", `Backfilled next_run_at for ${fixed} cron_expression schedule(s) that were never able to fire`, {}, cid);
  return fixed;
}

function resolveEdgeFunctionName(task: string): string | null {
  const taskToFunction: Record<string, string> = {
    QUALIFY_LEAD: "ai-engine",
    CLOSE_DEAL: "closer-engine",
    HANDLE_OBJECTION: "closer-engine",
    GENERATE_INVOICE: "invoice-pdf",
    SCHEDULE_MEETING: "meeting-scheduler",
    GENERATE_PROPOSAL: "document-engine",
    CAPTURE_LEADS: "ai-engine",
    LINKEDIN_OUTREACH: "linkedin-outbound",
    WHATSAPP_OUTREACH: "whatsapp-outbound",
    GENERATE_REPORT: "reporting-engine",
    OPS_INTELLIGENCE: "ops-intelligence",
    MIS_REPORT: "mis-engine",
  };
  return taskToFunction[task] ?? null;
}

function isServiceRoleAuth(authHeader: string): boolean {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

interface TickDispatchResult {
  scheduleId: string;
  agentName: string;
  dispatchId: string | null;
  status: "dispatched" | "completed" | "failed";
  error?: string;
  durationMs: number;
}

async function dispatchSchedule(
  schedule: Record<string, unknown>,
  agent: Record<string, unknown>,
  cid: string,
): Promise<TickDispatchResult> {
  const startTime = Date.now();

  const { data: dispatch, error: dispatchErr } = await supabase
    .from("agent_dispatch_log")
    .insert({
      schedule_id: schedule.id,
      agent_id: agent.id,
      brand_id: schedule.brand_id ?? null,
      lifecycle_stage_id: schedule.lifecycle_stage_id ?? null,
      action: `scheduled_${schedule.schedule_type}`,
      input_data: schedule.conditions ?? {},
      status: "dispatched",
    })
    .select("id")
    .single();

  if (dispatchErr || !dispatch) {
    structuredLog("ERROR", "Failed to create dispatch log in tick", { error: dispatchErr?.message, scheduleId: schedule.id }, cid);
    return { scheduleId: schedule.id as string, agentName: (agent.name as string) ?? "unknown", dispatchId: null, status: "failed", error: dispatchErr?.message ?? "Failed to create dispatch log", durationMs: Date.now() - startTime };
  }

  const dispatchId = dispatch.id;
  await supabase.from("agent_dispatch_log").update({ status: "running" }).eq("id", dispatchId);

  const task = (agent.task as string) ?? "";
  const functionName = resolveEdgeFunctionName(task);

  if (functionName) {
    try {
      const functionUrl = `${supabaseUrl}/functions/v1/${functionName}`;
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceRoleKey}`, "X-Correlation-ID": cid },
        body: JSON.stringify({ action: `scheduled_run_${schedule.schedule_type}`, agent_id: agent.id, schedule_id: schedule.id, brand_id: schedule.brand_id ?? null, ...(schedule.conditions as Record<string, unknown> ?? {}) }),
      });

      const durationMs = Date.now() - startTime;

      if (response.ok) {
        const responseData = await response.json() as Record<string, unknown>;
        await supabase.from("agent_dispatch_log").update({ status: "completed", output_data: responseData, duration_ms: durationMs, tokens_used: responseData.tokens_used ? Number(responseData.tokens_used) : null, cost_usd: responseData.cost_usd ? Number(responseData.cost_usd) : null }).eq("id", dispatchId);
        structuredLog("INFO", `Tick dispatch completed via ${functionName}`, { scheduleId: schedule.id, agentName: agent.name, durationMs }, cid);
        return { scheduleId: schedule.id as string, agentName: (agent.name as string) ?? "unknown", dispatchId, status: "completed", durationMs };
      } else {
        const errorText = await response.text();
        await supabase.from("agent_dispatch_log").update({ status: "failed", error_message: `Edge function ${functionName} returned ${response.status}: ${errorText.slice(0, 500)}`, duration_ms: durationMs }).eq("id", dispatchId);
        structuredLog("ERROR", `Tick dispatch failed: ${functionName} returned ${response.status}`, { scheduleId: schedule.id, error: errorText.slice(0, 200) }, cid);
        return { scheduleId: schedule.id as string, agentName: (agent.name as string) ?? "unknown", dispatchId, status: "failed", error: `${functionName} returned ${response.status}`, durationMs };
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      await supabase.from("agent_dispatch_log").update({ status: "failed", error_message: errorMsg, duration_ms: durationMs }).eq("id", dispatchId);
      structuredLog("ERROR", `Tick dispatch exception for schedule ${schedule.id}`, { error: errorMsg }, cid);
      return { scheduleId: schedule.id as string, agentName: (agent.name as string) ?? "unknown", dispatchId, status: "failed", error: errorMsg, durationMs };
    }
  }

  try {
    const { data: job, error: jobErr } = await supabase.from("ai_jobs").insert({ agent_id: agent.id, type: `scheduled_${schedule.schedule_type}`, payload: { schedule_id: schedule.id, brand_id: schedule.brand_id ?? null, ...(schedule.conditions as Record<string, unknown> ?? {}) }, status: "pending" }).select("id").single();
    const durationMs = Date.now() - startTime;
    if (jobErr || !job) {
      await supabase.from("agent_dispatch_log").update({ status: "failed", error_message: `Failed to create ai_job: ${jobErr?.message}`, duration_ms: durationMs }).eq("id", dispatchId);
      return { scheduleId: schedule.id as string, agentName: (agent.name as string) ?? "unknown", dispatchId, status: "failed", error: jobErr?.message ?? "Failed to create ai_job", durationMs };
    }
    await supabase.from("agent_dispatch_log").update({ job_id: job.id, status: "dispatched", output_data: { queued: true, job_id: job.id }, duration_ms: durationMs }).eq("id", dispatchId);
    structuredLog("INFO", `Tick dispatch queued as ai_job`, { scheduleId: schedule.id, agentName: agent.name, jobId: job.id, durationMs }, cid);
    return { scheduleId: schedule.id as string, agentName: (agent.name as string) ?? "unknown", dispatchId, status: "dispatched", durationMs };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    await supabase.from("agent_dispatch_log").update({ status: "failed", error_message: errorMsg, duration_ms: durationMs }).eq("id", dispatchId);
    return { scheduleId: schedule.id as string, agentName: (agent.name as string) ?? "unknown", dispatchId, status: "failed", error: errorMsg, durationMs };
  }
}

async function handleTick(cid: string): Promise<Response> {
  structuredLog("INFO", "Agent scheduler tick: starting", {}, cid);

  const backfilled = await backfillCronNextRunAt(cid);

  const { data: dueSchedules, error: schedErr } = await supabase
    .from("agent_schedules")
    .select(`id, agent_id, agent:ai_agents(id, name, task, dept, is_active), schedule_type, cron_expression, interval_seconds, event_trigger, lifecycle_stage_id, brand_id, conditions, max_retries, failure_count, run_count`)
    .eq("is_active", true)
    .not("next_run_at", "is", null)
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(MAX_DISPATCHES_PER_TICK);

  if (schedErr) {
    structuredLog("ERROR", "Failed to query due schedules", { error: schedErr.message }, cid);
    return errorResponse(`Failed to query due schedules: ${schedErr.message}`, 500, undefined, cid);
  }

  if (!dueSchedules || dueSchedules.length === 0) {
    structuredLog("INFO", "No due schedules found", {}, cid);
    return successResponse({ success: true, processed: 0, dispatched: 0, failed: 0, deactivated: 0, message: "No schedules are currently due" }, 200, cid);
  }

  structuredLog("INFO", `Found ${dueSchedules.length} due schedules to process`, {}, cid);

  let processed = 0, dispatched = 0, failed = 0, deactivated = 0;
  const results: Array<{ schedule_id: string; agent_name: string; status: string; dispatch_id: string | null; error?: string; deactivated: boolean }> = [];

  for (const schedule of dueSchedules) {
    const agent = schedule.agent as { id: string; name: string; task: string; dept: string; is_active: boolean } | null;
    processed++;

    if (!agent) {
      structuredLog("WARN", "Schedule references non-existent agent, skipping", { scheduleId: schedule.id, agentId: schedule.agent_id }, cid);
      failed++;
      results.push({ schedule_id: schedule.id as string, agent_name: "unknown (deleted)", status: "failed", dispatch_id: null, error: "Agent not found", deactivated: false });
      continue;
    }

    if (!agent.is_active) {
      structuredLog("WARN", "Agent is inactive, skipping schedule", { scheduleId: schedule.id, agentName: agent.name }, cid);
      failed++;
      results.push({ schedule_id: schedule.id as string, agent_name: agent.name, status: "skipped", dispatch_id: null, error: "Agent is inactive", deactivated: false });
      continue;
    }

    const newRunCount = ((schedule.run_count as number) ?? 0) + 1;
    // FIX (continued): the cron parser deferred above now exists — use it
    // here too so cron_expression schedules advance correctly after firing,
    // not just get a one-time backfill.
    const intervalSecs = (schedule.interval_seconds as number) ?? null;
    let nextRunAt: string | null = null;
    if (schedule.schedule_type === "interval" && intervalSecs) {
      nextRunAt = new Date(Date.now() + intervalSecs * 1000).toISOString();
    } else if (schedule.cron_expression) {
      const computed = computeNextRunFromCron(schedule.cron_expression as string, new Date());
      nextRunAt = computed ? computed.toISOString() : null;
    }
    const { error: updateErr } = await supabase.from("agent_schedules").update({ run_count: newRunCount, last_run_at: new Date().toISOString(), ...(nextRunAt ? { next_run_at: nextRunAt } : {}) }).eq("id", schedule.id);

    if (updateErr) {
      structuredLog("ERROR", "Failed to update schedule (run_count + last_run_at)", { error: updateErr.message, scheduleId: schedule.id }, cid);
      failed++;
      results.push({ schedule_id: schedule.id as string, agent_name: agent.name, status: "failed", dispatch_id: null, error: updateErr.message, deactivated: false });
      continue;
    }

    const dispatchResult = await dispatchSchedule(schedule, agent, cid);

    if (dispatchResult.status === "failed") {
      const newFailureCount = ((schedule.failure_count as number) ?? 0) + 1;
      const maxRetries = (schedule.max_retries as number) ?? 3;
      const shouldDeactivate = newFailureCount >= maxRetries;

      await supabase.from("agent_schedules").update({ failure_count: newFailureCount, is_active: !shouldDeactivate }).eq("id", schedule.id);

      if (shouldDeactivate) {
        deactivated++;
        structuredLog("WARN", `Schedule DEACTIVATED: exceeded max_retries (${maxRetries})`, { scheduleId: schedule.id, agentName: agent.name, failureCount: newFailureCount }, cid);
        await supabase.from("agent_activity_log").insert({ agent_id: agent.id, activity_type: "system", title: `Schedule auto-deactivated: ${schedule.schedule_type}`, description: `Exceeded max_retries (${maxRetries}). Last error: ${dispatchResult.error ?? "unknown"}`, metadata: { schedule_id: schedule.id, failure_count: newFailureCount, deactivated_by: "agent-scheduler/tick" } });
      }

      failed++;
      results.push({ schedule_id: schedule.id as string, agent_name: agent.name, status: dispatchResult.status, dispatch_id: dispatchResult.dispatchId, error: dispatchResult.error, deactivated: shouldDeactivate });
    } else {
      await supabase.from("agent_schedules").update({ failure_count: 0 }).eq("id", schedule.id);
      dispatched++;
      results.push({ schedule_id: schedule.id as string, agent_name: agent.name, status: dispatchResult.status, dispatch_id: dispatchResult.dispatchId, deactivated: false });
    }
  }

  structuredLog("INFO", `Agent scheduler tick complete`, { processed, dispatched, failed, deactivated, total_due: dueSchedules.length }, cid);

  return successResponse({ success: true, processed, dispatched, failed, deactivated, cron_schedules_backfilled: backfilled, tick_completed_at: new Date().toISOString(), results }, 200, cid);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const cid = req.headers.get("X-Correlation-ID") || generateCorrelationId();
  structuredLog("INFO", `Request received: ${req.method} ${req.url}`, {}, cid);

  try {
    const envError = verifyEnvSecrets({ SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey });
    if (envError) return errorResponse(envError, 500, "Configuration error", cid);
    if (req.method !== "POST") return errorResponse("Method not allowed", 405, undefined, cid);

    const url = new URL(req.url);

    if (url.pathname === "/agent-scheduler/tick") {
      const heartbeatSecret = Deno.env.get("HEARTBEAT_SECRET");
      const providedSecret = req.headers.get("x-heartbeat-secret") ?? url.searchParams.get("secret");
      const secretOk = !!heartbeatSecret && providedSecret === heartbeatSecret;

      const authHeader = req.headers.get("Authorization") || "";
      const isServiceRole = isServiceRoleAuth(authHeader);
      const user = secretOk
        ? { userId: "cron_secret", role: "service_role" }
        : isServiceRole
        ? { userId: "service_role", role: "service_role" }
        : await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);

      if (!user) {
        structuredLog("WARN", "Tick called without valid auth", {}, cid);
        return errorResponse("Unauthorized: service_role key, ?secret=, or admin JWT required", 401, undefined, cid);
      }

      if (user.role !== "service_role") {
        const ADMIN_ROLES = ["admin", "Founder", "OpsHead"];
        if (!ADMIN_ROLES.includes(user.role)) {
          return errorResponse("Forbidden: admin role required", 403, `Your role is "${user.role}". Required: admin, Founder, or OpsHead.`, cid);
        }
      }

      return await handleTick(cid);
    }

    return errorResponse(`Unknown route: ${url.pathname}`, 404, undefined, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});
