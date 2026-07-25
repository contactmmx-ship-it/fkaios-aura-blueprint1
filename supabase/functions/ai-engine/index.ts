/// <reference lib="deno.ns" />
// ai-engine v41 — FABRICATION REMOVED.
//
// INCIDENT 2026-07-13: executeJob() ended in a catch-all that returned a
// "No LLM key configured — simulated placeholder" object on ANY failure (rate
// limit, API error, JSON parse). runJobs() then wrote that fabricated object with
// status='completed'. ANTHROPIC_API_KEY IS set, so the message lied about its own
// cause as well. 5,970 jobs — 2,982 GENERATE_INVOICE and 2,982 GENERATE_PROPOSAL
// among them — were recorded as completed work that NEVER HAPPENED. After
// quarantine, jobs still claiming 'completed' = ZERO: there was never any real
// completed work in this queue.
//
// THE RULE THIS ENFORCES NOW: a catch block that RETURNS data instead of
// re-throwing is a fake-data generator. An outage is visible; a fabrication is
// trusted. On failure we FAIL LOUDLY — the job goes to retry/failed with the real
// error, the Silence Monitor sees it, and nothing pretends to have worked.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  correlationId as generateCorrelationId,
  structuredLog,
  errorResponse,
  successResponse,
  verifyEnvSecrets,
  verifyJWT,
} from "../_shared/utils.ts";
import {
  callLLM as routedCallLLM,
  buildDefaultRouterConfig,
} from "../_shared/llm-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function getFounderPrinciplesBlock(agentName: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from("founder_principles")
      .select("principle, weight, applies_to")
      .eq("active", true)
      .order("weight", { ascending: false });
    if (error || !data) return "";
    const relevant = data.filter((p: any) => Array.isArray(p.applies_to) && (p.applies_to.includes("*") || p.applies_to.includes(agentName)));
    if (relevant.length === 0) return "";
    return `\n\n=== FOUNDER OPERATING PRINCIPLES (non-negotiable — apply these to every response below) ===\n${relevant.map((p: any) => `- ${p.principle}`).join("\n")}\n=== END FOUNDER OPERATING PRINCIPLES ===`;
  } catch {
    return "";
  }
}

const RATE_LIMIT_COOLDOWN_SECONDS = 30;
const TOKEN_PRICING = {
  anthropic: { inputPerMtok: 0.25, outputPerMtok: 1.25 },
  openai: { inputPerMtok: 0.15, outputPerMtok: 0.60 },
} as const;
type TokenPricingProvider = keyof typeof TOKEN_PRICING;

interface AIJob {
  id: string; agent_id: string | null; type: string; payload: Record<string, unknown>;
  status: string; result: Record<string, unknown> | null; retry_count: number; created_at: string; updated_at: string;
}
interface LLMResult { text: string; inputTokens: number; outputTokens: number; model: string; provider: TokenPricingProvider; }

async function checkRateLimit(agentId: string, cid: string): Promise<void> {
  const { data: rateRecord } = await supabase
    .from("agent_memory").select("id, content, last_accessed_at")
    .eq("agent_id", agentId).eq("memory_type", "rate_limit").eq("content->>key", "last_call").maybeSingle();
  if (rateRecord?.last_accessed_at) {
    const elapsed = (Date.now() - new Date(rateRecord.last_accessed_at).getTime()) / 1000;
    if (elapsed < RATE_LIMIT_COOLDOWN_SECONDS) {
      const waitSeconds = Math.ceil(RATE_LIMIT_COOLDOWN_SECONDS - elapsed);
      structuredLog("WARN", `Rate limit hit for agent ${agentId}`, { agentId, elapsed: elapsed.toFixed(1), waitSeconds }, cid);
      throw new Error(`Rate limit: agent ${agentId} called too soon. Please wait ${waitSeconds}s.`);
    }
  }
  if (rateRecord) {
    await supabase.from("agent_memory").update({ last_accessed_at: new Date().toISOString() }).eq("id", rateRecord.id);
  } else {
    await supabase.from("agent_memory").insert({ agent_id: agentId, memory_type: "rate_limit", content: { key: "last_call" }, last_accessed_at: new Date().toISOString() });
  }
}

