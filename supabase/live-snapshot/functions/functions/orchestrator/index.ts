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
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID",
};

// ──────────────────────────────────────────────
// Environment & Client Setup
// ──────────────────────────────────────────────
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ──────────────────────────────────────────────
// Admin role check
// ──────────────────────────────────────────────
const ADMIN_ROLES = ["admin", "Founder", "OpsHead"];

function isAdmin(role: string): boolean {
  return ADMIN_ROLES.includes(role);
}

// ──────────────────────────────────────────────
// Valid lifecycle events
// ──────────────────────────────────────────────
const VALID_EVENTS = new Set([
  "lead.created",
  "lead.qualified",
  "meeting.scheduled",
  "meeting.completed",
  "proposal.sent",
  "deal.won",
  "deal.lost",
]);

// ──────────────────────────────────────────────
// Event → default stage advancement map
// ──────────────────────────────────────────────
const EVENT_STAGE_ADVANCEMENT: Record<string, string> = {
  "lead.created": "Lead Generation",
  "lead.qualified": "Qualification",
  "meeting.scheduled": "Meeting",
  "meeting.completed": "Proposal",
  "proposal.sent": "Closer",
  "deal.won": "Onboarding",
  "deal.lost": "Qualification", // Reset back for re-engagement
};

// ──────────────────────────────────────────────
// Dispatch a single agent to an edge function or ai_job
// ──────────────────────────────────────────────
async function dispatchAgent(
  agent: Record<string, unknown>,
  action: string,
  inputData: Record<string, unknown>,
  leadId: string | null,
  brandId: string | null,
  scheduleId: string | null,
  lifecycleStageId: string | null,
  cid: string,
): Promise<{
  dispatchId: string;
  status: string;
  outputData: Record<string, unknown>;
  durationMs: number;
  tokensUsed: number;
  costUsd: number;
  jobId: string | null;
}> {
  const startTime = Date.now();

  // 1. Create dispatch log entry (status: dispatched)
  const { data: dispatch, error: dispatchErr } = await supabase
    .from("agent_dispatch_log")
    .insert({
      schedule_id: scheduleId,
      agent_id: agent.id,
      lead_id: leadId,
      brand_id: brandId,
      lifecycle_stage_id: lifecycleStageId,
      action,
      input_data: inputData,
      status: "dispatched",
    })
    .select("id")
    .single();

  if (dispatchErr || !dispatch) {
    structuredLog(
      "ERROR",
      "Failed to create dispatch log entry",
      { error: dispatchErr?.message, agentId: agent.id },
      cid,
    );
    throw new Error(`Failed to create dispatch log: ${dispatchErr?.message}`);
  }

  const dispatchId = dispatch.id;
  let jobId: string | null = null;
  let outputData: Record<string, unknown> = {};
  let status = "dispatched";
  let tokensUsed = 0;
  let costUsd = 0;

  // Update to running
  await supabase
    .from("agent_dispatch_log")
    .update({ status: "running" })
    .eq("id", dispatchId);

  try {
    // 2. Determine the target function name from agent task
    const task = (agent.task as string) ?? "";
    const functionName = resolveEdgeFunctionName(task);

    // 3. Try to call the edge function directly
    if (functionName) {
      const functionUrl = `${supabaseUrl}/functions/v1/${functionName}`;
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceRoleKey}`,
          "X-Correlation-ID": cid,
        },
        body: JSON.stringify({
          action,
          agent_id: agent.id,
          lead_id: leadId,
          brand_id: brandId,
          ...inputData,
        }),
      });

      const durationMs = Date.now() - startTime;

      if (response.ok) {
        outputData = (await response.json()) as Record<string, unknown>;
        status = "completed";

        // Extract token/cost from response if available
        if (outputData.tokens_used) tokensUsed = Number(outputData.tokens_used);
        if (outputData.cost_usd) costUsd = Number(outputData.cost_usd);
      } else {
        const errorText = await response.text();
        status = "failed";
        outputData = { error: errorText, status_code: response.status };
        structuredLog(
          "ERROR",
          `Edge function ${functionName} returned ${response.status}`,
          { error: errorText, agentId: agent.id },
          cid,
        );
      }

      // Update dispatch log with result
      await supabase
        .from("agent_dispatch_log")
        .update({
          status,
          output_data: outputData,
          duration_ms: durationMs,
          tokens_used: tokensUsed || null,
          cost_usd: costUsd > 0 ? costUsd : null,
        })
        .eq("id", dispatchId);

      return {
        dispatchId,
        status,
        outputData,
        durationMs,
        tokensUsed,
        costUsd,
        jobId: null,
      };
    }

    // 4. Fallback: create an ai_job for async processing
    const { data: job, error: jobErr } = await supabase
      .from("ai_jobs")
      .insert({
        agent_id: agent.id,
        type: action,
        payload: {
          ...inputData,
          lead_id: leadId,
          brand_id: brandId,
        },
        status: "pending",
      })
      .select("id")
      .single();

    if (jobErr || !job) {
      throw new Error(`Failed to create ai_job: ${jobErr?.message}`);
    }

    jobId = job.id;
    status = "dispatched";

    // Link job to dispatch log
    await supabase
      .from("agent_dispatch_log")
      .update({ job_id: jobId })
      .eq("id", dispatchId);

    const durationMs = Date.now() - startTime;

    return {
      dispatchId,
      status,
      outputData: { queued: true, job_id: jobId },
      durationMs,
      tokensUsed: 0,
      costUsd: 0,
      jobId,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    status = "failed";

    await supabase
      .from("agent_dispatch_log")
      .update({
        status,
        error_message: errorMsg,
        duration_ms: durationMs,
      })
      .eq("id", dispatchId);

    structuredLog(
      "ERROR",
      `Agent dispatch failed: ${errorMsg}`,
      { agentId: agent.id, action },
      cid,
    );

    return {
      dispatchId,
      status,
      outputData: { error: errorMsg },
      durationMs,
      tokensUsed: 0,
      costUsd: 0,
      jobId: null,
    };
  }
}

// ──────────────────────────────────────────────
// Map agent task to edge function name
// ──────────────────────────────────────────────
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

// ──────────────────────────────────────────────
// Get or create lead_lifecycle entry
// ──────────────────────────────────────────────
async function getOrCreateLeadLifecycle(
  leadId: string,
  brandId: string | null,
  cid: string,
): Promise<{ lifecycle: Record<string, unknown>; created: boolean }> {
  // Check for existing lifecycle entry
  const { data: existing, error: fetchErr } = await supabase
    .from("lead_lifecycle")
    .select("*, current_stage:agent_lifecycle_stages(stage_name, stage_order)")
    .eq("lead_id", leadId)
    .maybeSingle();

  if (fetchErr) {
    structuredLog(
      "ERROR",
      `Failed to query lead_lifecycle for lead ${leadId}`,
      { error: fetchErr.message },
      cid,
    );
    throw new Error(`Failed to query lead_lifecycle: ${fetchErr.message}`);
  }

  if (existing) {
    return { lifecycle: existing, created: false };
  }

  // Look up the first stage (Lead Generation, order 1)
  const { data: firstStage, error: stageErr } = await supabase
    .from("agent_lifecycle_stages")
    .select("id")
    .eq("stage_order", 1)
    .limit(1)
    .maybeSingle();

  if (stageErr) {
    structuredLog(
      "ERROR",
      "Failed to fetch initial lifecycle stage",
      { error: stageErr.message },
      cid,
    );
    throw new Error(`Failed to fetch initial stage: ${stageErr.message}`);
  }

  // Create lifecycle entry
  const { data: lifecycle, error: insertErr } = await supabase
    .from("lead_lifecycle")
    .insert({
      lead_id: leadId,
      current_stage_id: firstStage?.id ?? null,
      next_action: "awaiting_qualification",
    })
    .select("*, current_stage:agent_lifecycle_stages(stage_name, stage_order)")
    .single();

  if (insertErr || !lifecycle) {
    structuredLog(
      "ERROR",
      `Failed to create lead_lifecycle for lead ${leadId}`,
      { error: insertErr?.message },
      cid,
    );
    throw new Error(
      `Failed to create lead_lifecycle: ${insertErr?.message}`,
    );
  }

  structuredLog(
    "INFO",
    `Created lead_lifecycle entry for lead ${leadId}`,
    { stageId: firstStage?.id },
    cid,
  );

  return { lifecycle, created: true };
}

// ──────────────────────────────────────────────
// Advance lead lifecycle stage
// ──────────────────────────────────────────────
async function advanceLifecycleStage(
  leadId: string,
  targetStageName: string,
  cid: string,
): Promise<{ advanced: boolean; fromStage: string | null; toStage: string }> {
  // Get current lifecycle
  const { data: lifecycle } = await supabase
    .from("lead_lifecycle")
    .select("id, current_stage_id, stage_history, current_stage:agent_lifecycle_stages(stage_name, stage_order)")
    .eq("lead_id", leadId)
    .maybeSingle();

  if (!lifecycle) {
    structuredLog(
      "WARN",
      `No lead_lifecycle found for lead ${leadId}, skipping stage advancement`,
      {},
      cid,
    );
    return { advanced: false, fromStage: null, toStage: targetStageName };
  }

  const currentStage = lifecycle.current_stage as
    | { stage_name: string; stage_order: number }
    | null;
  const fromStage = currentStage?.stage_name ?? null;

  // Don't advance if already at or past target stage
  if (fromStage === targetStageName) {
    return { advanced: false, fromStage, toStage: targetStageName };
  }

  // Look up target stage
  const { data: targetStage } = await supabase
    .from("agent_lifecycle_stages")
    .select("id, stage_order")
    .eq("stage_name", targetStageName)
    .maybeSingle();

  if (!targetStage) {
    structuredLog(
      "WARN",
      `Target stage "${targetStageName}" not found, skipping advancement`,
      {},
      cid,
    );
    return { advanced: false, fromStage, toStage: targetStageName };
  }

  // Only advance forward (higher stage_order)
  if (
    currentStage &&
    targetStage.stage_order <= currentStage.stage_order
  ) {
    structuredLog(
      "INFO",
      `Stage advancement skipped: target order ${targetStage.stage_order} not greater than current ${currentStage.stage_order}`,
      { leadId, fromStage, toStage: targetStageName },
      cid,
    );
    return { advanced: false, fromStage, toStage: targetStageName };
  }

  // Build stage history entry
  const historyEntry = {
    stage_id: lifecycle.current_stage_id,
    stage_name: fromStage ?? "unknown",
    entered_at: lifecycle.entered_stage_at,
    exited_at: new Date().toISOString(),
  };

  const stageHistory = Array.isArray(lifecycle.stage_history)
    ? [...lifecycle.stage_history, historyEntry]
    : [historyEntry];

  // Update lifecycle
  const { error: updateErr } = await supabase
    .from("lead_lifecycle")
    .update({
      current_stage_id: targetStage.id,
      entered_stage_at: new Date().toISOString(),
      stage_history: stageHistory,
    })
    .eq("id", lifecycle.id);

  if (updateErr) {
    structuredLog(
      "ERROR",
      `Failed to advance lead_lifecycle for lead ${leadId}`,
      { error: updateErr.message, fromStage, toStage: targetStageName },
      cid,
    );
    return { advanced: false, fromStage, toStage: targetStageName };
  }

  structuredLog(
    "INFO",
    `Lead lifecycle advanced: ${fromStage ?? "none"} → ${targetStageName}`,
    { leadId, lifecycleId: lifecycle.id },
    cid,
  );

  return { advanced: true, fromStage, toStage: targetStageName };
}

// ══════════════════════════════════════════════
// ENDPOINT 1: POST /orchestrator/dispatch
// ══════════════════════════════════════════════
async function handleDispatch(req: Request, cid: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse(
        "Invalid request body: expected JSON object",
        400,
        undefined,
        cid,
      );
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { agent_id, lead_id, brand_id, action, input_data } = body;

  // Validate required fields
  if (!agent_id || typeof agent_id !== "string") {
    return errorResponse(
      "Missing or invalid 'agent_id' (UUID string required)",
      400,
      undefined,
      cid,
    );
  }
  if (!action || typeof action !== "string") {
    return errorResponse(
      "Missing or invalid 'action' (string required)",
      400,
      undefined,
      cid,
    );
  }
  if (action.length > 200) {
    return errorResponse("'action' too long: max 200 characters", 400, undefined, cid);
  }

  structuredLog(
    "INFO",
    "Dispatching agent",
    { agent_id, lead_id, brand_id, action },
    cid,
  );

  // Step 1: Look up the agent
  const { data: agent, error: agentErr } = await supabase
    .from("ai_agents")
    .select("id, name, task, dept, is_active")
    .eq("id", agent_id)
    .maybeSingle();

  if (agentErr || !agent) {
    return errorResponse(
      `Agent not found: ${agent_id}`,
      404,
      agentErr?.message,
      cid,
    );
  }

  if (!agent.is_active) {
    return errorResponse(
      `Agent "${agent.name}" is not active`,
      409,
      undefined,
      cid,
    );
  }

  // Step 2: Create dispatch log entry with status='dispatched'
  // (handled inside dispatchAgent)

  // Step 3: If lead_id provided, look up or create lead_lifecycle entry
  let lifecycleStageId: string | null = null;
  if (lead_id && typeof lead_id === "string") {
    try {
      const { lifecycle } = await getOrCreateLeadLifecycle(
        lead_id,
        typeof brand_id === "string" ? brand_id : null,
        cid,
      );
      lifecycleStageId = lifecycle.current_stage_id as string | null;
    } catch (err) {
      structuredLog(
        "WARN",
        "Could not resolve lead_lifecycle, proceeding without",
        { error: err instanceof Error ? err.message : "unknown" },
        cid,
      );
    }
  }

  // Step 4: Dispatch the agent
  const result = await dispatchAgent(
    agent,
    action,
    (input_data as Record<string, unknown>) ?? {},
    typeof lead_id === "string" ? lead_id : null,
    typeof brand_id === "string" ? brand_id : null,
    null, // no schedule_id for manual dispatch
    lifecycleStageId,
    cid,
  );

  structuredLog(
    "INFO",
    "Agent dispatch complete",
    {
      agentId: agent.id,
      agentName: agent.name,
      dispatchId: result.dispatchId,
      status: result.status,
      durationMs: result.durationMs,
    },
    cid,
  );

  return successResponse(
    {
      success: result.status === "completed" || result.status === "dispatched",
      dispatch_id: result.dispatchId,
      agent_id: agent.id,
      agent_name: agent.name,
      action,
      status: result.status,
      output_data: result.outputData,
      duration_ms: result.durationMs,
      tokens_used: result.tokensUsed,
      cost_usd: result.costUsd,
      job_id: result.jobId,
    },
    200,
    cid,
  );
}

// ══════════════════════════════════════════════
// ENDPOINT 2: POST /orchestrator/process-event
// ══════════════════════════════════════════════
async function handleProcessEvent(req: Request, cid: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse(
        "Invalid request body: expected JSON object",
        400,
        undefined,
        cid,
      );
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { event, entity_id, entity_type, data } = body;

  // Validate required fields
  if (!event || typeof event !== "string") {
    return errorResponse(
      "Missing or invalid 'event' (string required)",
      400,
      undefined,
      cid,
    );
  }
  if (!VALID_EVENTS.has(event)) {
    return errorResponse(
      `Invalid event: "${event}". Must be one of: ${[...VALID_EVENTS].join(", ")}`,
      400,
      undefined,
      cid,
    );
  }
  if (!entity_id || typeof entity_id !== "string") {
    return errorResponse(
      "Missing or invalid 'entity_id' (UUID string required)",
      400,
      undefined,
      cid,
    );
  }
  if (!entity_type || typeof entity_type !== "string") {
    return errorResponse(
      "Missing or invalid 'entity_type' (string required)",
      400,
      undefined,
      cid,
    );
  }

  structuredLog(
    "INFO",
    `Processing lifecycle event: ${event}`,
    { entity_id, entity_type },
    cid,
  );

  // Step 1: Find all active schedules matching this event_trigger
  const { data: schedules, error: schedErr } = await supabase
    .from("agent_schedules")
    .select(`
      id,
      agent_id,
      agent:ai_agents(id, name, task, is_active),
      schedule_type,
      event_trigger,
      lifecycle_stage_id,
      brand_id,
      conditions,
      max_retries
    `)
    .eq("is_active", true)
    .eq("schedule_type", "event_trigger")
    .eq("event_trigger", event);

  if (schedErr) {
    return errorResponse(
      `Failed to query schedules: ${schedErr.message}`,
      500,
      undefined,
      cid,
    );
  }

  if (!schedules || schedules.length === 0) {
    structuredLog(
      "INFO",
      `No active event-trigger schedules found for "${event}"`,
      { entity_id },
      cid,
    );
    return successResponse(
      {
        success: true,
        event,
        entity_id,
        entity_type,
        dispatched: 0,
        actions: [],
        stage_advanced: false,
      },
      200,
      cid,
    );
  }

  structuredLog(
    "INFO",
    `Found ${schedules.length} matching schedules for event "${event}"`,
    { entity_id },
    cid,
  );

  // Resolve the lead_id from entity for lifecycle operations
  let leadId: string | null = null;
  let brandId: string | null = null;

  if (entity_type === "lead") {
    leadId = entity_id;
  } else if (entity_type === "meeting" || entity_type === "proposal" || entity_type === "deal") {
    // Try to resolve lead_id from the entity data or from the database
    if (data && typeof data === "object" && "lead_id" in data) {
      leadId = data.lead_id as string | null;
    }
  }

  if (data && typeof data === "object" && "brand_id" in data) {
    brandId = data.brand_id as string | null;
  }

  // Step 2: For each matching schedule, create dispatch entries
  const actions: Array<{
    schedule_id: string;
    agent_name: string;
    agent_task: string;
    dispatch_id: string;
    status: string;
  }> = [];

  const inputData = (data as Record<string, unknown>) ?? {};

  for (const schedule of schedules) {
    const agent = schedule.agent as
      | { id: string; name: string; task: string; is_active: boolean }
      | null;

    if (!agent || !agent.is_active) {
      structuredLog(
        "WARN",
        "Skipping schedule: agent is null or inactive",
        { scheduleId: schedule.id, agentId: schedule.agent_id },
        cid,
      );
      continue;
    }

    // Check brand-specific schedules
    if (schedule.brand_id && brandId && schedule.brand_id !== brandId) {
      structuredLog(
        "DEBUG",
        "Skipping schedule: brand mismatch",
        { scheduleBrandId: schedule.brand_id, leadBrandId: brandId },
        cid,
      );
      continue;
    }

    // Evaluate conditions if present
    if (schedule.conditions && typeof schedule.conditions === "object") {
      const conditionsMet = evaluateConditions(
        schedule.conditions as Record<string, unknown>,
        inputData,
      );
      if (!conditionsMet) {
        structuredLog(
          "DEBUG",
          "Skipping schedule: conditions not met",
          { scheduleId: schedule.id, conditions: schedule.conditions },
          cid,
        );
        continue;
      }
    }

    try {
      const result = await dispatchAgent(
        agent,
        event,
        inputData,
        leadId,
        brandId ?? (schedule.brand_id as string | null),
        schedule.id as string,
        schedule.lifecycle_stage_id as string | null,
        cid,
      );

      actions.push({
        schedule_id: schedule.id as string,
        agent_name: agent.name,
        agent_task: agent.task,
        dispatch_id: result.dispatchId,
        status: result.status,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      structuredLog(
        "ERROR",
        `Failed to dispatch agent from schedule ${schedule.id}`,
        { error: msg },
        cid,
      );
      actions.push({
        schedule_id: schedule.id as string,
        agent_name: agent.name,
        agent_task: agent.task,
        dispatch_id: "error",
        status: `failed: ${msg}`,
      });
    }
  }

  // Step 3: Advance the lead_lifecycle stage if conditions met
  let stageAdvanced = false;
  let stageAdvancement: { advanced: boolean; fromStage: string | null; toStage: string } | null = null;

  if (leadId && EVENT_STAGE_ADVANCEMENT[event]) {
    try {
      stageAdvancement = await advanceLifecycleStage(
        leadId,
        EVENT_STAGE_ADVANCEMENT[event],
        cid,
      );
      stageAdvanced = stageAdvancement.advanced;
    } catch (err) {
      structuredLog(
        "WARN",
        "Failed to advance lifecycle stage",
        { error: err instanceof Error ? err.message : "unknown", leadId, event },
        cid,
      );
    }
  }

  structuredLog(
    "INFO",
    `Event "${event}" processed: ${actions.length} dispatches, stage advanced: ${stageAdvanced}`,
    { entity_id, leadId },
    cid,
  );

  return successResponse(
    {
      success: true,
      event,
      entity_id,
      entity_type,
      dispatched: actions.length,
      actions,
      stage_advanced: stageAdvanced,
      stage_advancement: stageAdvancement,
    },
    200,
    cid,
  );
}

// ──────────────────────────────────────────────
// Simple condition evaluator
// Supports: { field: "value" } — checks that data[field] === value
//           { field: { "gte": N, "lte": M } } — numeric range checks
//           { field: { "in": ["a","b"] } } — membership check
// ──────────────────────────────────────────────
function evaluateConditions(
  conditions: Record<string, unknown>,
  data: Record<string, unknown>,
): boolean {
  for (const [key, expected] of Object.entries(conditions)) {
    const actual = data[key];

    if (typeof expected === "object" && expected !== null && !Array.isArray(expected)) {
      const range = expected as Record<string, unknown>;

      if ("gte" in range && typeof actual === "number" && typeof range.gte === "number") {
        if (actual < range.gte) return false;
      }
      if ("lte" in range && typeof actual === "number" && typeof range.lte === "number") {
        if (actual > range.lte) return false;
      }
      if ("eq" in range) {
        if (actual !== range.eq) return false;
      }
      if ("neq" in range) {
        if (actual === range.neq) return false;
      }
      if ("in" in range && Array.isArray(range.in)) {
        if (!range.in.includes(actual)) return false;
      }
      if ("exists" in range && range.exists === true) {
        if (actual === undefined || actual === null) return false;
      }
    } else if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else {
      if (actual !== expected) return false;
    }
  }

  return true;
}

// ══════════════════════════════════════════════
// ENDPOINT 3: GET /orchestrator/lead-pipeline
// ══════════════════════════════════════════════
async function handleLeadPipeline(url: URL, cid: string): Promise<Response> {
  const brandId = url.searchParams.get("brand_id");

  let query = supabase
    .from("lead_lifecycle")
    .select(`
      id,
      lead_id,
      current_stage_id,
      entered_stage_at,
      next_action,
      next_action_scheduled_at,
      blocked,
      blocked_reason,
      stage_history,
      assigned_agents,
      current_stage:agent_lifecycle_stages(id, stage_name, stage_order, description, trigger_conditions, escalation_rules),
      lead:leads(
        id,
        name,
        email,
        mobile,
        city,
        state,
        stage,
        source,
        lead_score,
        brand_id,
        assigned_to,
        created_at,
        is_active
      )
    `)
    .order("entered_stage_at", { ascending: false });

  if (brandId) {
    // Filter by brand through leads relation
    const { data: brandLeadIds, error: blErr } = await supabase
      .from("leads")
      .select("id")
      .eq("brand_id", brandId)
      .eq("is_active", true);

    if (blErr) {
      return errorResponse(
        `Failed to query leads for brand: ${blErr.message}`,
        500,
        undefined,
        cid,
      );
    }

    if (!brandLeadIds || brandLeadIds.length === 0) {
      return successResponse(
        {
          success: true,
          brand_id: brandId,
          total_leads: 0,
          stages: [],
          leads: [],
        },
        200,
        cid,
      );
    }

    const leadIds = brandLeadIds.map((l: { id: string }) => l.id);
    query = query.in("lead_id", leadIds);
  }

  const { data: lifecycles, error: lcErr } = await query;

  if (lcErr) {
    return errorResponse(
      `Failed to query lead pipeline: ${lcErr.message}`,
      500,
      undefined,
      cid,
    );
  }

  if (!lifecycles || lifecycles.length === 0) {
    return successResponse(
      {
        success: true,
        brand_id: brandId,
        total_leads: 0,
        stages: [],
        leads: [],
      },
      200,
      cid,
    );
  }

  // Get all lifecycle stages for reference
  const { data: allStages } = await supabase
    .from("agent_lifecycle_stages")
    .select("id, stage_name, stage_order, description")
    .order("stage_order", { ascending: true });

  // Build pipeline view grouped by stage
  const stageMap: Record<string, {
    stage_id: string;
    stage_name: string;
    stage_order: number;
    description: string;
    leads: Array<Record<string, unknown>>;
  }> = {};

  for (const stage of allStages ?? []) {
    stageMap[stage.id] = {
      stage_id: stage.id,
      stage_name: stage.stage_name,
      stage_order: stage.stage_order,
      description: stage.description ?? "",
      leads: [],
    };
  }

  for (const lc of lifecycles) {
    const lead = lc.lead as Record<string, unknown> | null;
    if (!lead) continue;

    const currentStage = lc.current_stage as
      | { id: string; stage_name: string; stage_order: number }
      | null;
    const stageId = currentStage?.id ?? lc.current_stage_id;

    if (stageId && stageMap[stageId]) {
      stageMap[stageId].leads.push({
        lifecycle_id: lc.id,
        lead_id: lc.lead_id,
        lead_name: lead.name,
        lead_email: lead.email,
        lead_mobile: lead.mobile,
        city: lead.city,
        state: lead.state,
        crm_stage: lead.stage,
        lead_score: lead.lead_score,
        source: lead.source,
        assigned_to: lead.assigned_to,
        lead_created_at: lead.created_at,
        entered_stage_at: lc.entered_stage_at,
        next_action: lc.next_action,
        next_action_scheduled_at: lc.next_action_scheduled_at,
        blocked: lc.blocked,
        blocked_reason: lc.blocked_reason,
        assigned_agents: lc.assigned_agents,
      });
    }
  }

  const stages = Object.values(stageMap).sort(
    (a, b) => a.stage_order - b.stage_order,
  );

  // Collect all assigned agent IDs referenced across lifecycles
  const allAgentIds = new Set<string>();
  for (const lc of lifecycles) {
    const agents = lc.assigned_agents;
    if (Array.isArray(agents)) {
      for (const a of agents) {
        if (typeof a === "string") allAgentIds.add(a);
      }
    }
  }

  // Fetch agent details for all referenced agents
  let agentMap: Record<string, { id: string; name: string; task: string }> = {};
  if (allAgentIds.size > 0) {
    const { data: agents } = await supabase
      .from("ai_agents")
      .select("id, name, task")
      .in("id", [...allAgentIds]);

    if (agents) {
      for (const agent of agents) {
        agentMap[agent.id] = agent;
      }
    }
  }

  const totalLeads = lifecycles.length;

  structuredLog(
    "INFO",
    `Lead pipeline retrieved: ${totalLeads} leads across ${stages.length} stages`,
    { brand_id: brandId ?? "all" },
    cid,
  );

  return successResponse(
    {
      success: true,
      brand_id: brandId,
      total_leads: totalLeads,
      stages,
      agents: agentMap,
    },
    200,
    cid,
  );
}

// ══════════════════════════════════════════════
// ENDPOINT 4: POST /orchestrator/batch-run
// ══════════════════════════════════════════════
async function handleBatchRun(cid: string): Promise<Response> {
  const MAX_DISPATCHES = 10;

  structuredLog("INFO", "Batch run: fetching due schedules", {}, cid);

  // Find all schedules where next_run_at <= now() and is_active = true
  const { data: dueSchedules, error: schedErr } = await supabase
    .from("agent_schedules")
    .select(`
      id,
      agent_id,
      agent:ai_agents(id, name, task, is_active),
      schedule_type,
      lifecycle_stage_id,
      brand_id,
      conditions,
      max_retries,
      run_count
    `)
    .eq("is_active", true)
    .not("next_run_at", "is", null)
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(MAX_DISPATCHES);

  if (schedErr) {
    return errorResponse(
      `Failed to query due schedules: ${schedErr.message}`,
      500,
      undefined,
      cid,
    );
  }

  if (!dueSchedules || dueSchedules.length === 0) {
    structuredLog("INFO", "No due schedules found", {}, cid);
    return successResponse(
      {
        success: true,
        processed: 0,
        dispatched: 0,
        failed: 0,
        message: "No schedules are currently due",
      },
      200,
      cid,
    );
  }

  structuredLog(
    "INFO",
    `Found ${dueSchedules.length} due schedules`,
    {},
    cid,
  );

  let dispatched = 0;
  let failed = 0;
  const results: Array<{
    schedule_id: string;
    agent_name: string;
    status: string;
    dispatch_id: string;
    error?: string;
  }> = [];

  for (const schedule of dueSchedules) {
    const agent = schedule.agent as
      | { id: string; name: string; task: string; is_active: boolean }
      | null;

    if (!agent || !agent.is_active) {
      structuredLog(
        "WARN",
        "Skipping due schedule: agent is null or inactive",
        { scheduleId: schedule.id },
        cid,
      );
      failed++;
      results.push({
        schedule_id: schedule.id as string,
        agent_name: agent?.name ?? "unknown",
        status: "skipped",
        dispatch_id: "",
        error: "Agent is null or inactive",
      });
      continue;
    }

    // Update run_count (trigger will auto-calculate next_run_at)
    const newRunCount = ((schedule.run_count as number) ?? 0) + 1;

    const { error: updateErr } = await supabase
      .from("agent_schedules")
      .update({
        run_count: newRunCount,
        last_run_at: new Date().toISOString(),
      })
      .eq("id", schedule.id);

    if (updateErr) {
      structuredLog(
        "ERROR",
        "Failed to update schedule run_count",
        { error: updateErr.message, scheduleId: schedule.id },
        cid,
      );
      failed++;
      results.push({
        schedule_id: schedule.id as string,
        agent_name: agent.name,
        status: "failed",
        dispatch_id: "",
        error: updateErr.message,
      });
      continue;
    }

    // Dispatch the agent
    try {
      const result = await dispatchAgent(
        agent,
        `scheduled_run_${schedule.schedule_type}`,
        (schedule.conditions as Record<string, unknown>) ?? {},
        null, // no specific lead for batch runs
        schedule.brand_id as string | null,
        schedule.id as string,
        schedule.lifecycle_stage_id as string | null,
        cid,
      );

      dispatched++;
      results.push({
        schedule_id: schedule.id as string,
        agent_name: agent.name,
        status: result.status,
        dispatch_id: result.dispatchId,
      });
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : "Unknown error";
      results.push({
        schedule_id: schedule.id as string,
        agent_name: agent.name,
        status: "failed",
        dispatch_id: "",
        error: msg,
      });
    }
  }

  structuredLog(
    "INFO",
    `Batch run complete: ${dispatched} dispatched, ${failed} failed out of ${dueSchedules.length} due`,
    {},
    cid,
  );

  return successResponse(
    {
      success: true,
      processed: dueSchedules.length,
      dispatched,
      failed,
      results,
    },
    200,
    cid,
  );
}

// ──────────────────────────────────────────────
// Main Handler
// ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Correlation ID
  const cid =
    req.headers.get("X-Correlation-ID") || generateCorrelationId();
  structuredLog("INFO", `Request received: ${req.method} ${req.url}`, {}, cid);

  try {
    // Verify required env secrets
    const envError = verifyEnvSecrets({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
    });
    if (envError) {
      return errorResponse(envError, 500, "Configuration error", cid);
    }

    const url = new URL(req.url);
    const pathname = url.pathname;

    // ── GET /orchestrator/lead-pipeline ──
    if (pathname === "/orchestrator/lead-pipeline" && req.method === "GET") {
      const authHeader = req.headers.get("Authorization") || "";
      const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
      if (!user) {
        return errorResponse(
          "Unauthorized: valid JWT required",
          401,
          undefined,
          cid,
        );
      }
      return await handleLeadPipeline(url, cid);
    }

    // ── All POST endpoints require admin auth ──
    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405, undefined, cid);
    }

    // JWT + admin role verification
    const authHeader = req.headers.get("Authorization") || "";
    const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
    if (!user) {
      return errorResponse(
        "Unauthorized: valid JWT required",
        401,
        undefined,
        cid,
      );
    }
    if (!isAdmin(user.role)) {
      structuredLog(
        "WARN",
        "Non-admin user attempted access",
        { userId: user.userId, role: user.role },
        cid,
      );
      return errorResponse(
        "Forbidden: admin role required",
        403,
        `Your role is "${user.role}". Required: ${ADMIN_ROLES.join(", ")}`,
        cid,
      );
    }

    // ── POST /orchestrator/dispatch ──
    if (pathname === "/orchestrator/dispatch") {
      return await handleDispatch(req, cid);
    }

    // ── POST /orchestrator/process-event ──
    if (pathname === "/orchestrator/process-event") {
      return await handleProcessEvent(req, cid);
    }

    // ── POST /orchestrator/batch-run ──
    if (pathname === "/orchestrator/batch-run") {
      return await handleBatchRun(cid);
    }

    return errorResponse(`Unknown route: ${pathname}`, 404, undefined, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});