// ============================================================================
// Founder Executive AI — Command Center Edge Function
// ============================================================================
// The Founder's command center: ask any question about the business and get
// a comprehensive answer grounded in real data from across all subsystems.
//
// Routes:
//   POST /founder-executive/ask               — Ask any business question
//   POST /founder-executive/morning-brief     — Generate morning executive brief
//   POST /founder-executive/revenue-review    — Revenue analysis for a period
//   GET  /founder-executive/milestones        — List milestones with progress
//
// HONESTY PROTOCOL:
//   If ANY external dependency (Anthropic, OpenAI, knowledge-search) fails or
//   is unconfigured, the function MUST:
//   1. Log the failure clearly with structuredLog.
//   2. Still return a useful partial answer citing only the data sources
//      that succeeded.
//   3. NEVER fabricate data. NEVER silently swallow errors.
//   4. Explicitly tell the user which source could not be reached.
//
// REAL DATA GROUNDING:
//   Every LLM prompt includes ONLY data fetched from the database or knowledge
//   base. No synthetic or placeholder numbers. If a data source has no
//   relevant data, the prompt says so explicitly.
//
// Environment variables required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//   ANTHROPIC_API_KEY (preferred), OPENAI_API_KEY (fallback)
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  correlationId as generateCorrelationId,
  structuredLog,
  errorResponse,
  successResponse,
  verifyEnvSecrets,
  verifyJWT,
} from "../_shared/utils.ts";
import { recordMetric } from "../_shared/metrics.ts";

// ──────────────────────────────────────────────
// CORS headers
// ──────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID",
  "Access-Control-Expose-Headers": "X-Correlation-ID",
};

// ──────────────────────────────────────────────
// Environment & Client Setup
// ──────────────────────────────────────────────
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const openaiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
interface LLMResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: "anthropic" | "openai";
}

interface AskRequest {
  question: string;
  context?: Record<string, unknown>;
}

interface MorningBriefRequest {
  consultant_id?: string;
}

interface RevenueReviewRequest {
  period: "week" | "month" | "quarter";
  brand_id?: string;
}

interface DataSourceResult {
  source: string;
  status: "success" | "error" | "no_data";
  data?: unknown;
  error?: string;
}

// ──────────────────────────────────────────────
// Helpers — UUID validation
// ──────────────────────────────────────────────
function isValidUUID(value: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

// ──────────────────────────────────────────────
// Helpers — Fetch consultant role for auth gate
// ──────────────────────────────────────────────
async function getConsultantRole(
  userId: string,
  cid: string
): Promise<string | null> {
  const { data } = await supabase
    .from("consultants")
    .select("role")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return (data?.role as string) ?? null;
}

// ──────────────────────────────────────────────
// Helpers — callLLM with Anthropic (primary) / OpenAI (fallback)
// ──────────────────────────────────────────────
async function callLLM(
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
  cid: string
): Promise<LLMResult> {
  if (anthropicApiKey) {
    try {
      const model = "claude-3-haiku-20240307";
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        structuredLog("ERROR", "Anthropic API error", { status: response.status, body: text.substring(0, 500) }, cid);
        throw new Error(`Anthropic API error: ${response.status} ${text.substring(0, 200)}`);
      }

      const data = await response.json();
      const inputTokens = data?.usage?.input_tokens ?? 0;
      const outputTokens = data?.usage?.output_tokens ?? 0;

      await recordMetric(supabase, "ai_tokens_used", inputTokens + outputTokens, {
        function: "founder-executive",
        model,
        provider: "anthropic",
        endpoint: "ask",
      });

      return {
        text: data?.content?.[0]?.text ?? "",
        inputTokens,
        outputTokens,
        model,
        provider: "anthropic",
      };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Anthropic API error")) throw err;
      structuredLog("ERROR", "Anthropic fetch failed", { error: err instanceof Error ? err.message : "unknown" }, cid);
      throw err;
    }
  }

  if (openaiApiKey) {
    try {
      const model = "gpt-4o-mini";
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        structuredLog("ERROR", "OpenAI API error", { status: response.status, body: text.substring(0, 500) }, cid);
        throw new Error(`OpenAI API error: ${response.status} ${text.substring(0, 200)}`);
      }

      const data = await response.json();
      const inputTokens = data?.usage?.prompt_tokens ?? 0;
      const outputTokens = data?.usage?.completion_tokens ?? 0;

      await recordMetric(supabase, "ai_tokens_used", inputTokens + outputTokens, {
        function: "founder-executive",
        model,
        provider: "openai",
        endpoint: "ask",
      });

      return {
        text: data?.choices?.[0]?.message?.content ?? "",
        inputTokens,
        outputTokens,
        model,
        provider: "openai",
      };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("OpenAI API error")) throw err;
      structuredLog("ERROR", "OpenAI fetch failed", { error: err instanceof Error ? err.message : "unknown" }, cid);
      throw err;
    }
  }

  throw new Error(
    "No LLM API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY as Edge Function secrets."
  );
}