async function trackTokenUsage(agentId: string | null, model: string, inputTokens: number, outputTokens: number, provider: TokenPricingProvider, cid: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await supabase.from("agent_memory").select("id, content").eq("agent_id", agentId).eq("memory_type", "usage").eq("content->>date", today).maybeSingle();
  const currentInput = (existing?.content?.input_tokens as number) ?? 0;
  const currentOutput = (existing?.content?.output_tokens as number) ?? 0;
  const usageContent = { date: today, model, provider, input_tokens: currentInput + inputTokens, output_tokens: currentOutput + outputTokens, call_count: ((existing?.content?.call_count as number) ?? 0) + 1 };
  if (existing) {
    await supabase.from("agent_memory").update({ content: usageContent, last_accessed_at: new Date().toISOString() }).eq("id", existing.id);
  } else {
    await supabase.from("agent_memory").insert({ agent_id: agentId, memory_type: "usage", content: usageContent, memory_category: "task_result", last_accessed_at: new Date().toISOString() });
  }
  // LLM EXECUTION GRAPH: real cost, real model, real objective — no longer invisible.
  const pricing = TOKEN_PRICING[provider] ?? TOKEN_PRICING.anthropic;
  const costUsd = (inputTokens / 1_000_000) * pricing.inputPerMtok + (outputTokens / 1_000_000) * pricing.outputPerMtok;
  await supabase.from("agent_performance_metrics").insert({
    agent_id: agentId ?? "ai-engine", task_type: "ai_job", estimated_cost_usd: costUsd,
    input_tokens: inputTokens, output_tokens: outputTokens, success: true,
    model, provider, prompt_version: "ai-engine-v41", department: "OPERATIONS",
    business_objective: "Execute queued enterprise work (ai_jobs)",
  });
  structuredLog("INFO", "Token usage tracked", { agentId, model, inputTokens, outputTokens, today, provider }, cid);
}

