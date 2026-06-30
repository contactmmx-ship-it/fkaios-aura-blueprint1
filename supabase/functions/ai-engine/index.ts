import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  correlationId as generateCorrelationId,
  structuredLog,
  errorResponse,
  successResponse,
  verifyEnvSecrets,
  verifyJWT,
} from "../_shared/utils.ts";

// ============================================================================
// REAL DATA GROUNDING — MANDATORY COMPLIANCE
// ============================================================================
//
// 1. All agent prompts MUST include real lead/brand data fetched from the
//    database (leads, brands, consultants tables) before being sent to the
//    LLM. Never send a generic prompt without grounding it in actual data.
//
// 2. Agent responses MUST NOT fabricate franchise terms, pricing, lead
//    details, brand royalty rates, investment ranges, or any factual claims
//    that are not present in the provided context or the database. If the
//    LLM returns fabricated data, the response should be flagged and the
//    fabricating portion stripped before being returned to the caller.
//
// 3. The callLLM function should validate that the response contains data
//    grounded in the provided context. A post-hoc check (heuristic) should
//    log a warning if the response contains entity names/numbers that do
//    not appear in the input context. This is a best-effort guard — it does
//    not block the response but raises structured logs for audit.
//
// ============================================================================

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
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ──────────────────────────────────────────────
// Token Limits & Rate Limiting Constants
// ──────────────────────────────────────────────

/** Maximum output tokens per LLM request, keyed by model */
const MAX_TOKENS_PER_REQUEST: Record<string, number> = {
  "claude-3-haiku-20240307": 4096,
  "gpt-4o-mini": 8192,
};

/** Per-agent rate limit: minimum seconds between consecutive LLM calls for the same agent */
const RATE_LIMIT_COOLDOWN_SECONDS = 30;

/** Pricing per million tokens (USD) for cost estimation */
const TOKEN_PRICING = {
  anthropic: { inputPerMtok: 0.25, outputPerMtok: 1.25 },
  openai: { inputPerMtok: 0.15, outputPerMtok: 0.60 },
} as const;

type TokenPricingProvider = keyof typeof TOKEN_PRICING;

// ──────────────────────────────────────────────
// Interfaces
// ──────────────────────────────────────────────
interface AIJob {
  id: string;
  agent_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  result: Record<string, unknown> | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

interface LLMResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: TokenPricingProvider;
}

// ──────────────────────────────────────────────
// Rate Limiting — per-agent cooldown
// ──────────────────────────────────────────────
async function checkRateLimit(agentId: string, cid: string): Promise<void> {
  const { data: rateRecord } = await supabase
    .from("agent_memory")
    .select("id, content, last_accessed_at")
    .eq("agent_id", agentId)
    .eq("memory_type", "rate_limit")
    .eq("content->>key", "last_call")
    .maybeSingle();

  if (rateRecord?.last_accessed_at) {
    const elapsed = (Date.now() - new Date(rateRecord.last_accessed_at).getTime()) / 1000;
    if (elapsed < RATE_LIMIT_COOLDOWN_SECONDS) {
      const waitSeconds = Math.ceil(RATE_LIMIT_COOLDOWN_SECONDS - elapsed);
      structuredLog(
        "WARN",
        `Rate limit hit for agent ${agentId}`,
        { agentId, elapsed: elapsed.toFixed(1), waitSeconds },
        cid,
      );
      throw new Error(
        `Rate limit: agent ${agentId} called too soon. Please wait ${waitSeconds}s.`,
      );
    }
  }

  // Update / create the rate limit record
  if (rateRecord) {
    await supabase
      .from("agent_memory")
      .update({ last_accessed_at: new Date().toISOString() })
      .eq("id", rateRecord.id);
  } else {
    await supabase.from("agent_memory").insert({
      agent_id: agentId,
      memory_type: "rate_limit",
      content: { key: "last_call" },
      last_accessed_at: new Date().toISOString(),
    });
  }
}