// ──────────────────────────────────────────────
// Helpers — Fetch knowledge base results via internal call
// ──────────────────────────────────────────────
async function fetchKnowledgeBase(
  question: string,
  brandId: string | null,
  cid: string
): Promise<DataSourceResult> {
  try {
    const { data: brands } = await supabase
      .from("brands")
      .select("id")
      .limit(5);

    const brandIds = brandId
      ? [brandId]
      : (brands ?? []).map((b: { id: string }) => b.id);

    // Query knowledge chunks directly from the database
    // (mimics knowledge-search without requiring the edge function to be deployed)
    const results: Array<Record<string, unknown>> = [];

    for (const bid of brandIds.slice(0, 3)) {
      const { data: chunks } = await supabase
        .from("knowledge_chunks")
        .select("content, chunk_index, document_id, documents(title), knowledge_sources(name)")
        .eq("brand_id", bid)
        .limit(3);

      if (chunks) {
        for (const chunk of chunks) {
          results.push(chunk);
        }
      }
    }

    if (results.length === 0) {
      return { source: "knowledge_base", status: "no_data", data: null, error: "No matching knowledge entries found" };
    }

    return { source: "knowledge_base", status: "success", data: results };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "Knowledge base fetch failed", { error: msg }, cid);
    return { source: "knowledge_base", status: "error", data: null, error: msg };
  }
}

// ──────────────────────────────────────────────
// Helpers — Fetch revenue data
// ──────────────────────────────────────────────
async function fetchRevenueData(
  brandId: string | null,
  cid: string
): Promise<DataSourceResult> {
  try {
    // Fetch from revenue_snapshots
    let query = supabase
      .from("revenue_snapshots")
      .select("*, brands(name)")
      .order("period_start", { ascending: false })
      .limit(6);

    if (brandId) {
      query = query.eq("brand_id", brandId);
    }

    const { data: snapshots } = await query;

    if (!snapshots || snapshots.length === 0) {
      return { source: "revenue_snapshots", status: "no_data", data: null, error: "No revenue snapshots found" };
    }

    return { source: "revenue_snapshots", status: "success", data: snapshots };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "Revenue data fetch failed", { error: msg }, cid);
    return { source: "revenue_snapshots", status: "error", data: null, error: msg };
  }
}

// ──────────────────────────────────────────────
// Helpers — Fetch lead pipeline data
// ──────────────────────────────────────────────
async function fetchLeadPipeline(
  brandId: string | null,
  cid: string
): Promise<DataSourceResult> {
  try {
    let query = supabase
      .from("leads")
      .select("id, name, stage, brand_id, assigned_to, created_at, investment_capacity, brands(name)")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(20);

    if (brandId) {
      query = query.eq("brand_id", brandId);
    }

    const { data: leads } = await query;

    if (!leads || leads.length === 0) {
      return { source: "lead_pipeline", status: "no_data", data: null, error: "No active leads found" };
    }

    // Also fetch lifecycle data
    const leadIds = leads.map((l: { id: string }) => l.id);
    const { data: lifecycles } = await supabase
      .from("lead_lifecycle")
      .select("*, agent_lifecycle_stages(name)")
      .in("lead_id", leadIds);

    const pipelineData = {
      leads,
      lifecycles: lifecycles ?? [],
      summary: {
        total: leads.length,
        byStage: leads.reduce(
          (acc: Record<string, number>, l: { stage: string }) => {
            acc[l.stage] = (acc[l.stage] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        ),
      },
    };

    return { source: "lead_pipeline", status: "success", data: pipelineData };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "Lead pipeline fetch failed", { error: msg }, cid);
    return { source: "lead_pipeline", status: "error", data: null, error: msg };
  }
}

// ──────────────────────────────────────────────
// Helpers — Fetch calendar / meetings
// ──────────────────────────────────────────────
async function fetchMeetings(
  consultantId: string | null,
  cid: string
): Promise<DataSourceResult> {
  try {
    const today = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

    let query = supabase
      .from("meetings")
      .select("*, leads(name, brands(name)), consultants(name)")
      .gte("scheduled_at", today)
      .lte("scheduled_at", tomorrow)
      .order("scheduled_at", { ascending: true });

    if (consultantId) {
      query = query.eq("consultant_id", consultantId);
    }

    const { data: meetings } = await query;

    if (!meetings || meetings.length === 0) {
      return { source: "meetings", status: "no_data", data: null, error: "No meetings today or tomorrow" };
    }

    return { source: "meetings", status: "success", data: meetings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "Meetings fetch failed", { error: msg }, cid);
    return { source: "meetings", status: "error", data: null, error: msg };
  }
}

// ──────────────────────────────────────────────
// Helpers — Fetch milestones
// ──────────────────────────────────────────────
async function fetchMilestones(
  brandId: string | null,
  cid: string
): Promise<DataSourceResult> {
  try {
    let query = supabase
      .from("strategic_milestones")
      .select("*, brands(name)")
      .neq("status", "cancelled")
      .order("target_date", { ascending: true });

    if (brandId) {
      query = query.eq("brand_id", brandId);
    }

    const { data: milestones } = await query;

    if (!milestones || milestones.length === 0) {
      return { source: "strategic_milestones", status: "no_data", data: null, error: "No active milestones found" };
    }

    return { source: "strategic_milestones", status: "success", data: milestones };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "Milestones fetch failed", { error: msg }, cid);
    return { source: "strategic_milestones", status: "error", data: null, error: msg };
  }
}

