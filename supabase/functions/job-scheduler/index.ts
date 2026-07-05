import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  correlationId as generateCorrelationId,
  structuredLog,
  errorResponse,
  successResponse,
  verifyEnvSecrets,
  verifyJWT,
} from "../_shared/utils.ts";

// ──────────────────────────────────────────────
// CORS headers
// ──────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID",
};

// ──────────────────────────────────────────────
// Environment & Client Setup
// ──────────────────────────────────────────────
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ──────────────────────────────────────────────
// process_pending: fetch up to 10 pending jobs
// and invoke ai-engine's run_jobs action
// ──────────────────────────────────────────────
async function processPending(cid: string) {
  structuredLog("INFO", "Processing pending jobs", {}, cid);

  const { data: pendingJobs, error: fetchError } = await supabase
    .from("ai_jobs")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);

  if (fetchError) {
    structuredLog("ERROR", "Failed to fetch pending jobs", { error: fetchError.message }, cid);
    throw new Error(`Failed to fetch pending jobs: ${fetchError.message}`);
  }

  if (!pendingJobs || pendingJobs.length === 0) {
    structuredLog("INFO", "No pending jobs to process", {}, cid);
    return { processed: 0, message: "No pending jobs to process" };
  }

  const aiEngineUrl = `${supabaseUrl}/functions/v1/ai-engine/run_jobs`;

  const response = await fetch(aiEngineUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
    },
    body: JSON.stringify({ action: "run_jobs" }),
  });

  if (!response.ok) {
    const text = await response.text();
    structuredLog("ERROR", "ai-engine invocation failed", { status: response.status, body: text }, cid);
    throw new Error(`ai-engine invocation failed (${response.status}): ${text}`);
  }

  const aiResult = await response.json();

  structuredLog("INFO", `Processed ${pendingJobs.length} pending jobs`, {}, cid);

  return {
    dispatched: pendingJobs.length,
    ai_engine_result: aiResult,
  };
}

// ──────────────────────────────────────────────
// retry_failed: reset failed jobs (retry_count < 3)
// to pending, then invoke ai-engine
// ──────────────────────────────────────────────
async function retryFailed(cid: string) {
  structuredLog("INFO", "Retrying failed jobs", {}, cid);

  const { data: failedJobs, error: fetchError } = await supabase
    .from("ai_jobs")
    .select("*")
    .in("status", ["failed", "retry"])
    .lt("retry_count", 3)
    .order("created_at", { ascending: true })
    .limit(20);

  if (fetchError) {
    structuredLog("ERROR", "Failed to fetch failed jobs", { error: fetchError.message }, cid);
    throw new Error(`Failed to fetch failed jobs: ${fetchError.message}`);
  }

  if (!failedJobs || failedJobs.length === 0) {
    structuredLog("INFO", "No failed jobs eligible for retry", {}, cid);
    return { retried: 0, message: "No failed jobs eligible for retry" };
  }

  const jobIds = failedJobs.map((j: { id: string }) => j.id);

  const { error: updateError } = await supabase
    .from("ai_jobs")
    .update({
      status: "pending",
      updated_at: new Date().toISOString(),
    })
    .in("id", jobIds);

  if (updateError) {
    structuredLog("ERROR", "Failed to reset jobs", { error: updateError.message }, cid);
    throw new Error(`Failed to reset jobs: ${updateError.message}`);
  }

  const aiEngineUrl = `${supabaseUrl}/functions/v1/ai-engine/run_jobs`;

  const response = await fetch(aiEngineUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
    },
    body: JSON.stringify({ action: "run_jobs" }),
  });

  if (!response.ok) {
    const text = await response.text();
    structuredLog("ERROR", "ai-engine invocation failed on retry", { status: response.status, body: text }, cid);
    throw new Error(`ai-engine invocation failed (${response.status}): ${text}`);
  }

  const aiResult = await response.json();

  structuredLog("INFO", `Retried ${jobIds.length} jobs`, { jobIds }, cid);

  return {
    retried: jobIds.length,
    job_ids: jobIds,
    ai_engine_result: aiResult,
  };
}