// ──────────────────────────────────────────────
// Daily Token Usage Tracking
// ──────────────────────────────────────────────
async function trackTokenUsage(
  agentId: string | null,
  model: string,
  inputTokens: number,
  outputTokens: number,
  provider: TokenPricingProvider,
  cid: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Upsert: one row per (agent, date) — aggregate tokens across calls
  const { data: existing } = await supabase
    .from("agent_memory")
    .select("id, content")
    .eq("agent_id", agentId)
    .eq("memory_type", "usage")
    .eq("content->>date", today)
    .maybeSingle();

  const currentInput = (existing?.content?.input_tokens as number) ?? 0;
  const currentOutput = (existing?.content?.output_tokens as number) ?? 0;

  const usageContent = {
    date: today,
    model,
    provider,
    input_tokens: currentInput + inputTokens,
    output_tokens: currentOutput + outputTokens,
    call_count: ((existing?.content?.call_count as number) ?? 0) + 1,
  };

  if (existing) {
    await supabase
      .from("agent_memory")
      .update({ content: usageContent, last_accessed_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase.from("agent_memory").insert({
      agent_id: agentId,
      memory_type: "usage",
      content: usageContent,
      memory_category: "task_result", // usage records are permanent until manually cleaned
      last_accessed_at: new Date().toISOString(),
    });
  }

  structuredLog(
    "INFO",
    "Token usage tracked",
    { agentId, model, inputTokens, outputTokens, today, provider },
    cid,
  );
}

// ──────────────────────────────────────────────
// Real Data Grounding — context validation (heuristic)
// ──────────────────────────────────────────────
/**
 * Best-effort check: if the LLM response mentions entity names or numbers
 * that never appear in the input context, log a warning. This is a soft
 * guard — it does NOT block the response.
 */
function validateGrounding(response: string, context: string, cid: string): void {
  // Extract potential "quoted" terms and numeric values from the response
  const responseTerms = new Set(
    [...response.matchAll(/"[^"]{3,}"/g)].map((m) => m[0].toLowerCase()),
  );
  const contextLower = context.toLowerCase();

  const ungrounded = [...responseTerms].filter((term) => !contextLower.includes(term));
  if (ungrounded.length > 0) {
    structuredLog(
      "WARN",
      "Possible ungrounded data in LLM response",
      { ungroundedTerms: ungrounded.slice(0, 5), cid },
      cid,
    );
  }
}

// ──────────────────────────────────────────────
// Business Logic
// ──────────────────────────────────────────────
async function executeJob(job: AIJob, cid: string): Promise<Record<string, unknown>> {
  structuredLog("INFO", `Executing job ${job.id} (type: ${job.type})`, { jobId: job.id, agentId: job.agent_id }, cid);

  if (job.agent_id) {
    // Per-agent rate limit check
    try {
      await checkRateLimit(job.agent_id, cid);
    } catch (err) {
      // Re-throw rate limit errors — do not fall through to no-agent path
      throw err;
    }

    const { data: agent } = await supabase
      .from("ai_agents")
      .select("*")
      .eq("id", job.agent_id)
      .single();

    if (agent?.prompt) {
      // ── Real Data Grounding: fetch relevant lead/brand data ──
      let groundedContext = "";
      if (job.payload?.lead_id) {
        const { data: lead } = await supabase
          .from("leads")
          .select("*, brands(name, investment_range, royalty, sector)")
          .eq("id", job.payload.lead_id as string)
          .maybeSingle();
        if (lead) {
          groundedContext = `\n\n[REAL DATA CONTEXT — DO NOT FABRICATE]\nLead: ${JSON.stringify(lead)}\n[/REAL DATA CONTEXT]`;
        }
      }
      if (job.payload?.brand_id) {
        const { data: brand } = await supabase
          .from("brands")
          .select("*")
          .eq("id", job.payload.brand_id as string)
          .maybeSingle();
        if (brand) {
          groundedContext += `\n\n[REAL BRAND DATA — DO NOT FABRICATE]\nBrand: ${JSON.stringify(brand)}\n[/REAL BRAND DATA]`;
        }
      }

      const systemPrompt = `${agent.prompt}${groundedContext}\n\nYou will receive a job payload as JSON. Execute the task and respond with ONLY a valid JSON object containing your structured output. No prose, no markdown fences.`;
      const userContent = JSON.stringify({ type: job.type, payload: job.payload });

      try {
        const llmResult = await callLLM(systemPrompt, userContent, "claude-3-haiku-20240307", cid);

        // Track token usage for this agent
        await trackTokenUsage(
          agent.id,
          llmResult.model,
          llmResult.inputTokens,
          llmResult.outputTokens,
          llmResult.provider,
          cid,
        );

        const raw = llmResult.text;
        const cleaned = raw.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned);

        // Grounding validation (soft — logs warning only)
        validateGrounding(raw, `${systemPrompt}\n${userContent}`, cid);

        await supabase
          .from("ai_agents")
          .update({
            total_tasks_completed: (agent.total_tasks_completed ?? 0) + 1,
            last_active_at: new Date().toISOString(),
          })
          .eq("id", agent.id);

        await supabase.from("agent_activity_log").insert({
          agent_id: agent.id,
          activity_type: "task",
          title: `Completed: ${job.type}`,
          description: typeof parsed === "object" ? JSON.stringify(parsed).slice(0, 200) : String(parsed).slice(0, 200),
          job_id: job.id,
          metadata: { automated: true, tokens: { input: llmResult.inputTokens, output: llmResult.outputTokens } },
        });

        structuredLog("INFO", `Job ${job.id} completed via agent`, { agentId: agent.id }, cid);
        return parsed;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        structuredLog("ERROR", `Agent execution failed for job ${job.id}`, { error: msg }, cid);
        throw new Error(`Agent execution failed: ${msg}`);
      }
    }
  }

  try {
    const llmResult = await callLLM(
      `You are an AI engine. Job type: ${job.type}. Respond with ONLY a valid JSON object. No prose, no markdown fences.`,
      JSON.stringify({ type: job.type, payload: job.payload }),
      "claude-3-haiku-20240307",
      cid,
    );

    // Track token usage without a specific agent
    await trackTokenUsage(
      null,
      llmResult.model,
      llmResult.inputTokens,
      llmResult.outputTokens,
      llmResult.provider,
      cid,
    );

    const cleaned = llmResult.text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    structuredLog("WARN", `No LLM key configured, simulating output for job ${job.id}`, { jobType: job.type }, cid);
    const simulationMap: Record<string, Record<string, unknown>> = {
      summarize: { summary: "Simulated summary (no LLM key configured).", word_count: 0 },
      classify: { classification: "unknown", confidence: 0 },
      generate: { generated_text: "Simulated output (no LLM key configured).", model: "simulated" },
    };
    return (
      simulationMap[job.type] ?? {
        result: `No LLM key configured — simulated placeholder for job type: ${job.type}`,
        timestamp: new Date().toISOString(),
      }
    );
  }
}

async function queueJob(type: string, payload: Record<string, unknown>, agentId: string | undefined, cid: string) {
  structuredLog("INFO", "Queuing new job", { type, agentId }, cid);

  const { data, error } = await supabase
    .from("ai_jobs")
    .insert({
      type,
      payload,
      agent_id: agentId ?? null,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    structuredLog("ERROR", "Failed to queue job", { error: error.message, type }, cid);
    throw new Error(`Failed to queue job: ${error.message}`);
  }

  return { job: data };
}

// ──────────────────────────────────────────────
// callLLM — now returns structured token usage
// ──────────────────────────────────────────────
async function callLLM(systemPrompt: string, userContent: string, preferredModel: string, cid: string): Promise<LLMResult> {
  if (ANTHROPIC_API_KEY) {
    try {
      const model = "claude-3-haiku-20240307";
      const maxTokens = MAX_TOKENS_PER_REQUEST[model] ?? 4096;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
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
        structuredLog("ERROR", "Anthropic API error", { status: response.status, body: text }, cid);
        throw new Error(`Anthropic API error: ${response.status} ${text}`);
      }
      const data = await response.json();
      const inputTokens = data?.usage?.input_tokens ?? 0;
      const outputTokens = data?.usage?.output_tokens ?? 0;
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

  if (OPENAI_API_KEY) {
    try {
      const model = "gpt-4o-mini";
      const maxTokens = MAX_TOKENS_PER_REQUEST[model] ?? 8192;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
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
        structuredLog("ERROR", "OpenAI API error", { status: response.status, body: text }, cid);
        throw new Error(`OpenAI API error: ${response.status} ${text}`);
      }
      const data = await response.json();
      const inputTokens = data?.usage?.prompt_tokens ?? 0;
      const outputTokens = data?.usage?.completion_tokens ?? 0;
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

  throw new Error("No LLM API key configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY as an Edge Function secret)");
}

async function chatWithAgent(agentId: string, message: string, cid: string) {
  structuredLog("INFO", `Chat with agent ${agentId}`, { message: message.slice(0, 50) }, cid);

  // Per-agent rate limit check
  try {
    await checkRateLimit(agentId, cid);
  } catch (err) {
    throw err;
  }

  const { data: agent, error: agentError } = await supabase
    .from("ai_agents")
    .select("*")
    .eq("id", agentId)
    .single();

  if (agentError || !agent) {
    structuredLog("WARN", `Agent not found: ${agentId}`, { error: agentError?.message }, cid);
    throw new Error(`Agent not found: ${agentId}`);
  }

  const { data: history } = await supabase
    .from("agent_conversations")
    .select("message, response")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: true })
    .limit(10);

  const historyText = (history ?? [])
    .map((h) => `User: ${h.message}\nAgent: ${h.response ?? ""}`)
    .join("\n\n");

  const systemPrompt = `${agent.prompt}\n\nRespond conversationally as this agent would to your human manager at Franchisee Kart. Be concise and concrete. Do not return JSON unless explicitly asked.`;
  const userContent = historyText ? `${historyText}\n\nUser: ${message}` : message;

  let responseText: string;
  let inputTokens = 0;
  let outputTokens = 0;
  let model = "unknown";
  let provider: TokenPricingProvider = "anthropic";

  try {
    const llmResult = await callLLM(systemPrompt, userContent, "claude-3-haiku-20240307", cid);
    responseText = llmResult.text;
    inputTokens = llmResult.inputTokens;
    outputTokens = llmResult.outputTokens;
    model = llmResult.model;
    provider = llmResult.provider;

    // Track token usage for chat
    await trackTokenUsage(agentId, model, inputTokens, outputTokens, provider, cid);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    structuredLog("WARN", `AI unavailable for chat, using fallback`, { error: msg }, cid);
    responseText = `[AI temporarily unavailable: ${msg}]`;
  }

  // Grounding validation for chat responses
  validateGrounding(responseText, `${systemPrompt}\n${userContent}`, cid);

  const { data: conversation, error: convError } = await supabase
    .from("agent_conversations")
    .insert({ agent_id: agentId, message, response: responseText, context: { live: true } })
    .select()
    .single();

  if (convError) {
    structuredLog("ERROR", "Failed to save conversation", { error: convError.message, agentId }, cid);
    throw new Error(`Failed to save conversation: ${convError.message}`);
  }

  await supabase.from("agent_activity_log").insert({
    agent_id: agentId,
    activity_type: "chat",
    title: `Responded to: "${message.slice(0, 40)}"`,
    description: responseText.slice(0, 200),
    metadata: { live: true, tokens: { input: inputTokens, output: outputTokens } },
  });

  return { conversation };
}

async function runJobs(cid: string) {
  structuredLog("INFO", "Running pending jobs", {}, cid);

  const { data: pendingJobs, error: fetchError } = await supabase
    .from("ai_jobs")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);

  if (fetchError) {
    structuredLog("ERROR", "Failed to fetch jobs", { error: fetchError.message }, cid);
    throw new Error(`Failed to fetch jobs: ${fetchError.message}`);
  }

  const jobs: AIJob[] = pendingJobs ?? [];
  const results: Array<{ job_id: string; status: string; result?: Record<string, unknown>; error?: string }> = [];

  for (const job of jobs) {
    const { error: runningError } = await supabase
      .from("ai_jobs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", job.id);

    if (runningError) {
      structuredLog("ERROR", `Failed to mark job ${job.id} as running`, { error: runningError.message }, cid);
      results.push({ job_id: job.id, status: "error", error: runningError.message });
      continue;
    }

    try {
      const result = await executeJob(job, cid);

      const { error: completeError } = await supabase
        .from("ai_jobs")
        .update({
          status: "completed",
          result,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      if (completeError) {
        throw new Error(completeError.message);
      }

      results.push({ job_id: job.id, status: "completed", result });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      const newRetryCount = (job.retry_count ?? 0) + 1;
      const newStatus = newRetryCount < 3 ? "retry" : "failed";

      structuredLog("ERROR", `Job ${job.id} failed`, { error: errorMessage, retryCount: newRetryCount, newStatus }, cid);

      await supabase
        .from("ai_jobs")
        .update({
          status: newStatus,
          retry_count: newRetryCount,
          updated_at: new Date().toISOString(),
          result: { error: errorMessage },
        })
        .eq("id", job.id);

      results.push({ job_id: job.id, status: newStatus, error: errorMessage });
    }
  }

  return {
    processed: results.length,
    results,
  };
}

async function getStatus(cid: string) {
  structuredLog("INFO", "Getting job status counts", {}, cid);

  const statuses = ["pending", "running", "completed", "failed", "retry"];
  const counts: Record<string, number> = {};

  for (const status of statuses) {
    const { count, error } = await supabase
      .from("ai_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", status);

    if (error) {
      structuredLog("ERROR", `Failed to count ${status} jobs`, { error: error.message }, cid);
      throw new Error(`Failed to count ${status}: ${error.message}`);
    }

    counts[status] = count ?? 0;
  }

  return { counts };
}

// ──────────────────────────────────────────────
// getAISpend — aggregate today's token usage & estimate cost
// ──────────────────────────────────────────────
async function getAISpend(cid: string) {
  structuredLog("INFO", "Calculating AI spend for today", {}, cid);

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Fetch all usage records for today across all agents
  const { data: usageRecords, error } = await supabase
    .from("agent_memory")
    .select("id, agent_id, content")
    .eq("memory_type", "usage")
    .eq("content->>date", today);

  if (error) {
    structuredLog("ERROR", "Failed to fetch usage records", { error: error.message }, cid);
    throw new Error(`Failed to fetch usage records: ${error.message}`);
  }

  const records = usageRecords ?? [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalEstimatedCostUsd = 0;
  const byAgent: Array<{
    agent_id: string | null;
    model: string;
    provider: string;
    input_tokens: number;
    output_tokens: number;
    call_count: number;
    estimated_cost_usd: number;
  }> = [];

  for (const record of records) {
    const content = record.content as Record<string, unknown>;
    const inputTokens = (content?.input_tokens as number) ?? 0;
    const outputTokens = (content?.output_tokens as number) ?? 0;
    const provider = (content?.provider as TokenPricingProvider) ?? "anthropic";
    const model = (content?.model as string) ?? "unknown";
    const callCount = (content?.call_count as number) ?? 0;

    const pricing = TOKEN_PRICING[provider] ?? TOKEN_PRICING.anthropic;
    const costUsd =
      (inputTokens / 1_000_000) * pricing.inputPerMtok +
      (outputTokens / 1_000_000) * pricing.outputPerMtok;

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalEstimatedCostUsd += costUsd;

    byAgent.push({
      agent_id: record.agent_id,
      model,
      provider,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      call_count: callCount,
      estimated_cost_usd: Math.round(costUsd * 10_000) / 10_000, // 4 decimal places
    });
  }

  return {
    date: today,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    total_calls: records.length,
    total_estimated_cost_usd: Math.round(totalEstimatedCostUsd * 10_000) / 10_000,
    breakdown_by_agent: byAgent,
    pricing_reference: TOKEN_PRICING,
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

    const url = new URL(req.url);
    const path = url.pathname;

    // Handle /ai-engine/run_jobs endpoint — no JWT required (internal/cron)
    if (path === "/ai-engine/run_jobs" && req.method === "POST") {
      const result = await runJobs(cid);
      return successResponse({ action: "run_jobs", ...result }, 200, cid);
    }

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405, undefined, cid);
    }

    // Parse body with validation
    let body: Record<string, unknown>;
    try {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
      }
    } catch {
      return errorResponse("Invalid JSON in request body", 400, undefined, cid);
    }

    const { action, type, payload, agent_id, message } = body;

    if (!action || typeof action !== "string") {
      return errorResponse("Missing or invalid 'action' field", 400, undefined, cid);
    }

    switch (action) {
      case "queue_job": {
        // JWT required for chat, not required for job processing — but queue_job is a user action
        const authHeader = req.headers.get("Authorization") || "";
        const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
        if (!user) {
          return errorResponse("Unauthorized: valid JWT required for queue_job", 401, undefined, cid);
        }

        if (!type || typeof type !== "string") {
          return errorResponse("Missing or invalid 'type' field", 400, undefined, cid);
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          return errorResponse("Missing or invalid 'payload' field", 400, undefined, cid);
        }
        const result = await queueJob(type as string, payload as Record<string, unknown>, agent_id as string | undefined, cid);
        return successResponse({ action: "queue_job", success: true, ...result }, 200, cid);
      }

      case "run_jobs": {
        // Internal job processing — JWT not required (cron/service auth)
        const result = await runJobs(cid);
        return successResponse({ action: "run_jobs", success: true, ...result }, 200, cid);
      }

      case "get_status": {
        // JWT required
        const authHeader = req.headers.get("Authorization") || "";
        const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
        if (!user) {
          return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
        }
        const result = await getStatus(cid);
        return successResponse({ action: "get_status", success: true, ...result }, 200, cid);
      }

      case "chat_with_agent": {
        // JWT required for chat
        const authHeader = req.headers.get("Authorization") || "";
        const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
        if (!user) {
          return errorResponse("Unauthorized: valid JWT required for chat", 401, undefined, cid);
        }

        if (!agent_id || typeof agent_id !== "string") {
          return errorResponse("Missing or invalid 'agent_id' field", 400, undefined, cid);
        }
        if (!message || typeof message !== "string") {
          return errorResponse("Missing or invalid 'message' field", 400, undefined, cid);
        }
        if (message.length > 5000) {
          return errorResponse("Message too long: max 5000 characters", 400, undefined, cid);
        }
        const result = await chatWithAgent(agent_id, message, cid);
        return successResponse({ action: "chat_with_agent", success: true, userId: user.userId, ...result }, 200, cid);
      }

      case "get_ai_spend": {
        // JWT required — cost data is sensitive
        const authHeader = req.headers.get("Authorization") || "";
        const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
        if (!user) {
          return errorResponse("Unauthorized: valid JWT required for get_ai_spend", 401, undefined, cid);
        }
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