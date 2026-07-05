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
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-ID",
};

// ──────────────────────────────────────────────
// Environment & Client Setup
// ──────────────────────────────────────────────
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ──────────────────────────────────────────────
// Analyze pipeline velocity and find bottlenecks
//
// KNOWN GAP (found during repo-sync read-through, not yet fixed): `created`
// below is computed from lead.created_at but never used — daysInStage is
// hardcoded to 0, so avg_duration_by_stage always reports 0 days for every
// stage. The bottleneck list itself (based on lead counts per stage) is real;
// only the duration figure is dead. Flagging for a real fix, not silently
// leaving it disguised as working.
// ──────────────────────────────────────────────
async function analyzeProcessVelocity(brandId: string | undefined, cid: string) {
  structuredLog("INFO", "Analyzing process velocity", { brandId }, cid);

  let query = supabase.from("leads").select("*");
  if (brandId) {
    query = query.eq("brand_id", brandId);
  }

  const { data: leads, error } = await query;
  if (error) {
    structuredLog("ERROR", "Failed to fetch leads for velocity analysis", { error: error.message, brandId }, cid);
    throw new Error(`Failed to fetch leads: ${error.message}`);
  }

  const stageGroups: Record<string, number> = {};
  const stageDurations: Record<string, number[]> = [];

  for (const lead of leads ?? []) {
    stageGroups[lead.stage] = (stageGroups[lead.stage] || 0) + 1;
    const created = new Date(lead.created_at).getTime();
    const daysInStage = 0;
    if (!stageDurations[lead.stage]) stageDurations[lead.stage] = [];
    stageDurations[lead.stage].push(daysInStage);
  }

  const avgDurationByStage: Record<string, number> = {};
  for (const [stage, durations] of Object.entries(stageDurations)) {
    avgDurationByStage[stage] =
      durations.reduce((a, b) => a + b, 0) / durations.length;
  }

  const maxCount = Math.max(...Object.values(stageGroups), 1);
  const bottlenecks = Object.entries(stageGroups)
    .filter(([stage, count]) => count >= maxCount * 0.5 && stage !== "Inquiry")
    .map(([stage, count]) => ({
      stage,
      avg_days: avgDurationByStage[stage] ?? 0,
      lead_count: count,
      severity: count >= maxCount * 0.8 ? "high" : "medium",
    }));

  const totalLeads = leads?.length ?? 0;
  const onboardedLeads = stageGroups["Onboarded"] || 0;
  const conversionRate = totalLeads > 0 ? (onboardedLeads / totalLeads) * 100 : 0;

  return {
    total_leads: totalLeads,
    stage_distribution: stageGroups,
    avg_duration_by_stage: avgDurationByStage,
    bottlenecks,
    conversion_rate: Math.round(conversionRate * 10) / 10,
    recommendations: bottlenecks.map(
      (b) =>
        `${b.stage} stage has ${b.lead_count} leads ${
          b.severity === "high"
            ? "URGENT: needs immediate process review"
            : "consider automation or template to speed up"
        }`
    ),
  };
}

// ──────────────────────────────────────────────
// Franchise readiness audit checklist
// ──────────────────────────────────────────────
async function runReadinessAudit(brandId: string, cid: string) {
  structuredLog("INFO", "Running readiness audit", { brandId }, cid);

  const { data: brand, error: brandErr } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .single();

  if (brandErr || !brand) {
    structuredLog("WARN", "Brand not found for readiness audit", { brandId, error: brandErr?.message }, cid);
    throw new Error("Brand not found");
  }

  const { data: leads } = await supabase
    .from("leads")
    .select("id, stage")
    .eq("brand_id", brandId);

  const { data: consultants } = await supabase
    .from("consultant_brands")
    .select("consultant_id")
    .eq("brand_id", brandId);

  const { data: agents } = await supabase
    .from("ai_agents")
    .select("id")
    .eq("is_active", true);

  const checklist = [
    { item: "Brand record created in system", status: !!brand, critical: true },
    { item: "At least 1 consultant assigned to brand", status: (consultants?.length ?? 0) > 0, critical: true },
    { item: "AI agents active and ready", status: (agents?.length ?? 0) >= 5, critical: true },
    { item: "Lead pipeline has activity (3+ leads)", status: (leads?.length ?? 0) >= 3, critical: false },
    { item: "Brand status is active", status: brand.is_active === true, critical: true },
  ];

  const criticalFailures = checklist.filter((c) => c.critical && !c.status);
  const readyToLaunch = criticalFailures.length === 0;

  return {
    brand_name: brand.name,
    checklist,
    critical_failures: criticalFailures.map((c) => c.item),
    ready_to_launch: readyToLaunch,
    recommendation: readyToLaunch
      ? "GO: Brand meets minimum launch criteria"
      : `NO-GO: Fix ${criticalFailures.length} critical issue(s) before launch`,
  };
}

async function handleAnalyzeVelocity(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { brand_id } = body;

  try {
    const result = await analyzeProcessVelocity(brand_id as string | undefined, cid);
    return successResponse({ success: true, ...result }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 500, undefined, cid);
  }
}

async function handleReadinessAudit(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { brand_id } = body;

  if (!brand_id || typeof brand_id !== "string") {
    return errorResponse("Missing or invalid 'brand_id' (string required)", 400, undefined, cid);
  }

  try {
    const result = await runReadinessAudit(brand_id, cid);
    return successResponse({ success: true, ...result }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 500, undefined, cid);
  }
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

    // JWT required
    const authHeader = req.headers.get("Authorization") || "";
    const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
    if (!user) {
      return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
    }

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405, undefined, cid);
    }

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
      case "analyze_velocity":
        return await handleAnalyzeVelocity(req, cid);
      case "readiness_audit":
        return await handleReadinessAudit(req, cid);
      default:
        return errorResponse(`Unknown action: ${action}`, 400, undefined, cid);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errorResponse(message, 500, undefined, cid);
  }
});
