// ═══════════════════════════════════════════════════════════════
// SYNC NOTE (repo sync, live v26 pulled 2026-07-05):
// Minor flag — dailyBriefing's "stage_changes" query (updated_at >= today,
// stage != 'Inquiry') also counts leads *created* today past Inquiry stage,
// so new leads can be double-counted as stage changes. Not fixed here.
// Function is otherwise real: genuine cross-table daily/weekly briefings,
// no invented numbers.
// ═══════════════════════════════════════════════════════════════
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
// Daily Briefing — data from today
// ──────────────────────────────────────────────
async function dailyBriefing(cid: string) {
  structuredLog("INFO", "Generating daily briefing", {}, cid);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  const { data: newLeads, error: newLeadsErr } = await supabase
    .from("leads")
    .select("id, name, city, source, stage, investment_capacity, created_at")
    .gte("created_at", todayISO)
    .order("created_at", { ascending: false });
  if (newLeadsErr) throw new Error(`Failed to fetch new leads: ${newLeadsErr.message}`);

  const { data: updatedLeads, error: updatedLeadsErr } = await supabase
    .from("leads")
    .select("id, name, stage, assigned_to, updated_at")
    .gte("updated_at", todayISO)
    .neq("stage", "Inquiry")
    .order("updated_at", { ascending: false });
  if (updatedLeadsErr) throw new Error(`Failed to fetch updated leads: ${updatedLeadsErr.message}`);

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const { data: meetingsToday, error: meetingsErr } = await supabase
    .from("meetings")
    .select("id, lead_id, consultant_id, scheduled_at, status, notes")
    .gte("scheduled_at", todayISO)
    .lte("scheduled_at", todayEnd.toISOString())
    .order("scheduled_at", { ascending: true });
  if (meetingsErr) throw new Error(`Failed to fetch meetings: ${meetingsErr.message}`);

  const { data: completedJobs, error: completedErr } = await supabase
    .from("ai_jobs")
    .select("id, type, agent_id, result, created_at, updated_at")
    .eq("status", "completed")
    .gte("updated_at", todayISO)
    .order("updated_at", { ascending: false });
  if (completedErr) throw new Error(`Failed to fetch completed jobs: ${completedErr.message}`);

  const { data: failedJobs, error: failedErr } = await supabase
    .from("ai_jobs")
    .select("id, type, agent_id, error, created_at, updated_at")
    .in("status", ["failed", "retry"])
    .gte("updated_at", todayISO)
    .order("updated_at", { ascending: false });
  if (failedErr) throw new Error(`Failed to fetch failed jobs: ${failedErr.message}`);

  const { data: paidInvoices, error: paidErr } = await supabase
    .from("invoices")
    .select("id, lead_id, type, amount, status, updated_at")
    .eq("status", "Paid")
    .gte("updated_at", todayISO)
    .order("updated_at", { ascending: false });
  if (paidErr) throw new Error(`Failed to fetch paid invoices: ${paidErr.message}`);

  const { data: pipeline, error: pipelineErr } = await supabase
    .from("leads")
    .select("stage")
    .eq("is_active", true);
  if (pipelineErr) throw new Error(`Failed to fetch pipeline: ${pipelineErr.message}`);

  const stageCounts: Record<string, number> = {};
  for (const lead of pipeline ?? []) {
    stageCounts[lead.stage] = (stageCounts[lead.stage] ?? 0) + 1;
  }

  const totalRevenueToday = (paidInvoices ?? []).reduce((sum, inv) => sum + Number(inv.amount), 0);

  return {
    date: todayISO.split("T")[0],
    summary: {
      new_leads: (newLeads ?? []).length,
      stage_changes: (updatedLeads ?? []).length,
      meetings_scheduled: (meetingsToday ?? []).length,
      jobs_completed: (completedJobs ?? []).length,
      jobs_failed: (failedJobs ?? []).length,
      invoices_paid: (paidInvoices ?? []).length,
      revenue_today: totalRevenueToday,
    },
    new_leads: newLeads ?? [],
    stage_changes: updatedLeads ?? [],
    meetings: meetingsToday ?? [],
    jobs_completed: completedJobs ?? [],
    jobs_failed: failedJobs ?? [],
    invoices_paid: paidInvoices ?? [],
    pipeline_snapshot: stageCounts,
  };
}

