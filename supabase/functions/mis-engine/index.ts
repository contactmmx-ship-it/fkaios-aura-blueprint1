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
const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ──────────────────────────────────────────────
// Gather real metrics across the whole system
// ──────────────────────────────────────────────
async function gatherMetrics(cid: string) {
  structuredLog("INFO", "Gathering system metrics", {}, cid);

  const { data: leads, error: leadsErr } = await supabase.from("leads").select("*, brand:brand_id(name)");
  if (leadsErr) throw new Error(`Failed to fetch leads: ${leadsErr.message}`);

  const { data: invoices, error: invErr } = await supabase.from("invoices").select("*");
  if (invErr) throw new Error(`Failed to fetch invoices: ${invErr.message}`);

  const { data: payments, error: payErr } = await supabase.from("payments").select("*");
  if (payErr) throw new Error(`Failed to fetch payments: ${payErr.message}`);

  const { data: agents, error: agentsErr } = await supabase.from("ai_agents").select("*");
  if (agentsErr) throw new Error(`Failed to fetch agents: ${agentsErr.message}`);

  const { data: jobs, error: jobsErr } = await supabase.from("ai_jobs").select("status");
  if (jobsErr) throw new Error(`Failed to fetch jobs: ${jobsErr.message}`);

  const { data: brands, error: brandsErr } = await supabase.from("brands").select("*");
  if (brandsErr) throw new Error(`Failed to fetch brands: ${brandsErr.message}`);

  const { data: meetings, error: mtgErr } = await supabase.from("meetings").select("*");
  if (mtgErr) throw new Error(`Failed to fetch meetings: ${mtgErr.message}`);

  const leadsBySource: Record<string, number> = {};
  const leadsByStage: Record<string, number> = {};
  const leadsByBrand: Record<string, number> = {};

  for (const lead of leads ?? []) {
    const source = lead.source || "Manual Entry";
    leadsBySource[source] = (leadsBySource[source] || 0) + 1;
    leadsByStage[lead.stage] = (leadsByStage[lead.stage] || 0) + 1;
    const brandName = lead.brand?.name || "Unassigned";
    leadsByBrand[brandName] = (leadsByBrand[brandName] || 0) + 1;
  }

  const totalRevenue = (payments ?? [])
    .filter((p) => p.status === "Confirmed")
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const pendingRevenue = (invoices ?? [])
    .filter((i) => i.status === "Pending" || i.status === "Overdue")
    .reduce((sum, i) => sum + Number(i.amount || 0), 0);

  const jobStatusCounts: Record<string, number> = {};
  for (const job of jobs ?? []) {
    jobStatusCounts[job.status] = (jobStatusCounts[job.status] || 0) + 1;
  }

  const activeAgents = (agents ?? []).filter((a) => a.is_active === true).length;
  const totalTasksCompleted = (agents ?? []).reduce(
    (sum, a) => sum + (a.total_tasks_completed || 0),
    0,
  );

  return {
    total_leads: leads?.length ?? 0,
    leads_by_source: leadsBySource,
    leads_by_stage: leadsByStage,
    leads_by_brand: leadsByBrand,
    total_brands: brands?.length ?? 0,
    upcoming_meetings: (meetings ?? []).filter(
      (m) => m.scheduled_at && new Date(m.scheduled_at) > new Date()
    ).length,
    total_revenue_collected: totalRevenue,
    pending_revenue: pendingRevenue,
    active_agents: activeAgents,
    total_agents: agents?.length ?? 0,
    total_ai_tasks_completed: totalTasksCompleted,
    job_status_counts: jobStatusCounts,
  };
}

// ──────────────────────────────────────────────
// Generate AI-written founder briefing from real metrics
// ──────────────────────────────────────────────
async function generateFounderBriefing(metrics: Record<string, unknown>, cid: string) {
  if (!anthropicApiKey) {
    structuredLog("WARN", "No ANTHROPIC_API_KEY, returning placeholder briefing", {}, cid);
    return "PLACEHOLDER BRIEFING: Add ANTHROPIC_API_KEY to generate real founder briefings.\n\nRaw metrics:\n" +
      JSON.stringify(metrics, null, 2);
  }

  try {
    const systemPrompt = `You are the Strategy & MIS AI for Franchisee Kart, working toward the ₹1,100 Cr ecosystem mission by 2030. You write monthly founder briefings: what's winning, what's stuck, and 90-day action items. Think like a COO. Be direct, data-driven, no fluff. Use the real metrics provided — do not invent numbers.`;

    const userContent = `Generate a founder briefing based on this real data:\n${JSON.stringify(metrics, null, 2)}\n\nStructure: 1) Headline summary (1-2 sentences), 2) What's working, 3) What's stuck/at risk, 4) Top 3 action items for next 30 days.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      structuredLog("ERROR", "Claude API error in MIS briefing", { status: response.status, body: text }, cid);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    return data?.content?.[0]?.text ?? "No response generated";
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    structuredLog("ERROR", "Error generating briefing", { error: msg }, cid);
    return `Error generating briefing: ${msg}`;
  }
}

async function handleGenerateBriefing(cid: string) {
  structuredLog("INFO", "Generating founder briefing", {}, cid);

  try {
    const metrics = await gatherMetrics(cid);
    const briefing = await generateFounderBriefing(metrics, cid);

    await supabase.from("agent_activity_log").insert({
      agent_id: null,
      activity_type: "founder_briefing",
      title: "Monthly Founder Briefing Generated",
      description: briefing.slice(0, 500),
      metadata: { metrics, full_briefing: briefing },
    });

    return successResponse({
      success: true,
      metrics,
      briefing,
      generated_at: new Date().toISOString(),
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 500, undefined, cid);
  }
}

async function handleGetMetrics(cid: string) {
  try {
    const metrics = await gatherMetrics(cid);
    return successResponse({ success: true, metrics }, 200, cid);
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
      case "generate_briefing":
        return await handleGenerateBriefing(cid);
      case "get_metrics":
        return await handleGetMetrics(cid);
      default:
        return errorResponse(`Unknown action: ${action}`, 400, undefined, cid);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errorResponse(message, 500, undefined, cid);
  }
});