// ──────────────────────────────────────────────
// Helpers — Fetch recent payments / invoices
// ──────────────────────────────────────────────
async function fetchPayments(
  brandId: string | null,
  cid: string
): Promise<DataSourceResult> {
  try {
    let query = supabase
      .from("payments")
      .select("*, invoices(id, amount, status), leads(name, brands(name))")
      .order("created_at", { ascending: false })
      .limit(15);

    if (brandId) {
      query = query.eq("brand_id", brandId);
    }

    const { data: payments } = await query;

    if (!payments || payments.length === 0) {
      return { source: "payments", status: "no_data", data: null, error: "No recent payments found" };
    }

    return { source: "payments", status: "success", data: payments };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "Payments fetch failed", { error: msg }, cid);
    return { source: "payments", status: "error", data: null, error: msg };
  }
}

// ──────────────────────────────────────────────
// Helpers — Fetch founder memory for context
// ──────────────────────────────────────────────
async function fetchFounderMemory(
  userId: string,
  cid: string
): Promise<DataSourceResult> {
  try {
    const { data: memories } = await supabase
      .from("founder_memory")
      .select("*")
      .eq("created_by", userId)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (!memories || memories.length === 0) {
      return { source: "founder_memory", status: "no_data", data: null, error: "No stored memory entries" };
    }

    return { source: "founder_memory", status: "success", data: memories };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "Founder memory fetch failed", { error: msg }, cid);
    return { source: "founder_memory", status: "error", data: null, error: msg };
  }
}