// ──────────────────────────────────────────────
// Weekly Briefing — data from the past 7 days
// ──────────────────────────────────────────────
async function weeklyBriefing(cid: string) {
  structuredLog("INFO", "Generating weekly briefing", {}, cid);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);
  const weekAgoISO = sevenDaysAgo.toISOString();

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  fourteenDaysAgo.setHours(0, 0, 0, 0);
  const prevWeekStartISO = fourteenDaysAgo.toISOString();

  const { data: newLeads, error: newLeadsErr } = await supabase
    .from("leads")
    .select("id, name, city, source, stage, investment_capacity, created_at")
    .gte("created_at", weekAgoISO)
    .order("created_at", { ascending: false });
  if (newLeadsErr) throw new Error(`Failed to fetch weekly leads: ${newLeadsErr.message}`);

  const { count: prevWeekLeadsCount } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .gte("created_at", prevWeekStartISO)
    .lt("created_at", weekAgoISO);

  const { data: meetings, error: meetingsErr } = await supabase
    .from("meetings")
    .select("id, lead_id, consultant_id, scheduled_at, status")
    .gte("scheduled_at", weekAgoISO)
    .order("scheduled_at", { ascending: true });
  if (meetingsErr) throw new Error(`Failed to fetch weekly meetings: ${meetingsErr.message}`);

  const { count: prevWeekMeetingsCount } = await supabase
    .from("meetings")
    .select("*", { count: "exact", head: true })
    .gte("scheduled_at", prevWeekStartISO)
    .lt("scheduled_at", weekAgoISO);

  const { data: completedJobs, error: completedErr } = await supabase
    .from("ai_jobs")
    .select("id, type, agent_id, updated_at")
    .eq("status", "completed")
    .gte("updated_at", weekAgoISO);
  if (completedErr) throw new Error(`Failed to fetch weekly completed jobs: ${completedErr.message}`);

  const { data: failedJobs, error: failedErr } = await supabase
    .from("ai_jobs")
    .select("id, type, agent_id, error, updated_at")
    .in("status", ["failed", "retry"])
    .gte("updated_at", weekAgoISO);
  if (failedErr) throw new Error(`Failed to fetch weekly failed jobs: ${failedErr.message}`);

  const { data: paidInvoices, error: paidErr } = await supabase
    .from("invoices")
    .select("id, lead_id, type, amount, updated_at")
    .eq("status", "Paid")
    .gte("updated_at", weekAgoISO);
  if (paidErr) throw new Error(`Failed to fetch weekly invoices: ${paidErr.message}`);

  const { data: prevWeekInvoices } = await supabase
    .from("invoices")
    .select("amount")
    .eq("status", "Paid")
    .gte("updated_at", prevWeekStartISO)
    .lt("updated_at", weekAgoISO);

  const { data: pipeline } = await supabase
    .from("leads")
    .select("stage")
    .eq("is_active", true);

  const stageCounts: Record<string, number> = {};
  for (const lead of pipeline ?? []) {
    stageCounts[lead.stage] = (stageCounts[lead.stage] ?? 0) + 1;
  }

  const convertedThisWeek = (newLeads ?? []).filter(
    (l) => l.stage !== "Inquiry" && l.stage !== "Contacted"
  ).length;
  const conversionRate = (newLeads ?? []).length > 0
    ? Math.round((convertedThisWeek / (newLeads ?? []).length) * 100)
    : 0;

  const { data: prevWeekLeads } = await supabase
    .from("leads")
    .select("stage")
    .gte("created_at", prevWeekStartISO)
    .lt("created_at", weekAgoISO);

  const prevConverted = (prevWeekLeads ?? []).filter(
    (l) => l.stage !== "Inquiry" && l.stage !== "Contacted"
  ).length;
  const prevConversionRate = (prevWeekLeads ?? []).length > 0
    ? Math.round((prevConverted / (prevWeekLeads ?? []).length) * 100)
    : 0;

  const { data: agentPerformance } = await supabase
    .from("ai_agents")
    .select("id, name, dept, task, total_tasks_completed, success_rate, last_active_at")
    .eq("is_active", true)
    .order("total_tasks_completed", { ascending: false });

  const { data: agentActivity } = await supabase
    .from("agent_activity_log")
    .select("agent_id, activity_type, created_at")
    .gte("created_at", weekAgoISO);

  const agentActivitySummary: Array<{
    agent_id: string;
    total_activities: number;
    tasks: number;
    chats: number;
  }> = [];

  const agentMap = new Map<string, { total: number; tasks: number; chats: number }>();
  for (const a of agentActivity ?? []) {
    const key = a.agent_id ?? "unknown";
    const entry = agentMap.get(key) ?? { total: 0, tasks: 0, chats: 0 };
    entry.total += 1;
    if (a.activity_type === "task") entry.tasks += 1;
    if (a.activity_type === "chat") entry.chats += 1;
    agentMap.set(key, entry);
  }

  for (const [agentId, stats] of agentMap) {
    agentActivitySummary.push({
      agent_id: agentId,
      total_activities: stats.total,
      tasks: stats.tasks,
      chats: stats.chats,
    });
  }

  agentActivitySummary.sort((a, b) => b.total_activities - a.total_activities);

  const totalRevenueThisWeek = (paidInvoices ?? []).reduce((sum, inv) => sum + Number(inv.amount), 0);
  const totalRevenuePrevWeek = (prevWeekInvoices ?? []).reduce((sum, inv) => sum + Number(inv.amount), 0);

  const { data: meetingLeads } = await supabase
    .from("leads")
    .select("id, stage, created_at, updated_at")
    .eq("stage", "Meeting Scheduled")
    .gte("updated_at", weekAgoISO);

  let pipelineVelocity = 0;
  const meetingLeadList = meetingLeads ?? [];
  if (meetingLeadList.length > 0) {
    const totalDays = meetingLeadList.reduce((sum, l) => {
      const created = new Date(l.created_at).getTime();
      const updated = new Date(l.updated_at).getTime();
      return sum + (updated - created) / (1000 * 60 * 60 * 24);
    }, 0);
    pipelineVelocity = Math.round((totalDays / meetingLeadList.length) * 10) / 10;
  }

  return {
    period: {
      from: weekAgoISO.split("T")[0],
      to: new Date().toISOString().split("T")[0],
    },
    summary: {
      new_leads: (newLeads ?? []).length,
      new_leads_change: prevWeekLeadsCount
        ? Math.round((((newLeads ?? []).length - prevWeekLeadsCount) / prevWeekLeadsCount) * 100)
        : null,
      meetings_scheduled: (meetings ?? []).length,
      meetings_change: prevWeekMeetingsCount
        ? Math.round((((meetings ?? []).length - prevWeekMeetingsCount) / prevWeekMeetingsCount) * 100)
        : null,
      jobs_completed: (completedJobs ?? []).length,
      jobs_failed: (failedJobs ?? []).length,
      invoices_paid: (paidInvoices ?? []).length,
      revenue_this_week: totalRevenueThisWeek,
      revenue_change: totalRevenuePrevWeek > 0
        ? Math.round(((totalRevenueThisWeek - totalRevenuePrevWeek) / totalRevenuePrevWeek) * 100)
        : null,
      conversion_rate: conversionRate,
      conversion_rate_change: prevConversionRate
        ? conversionRate - prevConversionRate
        : null,
      pipeline_velocity_days: pipelineVelocity,
    },
    conversion_rates: {
      this_week: conversionRate,
      previous_week: prevConversionRate,
      change: prevConversionRate ? conversionRate - prevConversionRate : null,
    },
    pipeline_velocity: {
      avg_days_inquiry_to_meeting: pipelineVelocity,
      based_on_leads: meetingLeadList.length,
    },
    agent_performance: (agentPerformance ?? []).map((a) => {
      const actSummary = agentActivitySummary.find((s) => s.agent_id === a.id);
      return {
        agent_id: a.id,
        name: a.name,
        dept: a.dept,
        task: a.task,
        total_tasks_completed: a.total_tasks_completed ?? 0,
        success_rate: a.success_rate ?? 0,
        last_active_at: a.last_active_at,
        weekly_activities: actSummary?.total_activities ?? 0,
        weekly_tasks: actSummary?.tasks ?? 0,
        weekly_chats: actSummary?.chats ?? 0,
      };
    }),
    pipeline_snapshot: stageCounts,
    new_leads: newLeads ?? [],
    meetings: meetings ?? [],
    invoices_paid: paidInvoices ?? [],
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

    // JWT required
    const authHeader = req.headers.get("Authorization") || "";
    const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
    if (!user) {
      return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
    }

    const url = new URL(req.url);

    // GET /reporting-engine/daily_briefing
    if (url.pathname === "/reporting-engine/daily_briefing" && req.method === "GET") {
      const briefing = await dailyBriefing(cid);
      return successResponse({ action: "daily_briefing", success: true, ...briefing }, 200, cid);
    }

    // GET /reporting-engine/weekly_briefing
    if (url.pathname === "/reporting-engine/weekly_briefing" && req.method === "GET") {
      const briefing = await weeklyBriefing(cid);
      return successResponse({ action: "weekly_briefing", success: true, ...briefing }, 200, cid);
    }

    // POST with action for flexibility
    if (req.method === "POST") {
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
        case "daily_briefing": {
          const briefing = await dailyBriefing(cid);
          return successResponse({ action: "daily_briefing", success: true, ...briefing }, 200, cid);
        }
        case "weekly_briefing": {
          const briefing = await weeklyBriefing(cid);
          return successResponse({ action: "weekly_briefing", success: true, ...briefing }, 200, cid);
        }
        default:
          return errorResponse(`Unknown action: ${action}`, 400, undefined, cid);
      }
    }

    return errorResponse("Method not allowed or unknown path", 405, undefined, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});