// ──────────────────────────────────────────────
// objectives_check: update agent_objectives
// progress based on actual data
//
// KNOWN RISK (found during repo-sync read-through, not yet fixed): the
// `.eq(field, value)` and `.gte(field, value)` calls below pass `undefined`
// as the field name for the CAPTURE_LEADS task branch (ternaries resolve to
// undefined). Supabase-js's behavior when the column-name argument itself is
// undefined has not been verified live here — this could silently no-op the
// filter (returning an unfiltered count) rather than throwing. Not re-tested;
// flagging rather than assuming it works correctly for that specific task.
// ──────────────────────────────────────────────
async function objectivesCheck(cid: string) {
  structuredLog("INFO", "Running objectives check", {}, cid);

  const { data: objectives, error: objError } = await supabase
    .from("agent_objectives")
    .select("*, ai_agents!inner(id, name, task, dept)")
    .eq("status", "active");

  if (objError) {
    structuredLog("ERROR", "Failed to fetch objectives", { error: objError.message }, cid);
    throw new Error(`Failed to fetch objectives: ${objError.message}`);
  }

  if (!objectives || objectives.length === 0) {
    structuredLog("INFO", "No active objectives to check", {}, cid);
    return { checked: 0, message: "No active objectives to check" };
  }

  const updates: Array<{
    objective_id: string;
    agent_name: string;
    task: string;
    objective: string;
    previous_value: number;
    new_value: number;
    target_value: number;
    completed: boolean;
  }> = [];

  const now = new Date();

  for (const obj of objectives) {
    const agent = obj.ai_agents as { id: string; name: string; task: string; dept: string };
    const task = agent.task;
    const since = obj.created_at ? new Date(obj.created_at) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sinceISO = since.toISOString();

    let currentValue = 0;

    try {
      const { count } = await supabase
        .from(task === "CLOSE_DEAL" || task === "CAPTURE_LEADS" || task === "ONBOARD_FRANCHISEE" ? "leads" : "ai_jobs")
        .select("*", { count: "exact", head: true })
        .eq(
          task === "CLOSE_DEAL" || task === "ONBOARD_FRANCHISEE" ? "stage" : task === "CAPTURE_LEADS" ? undefined : "type",
          task === "CLOSE_DEAL" || task === "ONBOARD_FRANCHISEE" ? "Onboarded" : task === "CAPTURE_LEADS" ? undefined : task,
        )
        .eq(task !== "CAPTURE_LEADS" ? "status" : undefined, task === "CAPTURE_LEADS" ? undefined : "completed")
        .gte(task === "CAPTURE_LEADS" ? "created_at" : task === "CLOSE_DEAL" || task === "ONBOARD_FRANCHISEE" ? "updated_at" : "created_at", sinceISO);

      currentValue = count ?? 0;
    } catch (err) {
      structuredLog("WARN", `Failed to count for objective ${obj.id}, task ${task}`, { error: err instanceof Error ? err.message : "unknown" }, cid);
    }

    const previousValue = Number(obj.current_value) || 0;
    const targetValue = Number(obj.target_value) || 0;
    const isCompleted = targetValue > 0 && currentValue >= targetValue;

    const { error: updateError } = await supabase
      .from("agent_objectives")
      .update({
        current_value: currentValue,
        status: isCompleted ? "completed" : "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", obj.id);

    if (updateError) {
      structuredLog("ERROR", `Failed to update objective ${obj.id}`, { error: updateError.message }, cid);
      continue;
    }

    updates.push({
      objective_id: obj.id,
      agent_name: agent.name,
      task,
      objective: obj.objective,
      previous_value: previousValue,
      new_value: currentValue,
      target_value: targetValue,
      completed: isCompleted,
    });
  }

  // Update agent success_rate based on completed objectives ratio
  const { data: allObjectives } = await supabase
    .from("agent_objectives")
    .select("agent_id, status");

  if (allObjectives) {
    const agentStats = new Map<string, { total: number; completed: number }>();
    for (const o of allObjectives) {
      if (!o.agent_id) continue;
      const entry = agentStats.get(o.agent_id) ?? { total: 0, completed: 0 };
      entry.total += 1;
      if (o.status === "completed") entry.completed += 1;
      agentStats.set(o.agent_id, entry);
    }

    for (const [agentId, stats] of agentStats) {
      const rate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
      await supabase
        .from("ai_agents")
        .update({ success_rate: rate })
        .eq("id", agentId);
    }
  }

  structuredLog("INFO", `Objectives check complete: ${updates.length} updated`, { checked: objectives.length }, cid);

  return {
    checked: objectives.length,
    updated: updates.length,
    updates,
  };
}

// ──────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Correlation ID
  const cid = req.headers.get("X-Correlation-ID") || generateCorrelationId();
  structuredLog("INFO", `Request received: ${req.method} ${req.url}`, {}, cid);

  try {
    // Verify required env secrets
    const envError = verifyEnvSecrets({ SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey });
    if (envError) {
      return errorResponse(envError, 500, "Configuration error", cid);
    }

    // JWT required (or service auth)
    const authHeader = req.headers.get("Authorization") || "";
    const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
    if (!user) {
      return errorResponse("Unauthorized: valid JWT or service token required", 401, undefined, cid);
    }

    const url = new URL(req.url);

    // POST /job-scheduler/process_pending
    if (url.pathname === "/job-scheduler/process_pending" && req.method === "POST") {
      const result = await processPending(cid);
      return successResponse({ action: "process_pending", success: true, ...result }, 200, cid);
    }

    // POST /job-scheduler/retry_failed
    if (url.pathname === "/job-scheduler/retry_failed" && req.method === "POST") {
      const result = await retryFailed(cid);
      return successResponse({ action: "retry_failed", success: true, ...result }, 200, cid);
    }

    // POST /job-scheduler/objectives_check
    if (url.pathname === "/job-scheduler/objectives_check" && req.method === "POST") {
      const result = await objectivesCheck(cid);
      return successResponse({ action: "objectives_check", success: true, ...result }, 200, cid);
    }

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405, undefined, cid);
    }

    // Parse body for action routing
    let body: Record<string, unknown>;
    try {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
      }
    } catch {
      return errorResponse("Invalid JSON in request body", 400, undefined, cid);
    }

    const { action } = body;

    if (!action || typeof action !== "string") {
      return errorResponse("Missing 'action' field", 400, undefined, cid);
    }

    switch (action) {
      case "process_pending": {
        const result = await processPending(cid);
        return successResponse({ action: "process_pending", success: true, ...result }, 200, cid);
      }
      case "retry_failed": {
        const result = await retryFailed(cid);
        return successResponse({ action: "retry_failed", success: true, ...result }, 200, cid);
      }
      case "objectives_check": {
        const result = await objectivesCheck(cid);
        return successResponse({ action: "objectives_check", success: true, ...result }, 200, cid);
      }
      default:
        return errorResponse(`Unknown action: ${action}`, 400, undefined, cid);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});