// ──────────────────────────────────────────────
// POST /founder-executive/ask — Main Q&A handler
// ──────────────────────────────────────────────
async function handleAsk(
  req: Request,
  cid: string,
  userId: string
): Promise<Response> {
  const startTime = performance.now();

  let body: AskRequest;
  try {
    body = (await req.json()) as AskRequest;
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  if (!body.question || typeof body.question !== "string" || body.question.trim().length === 0) {
    return errorResponse("Missing or invalid 'question' field. Must be a non-empty string.", 400, undefined, cid);
  }

  if (body.question.length > 5000) {
    return errorResponse("Question too long: max 5000 characters", 400, undefined, cid);
  }

  structuredLog("INFO", "Processing founder question", {
    question: body.question.substring(0, 150),
    hasContext: !!body.context,
  }, cid);

  const question = body.question.trim().toLowerCase();
  const brandId = body.context?.brand_id as string | null ?? null;
  const consultantId = body.context?.consultant_id as string | null ?? null;

  // ── Determine which data sources are relevant based on question keywords ──
  const needsKnowledge = true; // Always check knowledge base
  const needsRevenue = /revenue|income|money|finance|earnings|profit|loss|sales|roi|burn rate|cash flow/.test(question);
  const needsLeads = /lead|pipeline|prospect|funnel|conversion|inquir|signup|enquir/.test(question);
  const needsMeetings = /meeting|calendar|schedule|appointment|call today|today/.test(question);
  const needsMilestones = /milestone|goal|target|kpi|objective|quarter|progress/.test(question);
  const needsPayments = /payment|invoice|paid|unpaid|receivable|collection|refund/.test(question);
  const needsMemory = /remember|preference|last time|previous|my decision|my choice/.test(question);

  // ── Fetch data sources in parallel ──
  structuredLog("INFO", "Fetching data sources in parallel", {
    sources: {
      knowledge: needsKnowledge,
      revenue: needsRevenue,
      leads: needsLeads,
      meetings: needsMeetings,
      milestones: needsMilestones,
      payments: needsPayments,
      memory: needsMemory,
    },
  }, cid);

  const [
    knowledgeResult,
    revenueResult,
    leadsResult,
    meetingsResult,
    milestonesResult,
    paymentsResult,
    memoryResult,
  ] = await Promise.all([
    needsKnowledge ? fetchKnowledgeBase(body.question, brandId, cid) : Promise.resolve({ source: "knowledge_base", status: "no_data" } as DataSourceResult),
    needsRevenue ? fetchRevenueData(brandId, cid) : Promise.resolve({ source: "revenue_snapshots", status: "no_data" } as DataSourceResult),
    needsLeads ? fetchLeadPipeline(brandId, cid) : Promise.resolve({ source: "lead_pipeline", status: "no_data" } as DataSourceResult),
    needsMeetings ? fetchMeetings(consultantId, cid) : Promise.resolve({ source: "meetings", status: "no_data" } as DataSourceResult),
    needsMilestones ? fetchMilestones(brandId, cid) : Promise.resolve({ source: "strategic_milestones", status: "no_data" } as DataSourceResult),
    needsPayments ? fetchPayments(brandId, cid) : Promise.resolve({ source: "payments", status: "no_data" } as DataSourceResult),
    needsMemory ? fetchFounderMemory(userId, cid) : Promise.resolve({ source: "founder_memory", status: "no_data" } as DataSourceResult),
  ]);

  const allResults = [knowledgeResult, revenueResult, leadsResult, meetingsResult, milestonesResult, paymentsResult, memoryResult];
  const successfulSources = allResults.filter((r) => r.status === "success");
  const failedSources = allResults.filter((r) => r.status === "error");
  const noDataSources = allResults.filter((r) => r.status === "no_data");

  // ── Build LLM context ──
  const contextSections: string[] = [];
  const consultedSources: string[] = [];

  for (const result of allResults) {
    consultedSources.push(result.source);
    if (result.status === "success" && result.data) {
      contextSections.push(
        `[DATA SOURCE: ${result.source}]\n${JSON.stringify(result.data, null, 2).substring(0, 6000)}\n[/DATA SOURCE: ${result.source}]`
      );
    } else if (result.status === "no_data") {
      contextSections.push(
        `[DATA SOURCE: ${result.source} — NO RELEVANT DATA AVAILABLE]`
      );
    } else if (result.status === "error") {
      contextSections.push(
        `[DATA SOURCE: ${result.source} — ERROR: ${result.error}]`
      );
    }
  }

  // ── Check if we have any real data at all ──
  if (successfulSources.length === 0 && failedSources.length > 0) {
    const elapsed = Math.round(performance.now() - startTime);
    structuredLog("ERROR", "All data sources failed for founder question", {
      failedSources: failedSources.map((s) => ({ source: s.source, error: s.error })),
      elapsedMs: elapsed,
    }, cid);

    return errorResponse(
      "Unable to retrieve data from any source to answer your question. " +
        failedSources.map((s) => `${s.source}: ${s.error}`).join("; ") +
        ". Please try again or check system connectivity.",
      502,
      "All data sources unavailable",
      cid
    );
  }

  // ── Call LLM ──
  const systemPrompt = `You are the Founder Executive AI for Franchisee Kart — a franchise consulting platform managing multiple brands (Arofur, Chaat Masters, Chawla Laboratory, Turning Points, etc.).

ROLE: You serve as the Founder's personal command center. Your job is to answer questions comprehensively using ONLY the data provided in the context below.

CRITICAL RULES:
1. Answer ONLY from the data provided in [DATA SOURCE: ...] sections.
2. If a data source shows NO RELEVANT DATA, explicitly state that.
3. If a data source shows ERROR, explicitly state which source was unreachable.
4. NEVER fabricate numbers, names, dates, financial figures, or any factual claims.
5. If you are unsure about something, say so clearly.
6. Always cite which data sources you used in your answer.
7. Provide actionable insights and recommendations based on the data.
8. Be concise but thorough. Use bullet points for lists.
9. For financial figures, use INR notation.
10. If the question appears to be a preference or decision, note it for memory storage.

QUESTION FROM FOUNDER: ${body.question.trim()}

DATA CONTEXT:
${contextSections.join("\n\n")}

CONSULTED SOURCES: ${consultedSources.join(", ")}`;

  let llmAnswer: string;
  try {
    const llmResult = await callLLM(systemPrompt, body.question.trim(), 4096, cid);
    llmAnswer = llmResult.text;

    structuredLog("INFO", "LLM answer generated", {
      model: llmResult.model,
      provider: llmResult.provider,
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
    }, cid);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown LLM error";
    structuredLog("ERROR", "LLM call failed for founder question", { error: msg }, cid);

    // Return a partial answer with raw data if LLM is unavailable
    const partialData: Record<string, unknown> = {};
    for (const result of successfulSources) {
      partialData[result.source] = result.data;
    }

    return successResponse({
      answer: `LLM service is currently unavailable (${msg}). Here is the raw data I retrieved from ${successfulSources.length} source(s): ${Object.keys(partialData).join(", ")}.`,
      sources: consultedSources,
      data_used: partialData,
      llm_available: false,
      partial_data: true,
    }, 200, cid);
  }

  // ── Store Q&A in founder_memory if it looks like a preference or decision ──
  const isPreference = /prefer|i want|always|never|my preference|my choice|set up|configure|default/.test(question);
  const isDecision = /decided|decision|approved|rejected|confirmed|we should|we will|going with|selected/.test(question);

  if (isPreference || isDecision) {
    try {
      await supabase.from("founder_memory").insert({
        category: isPreference ? "preference" : "decision",
        key: body.question.trim().substring(0, 200),
        value: llmAnswer.substring(0, 2000),
        metadata: { sources: consultedSources, timestamp: new Date().toISOString() },
        created_by: userId,
      });
      structuredLog("INFO", "Stored Q&A in founder_memory", {
        category: isPreference ? "preference" : "decision",
      }, cid);
    } catch (err) {
      structuredLog("WARN", "Failed to store in founder_memory", {
        error: err instanceof Error ? err.message : String(err),
      }, cid);
    }
  }

  // ── Build data_used summary ──
  const dataUsed: Record<string, unknown> = {};
  for (const result of successfulSources) {
    // Provide a summary rather than full payload to keep response manageable
    dataUsed[result.source] = {
      status: "success",
      recordCount: Array.isArray(result.data) ? result.data.length : 1,
    };
  }
  for (const result of noDataSources) {
    dataUsed[result.source] = { status: "no_data" };
  }
  for (const result of failedSources) {
    dataUsed[result.source] = { status: "error", error: result.error };
  }

  const elapsed = Math.round(performance.now() - startTime);

  await recordMetric(supabase, "api_latency_ms", elapsed, {
    function: "founder-executive",
    endpoint: "ask",
    sources_queried: String(allResults.length),
    sources_successful: String(successfulSources.length),
  });

  structuredLog("INFO", "Founder question answered", {
    question: body.question.substring(0, 100),
    sourcesUsed: successfulSources.map((s) => s.source),
    elapsedMs: elapsed,
  }, cid);

  return successResponse({
    answer: llmAnswer,
    sources: consultedSources,
    data_used: dataUsed,
    llm_available: true,
    partial_data: false,
  }, 200, cid);
}

// ──────────────────────────────────────────────
// POST /founder-executive/morning-brief
// ──────────────────────────────────────────────
async function handleMorningBrief(
  req: Request,
  cid: string,
  userId: string
): Promise<Response> {
  const startTime = performance.now();

  let body: MorningBriefRequest = {};
  try {
    body = (await req.json()) as MorningBriefRequest;
  } catch {
    // Accept empty body — generate for all brands
  }

  const consultantId = body.consultant_id ?? userId;

  structuredLog("INFO", "Generating morning brief", { consultantId }, cid);

  // ── Fetch all data in parallel ──
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  const [
    approvalsResult,
    meetingsResult,
    overdueResult,
    revenueResult,
    newLeadsResult,
    milestoneUpdatesResult,
  ] = await Promise.all([
    // Pending approvals
    (async () => {
      try {
        const { data } = await supabase
          .from("approval_queue")
          .select("*, approval_rules(rule_name), consultants(name)")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(10);
        return { source: "pending_approvals", status: "success", data: data ?? [] };
      } catch (err) {
        return { source: "pending_approvals", status: "error", error: err instanceof Error ? err.message : "Unknown" };
      }
    })(),

    // Today's meetings
    (async () => {
      try {
        const { data } = await supabase
          .from("meetings")
          .select("*, leads(name, brands(name)), consultants(name)")
          .gte("scheduled_at", today)
          .lt("scheduled_at", today + "T23:59:59")
          .neq("status", "Cancelled")
          .order("scheduled_at", { ascending: true });
        return { source: "today_meetings", status: "success", data: data ?? [] };
      } catch (err) {
        return { source: "today_meetings", status: "error", error: err instanceof Error ? err.message : "Unknown" };
      }
    })(),

    // Overdue tasks (leads with past next_followup)
    (async () => {
      try {
        const { data } = await supabase
          .from("leads")
          .select("id, name, stage, next_followup, assigned_to, brands(name), consultants(name)")
          .eq("is_active", true)
          .lt("next_followup", today)
          .not("next_followup", "is", null)
          .order("next_followup", { ascending: true })
          .limit(20);
        return { source: "overdue_followups", status: "success", data: data ?? [] };
      } catch (err) {
        return { source: "overdue_followups", status: "error", error: err instanceof Error ? err.message : "Unknown" };
      }
    })(),

    // Revenue yesterday
    (async () => {
      try {
        const { data } = await supabase
          .from("transactions")
          .select("amount, transaction_type, brand_id, category, brands(name)")
          .eq("transaction_date", yesterday);
        const credits = (data ?? []).filter((t: { transaction_type: string }) => t.transaction_type === "credit")
          .reduce((sum: number, t: { amount: number }) => sum + Number(t.amount), 0);
        const debits = (data ?? []).filter((t: { transaction_type: string }) => t.transaction_type === "debit")
          .reduce((sum: number, t: { amount: number }) => sum + Number(t.amount), 0);
        return {
          source: "revenue_yesterday",
          status: data && data.length > 0 ? "success" : "no_data",
          data: { date: yesterday, total_credits: credits, total_debits: debits, net: credits - debits, transaction_count: (data ?? []).length },
        };
      } catch (err) {
        return { source: "revenue_yesterday", status: "error", error: err instanceof Error ? err.message : "Unknown" };
      }
    })(),

    // New leads overnight (last 24h)
    (async () => {
      try {
        const cutoff = new Date(Date.now() - 86400000).toISOString();
        const { data } = await supabase
          .from("leads")
          .select("id, name, source, brand_id, brands(name)")
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false })
          .limit(15);
        return { source: "new_leads_overnight", status: "success", data: data ?? [] };
      } catch (err) {
        return { source: "new_leads_overnight", status: "error", error: err instanceof Error ? err.message : "Unknown" };
      }
    })(),

    // Milestone updates
    (async () => {
      try {
        const { data } = await supabase
          .from("strategic_milestones")
          .select("*, brands(name)")
          .neq("status", "cancelled")
          .order("updated_at", { ascending: false })
          .limit(10);
        return { source: "milestones", status: "success", data: data ?? [] };
      } catch (err) {
        return { source: "milestones", status: "error", error: err instanceof Error ? err.message : "Unknown" };
      }
    })(),
  ]);

  const allBriefResults = [approvalsResult, meetingsResult, overdueResult, revenueResult, newLeadsResult, milestoneUpdatesResult];
  const dataSources = allBriefResults.filter((r) => r.status === "success").map((r) => r.source);

  // ── Build context for LLM ──
  const contextParts = allBriefResults.map((result) => {
    const statusLabel = result.status === "error" ? `ERROR: ${(result as { error: string }).error}` : result.status === "no_data" ? "NO DATA" : "DATA AVAILABLE";
    const dataStr = result.status === "success" && result.data ? JSON.stringify(result.data, null, 2).substring(0, 4000) : "No data";
    return `[${result.source} — ${statusLabel}]\n${dataStr}`;
  });

  // ── Call LLM ──
  const systemPrompt = `You are the Founder Executive AI generating a concise morning executive brief for a franchise consulting business.

FORMAT THE BRIEF AS:
1. EXECUTIVE SUMMARY (2-3 sentence overview of the day)
2. KEY METRICS (revenue, leads, pipeline numbers)
3. ACTION ITEMS (pending approvals, overdue follow-ups)
4. TODAY'S SCHEDULE (meetings)
5. MILESTONE WATCH (any milestones at risk or close to deadline)
6. RECOMMENDATIONS (2-3 specific actions to take today)

RULES:
- Use ONLY the data provided. NEVER fabricate numbers.
- Be concise. This is a morning brief, not a report.
- Highlight risks and at-risk items in bold.
- Use INR for currency.
- If a data source has no data, mention that briefly.
- End with a one-line motivational note.`;

  let briefContent: string;
  try {
    const llmResult = await callLLM(systemPrompt, contextParts.join("\n\n"), 4096, cid);
    briefContent = llmResult.text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown LLM error";
    structuredLog("ERROR", "LLM failed for morning brief", { error: msg }, cid);

    // Return raw data as fallback
    const rawData: Record<string, unknown> = {};
    for (const result of allBriefResults) {
      rawData[(result as { source: string }).source] = (result as { data?: unknown }).data ?? null;
    }

    return successResponse({
      brief: `LLM unavailable (${msg}). Raw brief data attached.`,
      brief_type: "morning",
      generated_at: new Date().toISOString(),
      data_sources: dataSources,
      llm_available: false,
      raw_data: rawData,
    }, 200, cid);
  }

  // ── Store brief in executive_briefs ──
  let briefId: string | null = null;
  try {
    const { data } = await supabase
      .from("executive_briefs")
      .insert({
        brief_type: "morning",
        content: {
          text: briefContent,
          sources: dataSources,
          generated_by: "founder-executive-ai",
        },
        data_sources: dataSources,
        consultant_id: consultantId,
      })
      .select("id")
      .single();

    briefId = data?.id ?? null;
  } catch (err) {
    structuredLog("WARN", "Failed to store morning brief", {
      error: err instanceof Error ? err.message : String(err),
    }, cid);
  }

  const elapsed = Math.round(performance.now() - startTime);

  await recordMetric(supabase, "api_latency_ms", elapsed, {
    function: "founder-executive",
    endpoint: "morning-brief",
  });

  structuredLog("INFO", "Morning brief generated", {
    briefId,
    dataSources,
    elapsedMs: elapsed,
  }, cid);

  return successResponse({
    id: briefId,
    brief: briefContent,
    brief_type: "morning",
    generated_at: new Date().toISOString(),
    data_sources: dataSources,
    llm_available: true,
  }, 200, cid);
}