function validateGrounding(response: string, context: string, cid: string): void {
  const responseTerms = new Set([...response.matchAll(/"[^"]{3,}"/g)].map((m) => m[0].toLowerCase()));
  const contextLower = context.toLowerCase();
  const ungrounded = [...responseTerms].filter((term) => !contextLower.includes(term));
  if (ungrounded.length > 0) {
    structuredLog("WARN", "Possible ungrounded data in LLM response", { ungroundedTerms: ungrounded.slice(0, 5), cid }, cid);
  }
}

async function executeJob(job: AIJob, cid: string): Promise<Record<string, unknown>> {
  structuredLog("INFO", `Executing job ${job.id} (type: ${job.type})`, { jobId: job.id, agentId: job.agent_id }, cid);
  if (job.agent_id) {
    await checkRateLimit(job.agent_id, cid);
    const { data: agent } = await supabase.from("ai_agents").select("*").eq("id", job.agent_id).single();
    if (agent?.prompt) {
      let groundedContext = "";
      if (job.payload?.lead_id) {
        const { data: lead } = await supabase.from("leads").select("*, brands(name, investment_range, royalty, sector)").eq("id", job.payload.lead_id as string).maybeSingle();
        if (lead) groundedContext = `\n\n[REAL DATA CONTEXT — DO NOT FABRICATE]\nLead: ${JSON.stringify(lead)}\n[/REAL DATA CONTEXT]`;
      }
      if (job.payload?.brand_id) {
        const { data: brand } = await supabase.from("brands").select("*").eq("id", job.payload.brand_id as string).maybeSingle();
        if (brand) groundedContext += `\n\n[REAL BRAND DATA — DO NOT FABRICATE]\nBrand: ${JSON.stringify(brand)}\n[/REAL BRAND DATA]`;
      }
      const principlesBlock = await getFounderPrinciplesBlock("ai-engine");
      const systemPrompt = `${agent.prompt}${groundedContext}${principlesBlock}\n\nYou will receive a job payload as JSON. Execute the task and respond with ONLY a valid JSON object containing your structured output. No prose, no markdown fences.`;
      const userContent = JSON.stringify({ type: job.type, payload: job.payload });
      // NOTE: any failure here THROWS. runJobs() records retry/failed with the real
      // error. It does NOT invent a result. This is the fix.
      const llmResult = await callLLM(systemPrompt, userContent, "claude-3-haiku-20240307", cid);
      await trackTokenUsage(agent.id, llmResult.model, llmResult.inputTokens, llmResult.outputTokens, llmResult.provider, cid);
      const cleaned = llmResult.text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      validateGrounding(llmResult.text, `${systemPrompt}\n${userContent}`, cid);
      await supabase.from("ai_agents").update({ total_tasks_completed: (agent.total_tasks_completed ?? 0) + 1, last_active_at: new Date().toISOString() }).eq("id", agent.id);
      await supabase.from("agent_activity_log").insert({ agent_id: agent.id, activity_type: "task", title: `Completed: ${job.type}`, description: typeof parsed === "object" ? JSON.stringify(parsed).slice(0, 200) : String(parsed).slice(0, 200), job_id: job.id, metadata: { automated: true, tokens: { input: llmResult.inputTokens, output: llmResult.outputTokens } } });
      structuredLog("INFO", `Job ${job.id} completed via agent`, { agentId: agent.id }, cid);
      return parsed;
    }
  }

  // No agent prompt — generic path. THIS is where 5,970 fabrications came from.
  // There is NO simulation fallback any more. If the LLM cannot run, the job FAILS.
  const principlesBlock = await getFounderPrinciplesBlock("ai-engine");
  const llmResult = await callLLM(
    `You are an AI engine. Job type: ${job.type}. Respond with ONLY a valid JSON object. No prose, no markdown fences. Never invent data.${principlesBlock}`,
    JSON.stringify({ type: job.type, payload: job.payload }),
    "claude-3-haiku-20240307",
    cid,
  );
  await trackTokenUsage(null, llmResult.model, llmResult.inputTokens, llmResult.outputTokens, llmResult.provider, cid);
  const cleaned = llmResult.text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Even an unparseable response is a REAL FAILURE, not a placeholder.
    throw new Error(`Job ${job.id} (${job.type}): LLM returned unparseable JSON. Raw: ${cleaned.slice(0, 200)}`);
  }
}

async function queueJob(type: string, payload: Record<string, unknown>, agentId: string | undefined, cid: string) {
  structuredLog("INFO", "Queuing new job", { type, agentId }, cid);
  const { data, error } = await supabase.from("ai_jobs").insert({ type, payload, agent_id: agentId ?? null, status: "pending" }).select().single();
  if (error) { structuredLog("ERROR", "Failed to queue job", { error: error.message, type }, cid); throw new Error(`Failed to queue job: ${error.message}`); }
  return { job: data };
}

async function callLLM(systemPrompt: string, userContent: string, _preferredModel: string, cid: string): Promise<LLMResult> {
  const result = await routedCallLLM(
    {
      systemPrompt,
      userContent,
      functionName: "ai-engine",
      functionClass: "background_agent",
    },
    buildDefaultRouterConfig(),
  );

  if (result.status !== "success") {
    structuredLog("ERROR", "LLM call failed via router", { status: result.status, log: result.log }, cid);
    throw new Error(
      result.status === "invalid_response_received"
        ? `LLM returned no usable response across all configured providers: ${result.log.failure_reason ?? "unknown"}`
        : `All configured LLM providers failed: ${result.log.failure_reason ?? "unknown"}`,
    );
  }

  if (result.log.attempted_providers.length > 1) {
    structuredLog("INFO", "LLM provider fallback succeeded", {
      successful_provider: result.log.successful_provider,
      attempted_providers: result.log.attempted_providers,
      failure_reason: result.log.failure_reason,
      functionName: "ai-engine",
    }, cid);
  }

  const provider = (result.log.successful_provider ?? "anthropic") as TokenPricingProvider;
  const model = provider === "anthropic" ? "claude-3-haiku-20240307" : "gpt-4o-mini";

  return {
    text: result.content ?? "",
    inputTokens: result.log.token_usage?.input ?? 0,
    outputTokens: result.log.token_usage?.output ?? 0,
    model,
    provider,
  };
}

async function chatWithAgent(agentId: string, message: string, cid: string) {
  structuredLog("INFO", `Chat with agent ${agentId}`, { message: message.slice(0, 50) }, cid);
  await checkRateLimit(agentId, cid);
  const { data: agent, error: agentError } = await supabase.from("ai_agents").select("*").eq("id", agentId).single();
  if (agentError || !agent) { structuredLog("WARN", `Agent not found: ${agentId}`, { error: agentError?.message }, cid); throw new Error(`Agent not found: ${agentId}`); }
  const { data: history } = await supabase.from("agent_conversations").select("message, response").eq("agent_id", agentId).order("created_at", { ascending: true }).limit(10);
  const historyText = (history ?? []).map((h) => `User: ${h.message}\nAgent: ${h.response ?? ""}`).join("\n\n");
  const principlesBlock = await getFounderPrinciplesBlock("ai-engine");
  const systemPrompt = `${agent.prompt}${principlesBlock}\n\nRespond conversationally as this agent would to your human manager at Franchisee Kart. Be concise and concrete. Never invent data — if you do not know, say so.`;
  const userContent = historyText ? `${historyText}\n\nUser: ${message}` : message;
  // A chat failure is reported as a failure. It is NOT answered with a fabrication.
  const llmResult = await callLLM(systemPrompt, userContent, "claude-3-haiku-20240307", cid);
  await trackTokenUsage(agentId, llmResult.model, llmResult.inputTokens, llmResult.outputTokens, llmResult.provider, cid);
  const responseText = llmResult.text;
  validateGrounding(responseText, `${systemPrompt}\n${userContent}`, cid);
  const { data: conversation, error: convError } = await supabase.from("agent_conversations").insert({ agent_id: agentId, message, response: responseText, context: { live: true } }).select().single();
  if (convError) { structuredLog("ERROR", "Failed to save conversation", { error: convError.message, agentId }, cid); throw new Error(`Failed to save conversation: ${convError.message}`); }
  await supabase.from("agent_activity_log").insert({ agent_id: agentId, activity_type: "chat", title: `Responded to: "${message.slice(0, 40)}"`, description: responseText.slice(0, 200), metadata: { live: true, tokens: { input: llmResult.inputTokens, output: llmResult.outputTokens } } });
  return { conversation };
}

async function runJobs(cid: string) {
  structuredLog("INFO", "Running pending jobs", {}, cid);
  const { data: pendingJobs, error: fetchError } = await supabase.from("ai_jobs").select("*").eq("status", "pending").order("created_at", { ascending: true }).limit(10);
  if (fetchError) { structuredLog("ERROR", "Failed to fetch jobs", { error: fetchError.message }, cid); throw new Error(`Failed to fetch jobs: ${fetchError.message}`); }
  const jobs: AIJob[] = pendingJobs ?? [];
  const results: Array<{ job_id: string; status: string; result?: Record<string, unknown>; error?: string }> = [];
  for (const job of jobs) {
    const { error: runningError } = await supabase.from("ai_jobs").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", job.id);
    if (runningError) { results.push({ job_id: job.id, status: "error", error: runningError.message }); continue; }
    try {
      const result = await executeJob(job, cid);
      const { error: completeError } = await supabase.from("ai_jobs").update({ status: "completed", result, updated_at: new Date().toISOString() }).eq("id", job.id);
      if (completeError) throw new Error(completeError.message);
      results.push({ job_id: job.id, status: "completed", result });
    } catch (err) {
      // HONEST FAILURE PATH. The job is marked retry/failed with the REAL error.
      // Nothing is invented to keep the queue looking productive.
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      const newRetryCount = (job.retry_count ?? 0) + 1;
      const newStatus = newRetryCount < 3 ? "retry" : "failed";
      structuredLog("ERROR", `Job ${job.id} failed`, { error: errorMessage, retryCount: newRetryCount, newStatus }, cid);
      await supabase.from("ai_jobs").update({ status: newStatus, retry_count: newRetryCount, updated_at: new Date().toISOString(), result: { error: errorMessage } }).eq("id", job.id);
      results.push({ job_id: job.id, status: newStatus, error: errorMessage });
    }
  }
  return { processed: results.length, results };
}

async function getStatus(cid: string) {
  structuredLog("INFO", "Getting job status counts", {}, cid);
  const statuses = ["pending", "running", "completed", "failed", "retry"];
  const counts: Record<string, number> = {};
  for (const status of statuses) {
    const { count, error } = await supabase.from("ai_jobs").select("*", { count: "exact", head: true }).eq("status", status);
    if (error) throw new Error(`Failed to count ${status}: ${error.message}`);
    counts[status] = count ?? 0;
  }
  return { counts };
}

async function getAISpend(cid: string) {
  structuredLog("INFO", "Calculating AI spend for today", {}, cid);
  const today = new Date().toISOString().slice(0, 10);
  const { data: usageRecords, error } = await supabase.from("agent_memory").select("id, agent_id, content").eq("memory_type", "usage").eq("content->>date", today);
  if (error) throw new Error(`Failed to fetch usage records: ${error.message}`);
  const records = usageRecords ?? [];
  let totalInputTokens = 0; let totalOutputTokens = 0; let totalEstimatedCostUsd = 0;
  const byAgent: Array<Record<string, unknown>> = [];
  for (const record of records) {
    const content = record.content as Record<string, unknown>;
    const inputTokens = (content?.input_tokens as number) ?? 0;
    const outputTokens = (content?.output_tokens as number) ?? 0;
    const provider = (content?.provider as TokenPricingProvider) ?? "anthropic";
    const model = (content?.model as string) ?? "unknown";
    const callCount = (content?.call_count as number) ?? 0;
    const pricing = TOKEN_PRICING[provider] ?? TOKEN_PRICING.anthropic;
    const costUsd = (inputTokens / 1_000_000) * pricing.inputPerMtok + (outputTokens / 1_000_000) * pricing.outputPerMtok;
    totalInputTokens += inputTokens; totalOutputTokens += outputTokens; totalEstimatedCostUsd += costUsd;
    byAgent.push({ agent_id: record.agent_id, model, provider, input_tokens: inputTokens, output_tokens: outputTokens, call_count: callCount, estimated_cost_usd: Math.round(costUsd * 10_000) / 10_000 });
  }
  return { date: today, total_input_tokens: totalInputTokens, total_output_tokens: totalOutputTokens, total_calls: records.length, total_estimated_cost_usd: Math.round(totalEstimatedCostUsd * 10_000) / 10_000, breakdown_by_agent: byAgent, pricing_reference: TOKEN_PRICING };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const cid = req.headers.get("X-Correlation-ID") || generateCorrelationId();
  try {
    const envError = verifyEnvSecrets({ SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey });
    if (envError) return errorResponse(envError, 500, "Configuration error", cid);
    // FAIL CLOSED: without an LLM key this engine can no longer "simulate" — it stops.
    if (!ANTHROPIC_API_KEY && !OPENAI_API_KEY) {
      return errorResponse("No LLM API key configured. ai-engine will NOT fabricate placeholder results — it fails instead. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.", 503, undefined, cid);
    }
    const url = new URL(req.url);
    if (url.pathname === "/ai-engine/run_jobs" && req.method === "POST") {
      const result = await runJobs(cid);
      return successResponse({ action: "run_jobs", ...result }, 200, cid);
    }
    if (req.method !== "POST") return errorResponse("Method not allowed", 405, undefined, cid);
    let body: Record<string, unknown>;
    try {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    } catch { return errorResponse("Invalid JSON in request body", 400, undefined, cid); }
    const { action, type, payload, agent_id, message } = body;
    if (!action || typeof action !== "string") return errorResponse("Missing or invalid 'action' field", 400, undefined, cid);
    switch (action) {
      case "queue_job": {
        const user = await verifyJWT(req.headers.get("Authorization") || "", supabaseUrl, supabaseAnonKey);
        if (!user) return errorResponse("Unauthorized: valid JWT required for queue_job", 401, undefined, cid);
        if (!type || typeof type !== "string") return errorResponse("Missing or invalid 'type' field", 400, undefined, cid);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return errorResponse("Missing or invalid 'payload' field", 400, undefined, cid);
        const result = await queueJob(type as string, payload as Record<string, unknown>, agent_id as string | undefined, cid);
        return successResponse({ action: "queue_job", success: true, ...result }, 200, cid);
      }
      case "run_jobs": {
        const result = await runJobs(cid);
        return successResponse({ action: "run_jobs", success: true, ...result }, 200, cid);
      }
      case "get_status": {
        const user = await verifyJWT(req.headers.get("Authorization") || "", supabaseUrl, supabaseAnonKey);
        if (!user) return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
        const result = await getStatus(cid);
        return successResponse({ action: "get_status", success: true, ...result }, 200, cid);
      }
      case "chat_with_agent": {
        const user = await verifyJWT(req.headers.get("Authorization") || "", supabaseUrl, supabaseAnonKey);
        if (!user) return errorResponse("Unauthorized: valid JWT required for chat", 401, undefined, cid);
        if (!agent_id || typeof agent_id !== "string") return errorResponse("Missing or invalid 'agent_id' field", 400, undefined, cid);
        if (!message || typeof message !== "string") return errorResponse("Missing or invalid 'message' field", 400, undefined, cid);
        if (message.length > 5000) return errorResponse("Message too long: max 5000 characters", 400, undefined, cid);
        const result = await chatWithAgent(agent_id, message, cid);
        return successResponse({ action: "chat_with_agent", success: true, userId: user.userId, ...result }, 200, cid);
      }
      case "get_ai_spend": {
        const user = await verifyJWT(req.headers.get("Authorization") || "", supabaseUrl, supabaseAnonKey);
        if (!user) return errorResponse("Unauthorized: valid JWT required for get_ai_spend", 401, undefined, cid);
        const result = await getAISpend(cid);
        return successResponse({ action: "get_ai_spend", success: true, ...result }, 200, cid);
      }
      default:
        return errorResponse(`Unknown action: ${action}`, 400, undefined, cid);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});