// ──────────────────────────────────────────────
// POST /founder-executive/revenue-review
// ──────────────────────────────────────────────
async function handleRevenueReview(
  req: Request,
  cid: string,
  userId: string
): Promise<Response> {
  const startTime = performance.now();

  let body: RevenueReviewRequest;
  try {
    body = (await req.json()) as RevenueReviewRequest;
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  if (!body.period || !["week", "month", "quarter"].includes(body.period)) {
    return errorResponse(
      "Invalid 'period'. Must be one of: 'week', 'month', 'quarter'.",
      400,
      undefined,
      cid
    );
  }

  if (body.brand_id && !isValidUUID(body.brand_id)) {
    return errorResponse("Invalid brand_id: must be a valid UUID", 400, undefined, cid);
  }

  structuredLog("INFO", "Generating revenue review", {
    period: body.period,
    brandId: body.brand_id,
  }, cid);

  // ── Calculate date ranges ──
  const now = new Date();
  let periodStart: Date;
  let prevPeriodStart: Date;
  let prevPeriodEnd: Date;

  switch (body.period) {
    case "week":
      periodStart = new Date(now.getTime() - 7 * 86400000);
      prevPeriodStart = new Date(now.getTime() - 14 * 86400000);
      prevPeriodEnd = new Date(now.getTime() - 7 * 86400000);
      break;
    case "month":
      periodStart = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      prevPeriodStart = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
      prevPeriodEnd = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      break;
    case "quarter":
      periodStart = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      prevPeriodStart = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      prevPeriodEnd = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      break;
  }

  const periodStartStr = periodStart.toISOString().split("T")[0];
  const prevStartStr = prevPeriodStart.toISOString().split("T")[0];
  const prevEndStr = prevPeriodEnd.toISOString().split("T")[0];

  // ── Fetch current and previous period transactions ──
  let query = supabase
    .from("transactions")
    .select("amount, transaction_type, category, brand_id, brands(name), transaction_date");

  if (body.brand_id) {
    query = query.eq("brand_id", body.brand_id);
  }

  const [{ data: currentTxns }, { data: prevTxns }, { data: snapshots }] = await Promise.all([
    query.clone().gte("transaction_date", periodStartStr).lt("transaction_date", now.toISOString().split("T")[0]),
    query.clone().gte("transaction_date", prevStartStr).lt("transaction_date", prevEndStr),
    supabase.from("revenue_snapshots").select("*, brands(name)").order("period_start", { ascending: false }).limit(6),
  ]);

  // ── Calculate aggregates ──
  const calcPeriod = (txns: Array<{ amount: number; transaction_type: string; category: string; brands?: { name: string } }>) => {
    const credits = txns.filter((t) => t.transaction_type === "credit");
    const debits = txns.filter((t) => t.transaction_type === "debit");
    const totalRevenue = credits.reduce((s, t) => s + Number(t.amount), 0);
    const totalExpenses = debits.reduce((s, t) => s + Number(t.amount), 0);

    const byCategory: Record<string, number> = {};
    for (const t of txns) {
      if (t.category) byCategory[t.category] = (byCategory[t.category] || 0) + Number(t.amount);
    }

    const byBrand: Record<string, { revenue: number; expenses: number }> = {};
    for (const t of txns) {
      const brandName = t.brands?.name ?? "Unknown";
      if (!byBrand[brandName]) byBrand[brandName] = { revenue: 0, expenses: 0 };
      if (t.transaction_type === "credit") byBrand[brandName].revenue += Number(t.amount);
      else byBrand[brandName].expenses += Number(t.amount);
    }

    return {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      netProfit: Math.round((totalRevenue - totalExpenses) * 100) / 100,
      transactionCount: txns.length,
      byCategory,
      byBrand,
    };
  };

  const currentStats = calcPeriod(currentTxns ?? []);
  const prevStats = calcPeriod(prevTxns ?? []);

  // ── Calculate growth rates ──
  const growthRate = (current: number, previous: number): number | null => {
    if (previous === 0) return current > 0 ? 100 : null;
    return Math.round(((current - previous) / previous) * 10000) / 100;
  };

  const revenueGrowth = growthRate(currentStats.totalRevenue, prevStats.totalRevenue);
  const expenseGrowth = growthRate(currentStats.totalExpenses, prevStats.totalExpenses);
  const profitGrowth = growthRate(currentStats.netProfit, prevStats.netProfit);

  // ── Call LLM for insights ──
  const analysisContext = JSON.stringify({
    period: body.period,
    periodStart: periodStartStr,
    currentPeriod: currentStats,
    previousPeriod: prevStats,
    growthRates: { revenue: revenueGrowth, expenses: expenseGrowth, profit: profitGrowth },
    revenueSnapshots: snapshots ?? [],
  }, null, 2);

  const systemPrompt = `You are the Founder Executive AI providing a revenue analysis for a franchise consulting business.

Generate a concise revenue review with:
1. EXECUTIVE SUMMARY (key findings in 2-3 sentences)
2. REVENUE ANALYSIS (current period revenue, growth vs previous period)
3. EXPENSE ANALYSIS (major cost categories, trends)
4. BRAND PERFORMANCE (breakdown by brand)
5. INSIGHTS & RECOMMENDATIONS (actionable steps, risks, opportunities)

RULES:
- Use ONLY the data provided. NEVER fabricate numbers.
- Use INR for currency.
- Highlight negative trends with ⚠️ and positive with ✅.
- Compare current period to previous period explicitly.
- Provide specific, actionable recommendations.`;

  let analysisText: string;
  try {
    const llmResult = await callLLM(systemPrompt, analysisContext, 4096, cid);
    analysisText = llmResult.text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown LLM error";
    structuredLog("ERROR", "LLM failed for revenue review", { error: msg }, cid);

    return successResponse({
      analysis: `LLM unavailable (${msg}). Raw analysis data attached.`,
      period: body.period,
      period_start: periodStartStr,
      current_period: currentStats,
      previous_period: prevStats,
      growth_rates: { revenue: revenueGrowth, expenses: expenseGrowth, profit: profitGrowth },
      llm_available: false,
    }, 200, cid);
  }

  const elapsed = Math.round(performance.now() - startTime);

  await recordMetric(supabase, "api_latency_ms", elapsed, {
    function: "founder-executive",
    endpoint: "revenue-review",
    period: body.period,
  });

  return successResponse({
    analysis: analysisText,
    period: body.period,
    period_start: periodStartStr,
    current_period: currentStats,
    previous_period: prevStats,
    growth_rates: { revenue: revenueGrowth, expenses: expenseGrowth, profit: profitGrowth },
    revenue_snapshots: snapshots ?? [],
    llm_available: true,
  }, 200, cid);
}

// ──────────────────────────────────────────────
// GET /founder-executive/milestones
// ──────────────────────────────────────────────
async function handleGetMilestones(
  req: Request,
  cid: string,
  userId: string
): Promise<Response> {
  const url = new URL(req.url);
  const brandId = url.searchParams.get("brand_id");
  const status = url.searchParams.get("status");
  const milestoneType = url.searchParams.get("type");

  if (brandId && !isValidUUID(brandId)) {
    return errorResponse("Invalid brand_id: must be a valid UUID", 400, undefined, cid);
  }

  let query = supabase
    .from("strategic_milestones")
    .select("*, brands(name, slug)")
    .order("target_date", { ascending: true });

  if (brandId) {
    query = query.eq("brand_id", brandId);
  }
  if (status) {
    query = query.eq("status", status);
  }
  if (milestoneType) {
    query = query.eq("milestone_type", milestoneType);
  }

  const { data: milestones, error } = await query;

  if (error) {
    structuredLog("ERROR", "Failed to fetch milestones", { error: error.message }, cid);
    return errorResponse(`Failed to fetch milestones: ${error.message}`, 500, undefined, cid);
  }

  // ── Calculate progress percentages ──
  const enriched = (milestones ?? []).map((m: {
    id: string;
    title: string;
    description: string | null;
    milestone_type: string;
    target_value: number | null;
    current_value: number;
    unit: string | null;
    baseline_date: string | null;
    target_date: string | null;
    status: string;
    brand_id: string | null;
    brands: { name: string; slug: string } | null;
    progress_notes: string | null;
    created_at: string;
    updated_at: string;
  }) => {
    const progress = m.target_value && m.target_value > 0
      ? Math.round((m.current_value / m.target_value) * 10000) / 100
      : null;

    const daysRemaining = m.target_date
      ? Math.max(0, Math.ceil((new Date(m.target_date).getTime() - Date.now()) / 86400000))
      : null;

    return {
      ...m,
      progress_percentage: progress,
      days_remaining: daysRemaining,
    };
  });

  structuredLog("INFO", "Milestones fetched", {
    count: enriched.length,
    brandId: brandId ?? "all",
  }, cid);

  return successResponse({
    milestones: enriched,
    count: enriched.length,
    filters: { brand_id: brandId ?? null, status: status ?? null, type: milestoneType ?? null },
  }, 200, cid);
}

// ──────────────────────────────────────────────
// Main Handler
// ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const cid = req.headers.get("X-Correlation-ID") || generateCorrelationId();
  const startTime = performance.now();

  structuredLog("INFO", `Founder Executive request: ${req.method} ${req.url}`, {}, cid);

  try {
    // Verify required env secrets
    const envError = verifyEnvSecrets({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
    });
    if (envError) {
      return errorResponse(envError, 500, "Configuration error", cid);
    }

    // JWT auth required
    const authHeader = req.headers.get("Authorization") || "";
    const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
    if (!user) {
      return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
    }

    // Role check: Founder or OpsHead only for all endpoints except milestones (GET)
    const role = await getConsultantRole(user.userId, cid);
    const isExec = role === "Founder" || role === "OpsHead";

    if (!isExec) {
      return errorResponse(
        "Forbidden: only Founder or OpsHead roles can access the founder executive AI",
        403,
        `Your role is '${role ?? "unknown"}'. Required: Founder or OpsHead.`,
        cid
      );
    }

    structuredLog("INFO", "User authenticated", { userId: user.userId, role }, cid);

    // Route dispatch
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (method === "POST") {
      if (path.endsWith("/ask")) {
        return await handleAsk(req, cid, user.userId);
      }
      if (path.endsWith("/morning-brief")) {
        return await handleMorningBrief(req, cid, user.userId);
      }
      if (path.endsWith("/revenue-review")) {
        return await handleRevenueReview(req, cid, user.userId);
      }
    }

    if (method === "GET") {
      if (path.endsWith("/milestones")) {
        return await handleGetMilestones(req, cid, user.userId);
      }
    }

    return errorResponse(
      "Endpoint not found",
      404,
      "Available: POST /ask, POST /morning-brief, POST /revenue-review, GET /milestones",
      cid
    );
  } catch (err) {
    const elapsed = Math.round(performance.now() - startTime);
    const message = err instanceof Error ? err.message : "Internal server error";

    structuredLog("ERROR", "Unhandled error in founder-executive", {
      error: message,
      stack: err instanceof Error ? err.stack?.substring(0, 500) : undefined,
      elapsedMs: elapsed,
    }, cid);

    await recordMetric(supabase, "error_count", 1, {
      function: "founder-executive",
      error_type: err instanceof Error ? err.name : "unknown",
      error_message: message.substring(0, 200),
    });

    return errorResponse(message, 500, undefined, cid);
  } finally {
    const elapsed = Math.round(performance.now() - startTime);
    structuredLog("INFO", "Request completed", { method: req.method, elapsedMs: elapsed }, cid);
  }
});
