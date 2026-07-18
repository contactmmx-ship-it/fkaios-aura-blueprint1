// ============================================================================
// FOUNDER BRAIN — Canonical Intelligence Service
// ============================================================================
// SPRINT 1 (M1-S1) — created per frozen rule: "Never create another Brain."
//
// This module is the ONE place reasoning, context-building, and LLM calling
// live. Every intelligence surface (brain-engine, my-brain-engine,
// staff-engine, orchestrator-engine, decision-engine, agent-engine,
// learning-engine, vault-engine, maps-engine, workday-engine,
// governance-dashboard, founder-executive) is expected to import from here
// instead of re-implementing its own callLLM/context-fetch logic.
//
// PROVENANCE (Honesty Protocol — nothing here is invented):
//   - reason()        ports founder-executive/index.ts callLLM() (Anthropic
//                      primary, OpenAI fallback) merged with
//                      brain-engine/index.ts llmFetch() (Gemini fallback),
//                      so this is a 3-provider superset of both, not a new
//                      integration.
//   - buildContext()  ports founder-executive/index.ts fetchRevenueData /
//                      fetchLeadPipeline / fetchMeetings / fetchMilestones /
//                      fetchPayments / fetchFounderMemory / fetchKnowledgeBase
//                      verbatim (same tables, same columns, same fallback
//                      shape), generalized to take a client instead of a
//                      module-level singleton.
//   - FounderMemory / FounderAgent are INTERFACE-ONLY per Sprint 1 Steps 5–6
//     ("do NOT build memory yet" / "do NOT build agents yet"). Every method
//     throws NotImplementedError until the Memory Engine / Agent Runtime
//     sprints land. Nothing here fabricates a working memory or agent layer.
//   - createWorkObject() is a STUB, not a fake success. supabase/migrations/
//     in this ZIP has ZERO references to a `work_objects` table (checked at
//     inventory time) — so this function detects that at call time and
//     returns a clear "not_available" result rather than pretending to save.
//
// WHAT THIS SPRINT DOES NOT DO:
//   - Does not modify brain-engine, my-brain-engine, staff-engine,
//     orchestrator-engine, decision-engine, or any other LIVE, frontend-
//     wired edge function. Those are daily-used surfaces; rewiring them
//     without the ability to runtime-verify Deno behavior in this sandbox
//     would violate "never break existing functionality" + "verify every
//     change." They are adapter candidates for the NEXT approved step.
//   - Does not build the Memory Engine or Agent Runtime (Sprints 2+).
// ============================================================================

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

// ──────────────────────────────────────────────
// Client
// ──────────────────────────────────────────────
export function getFounderBrainClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key);
}

function cid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function log(level: string, message: string, data?: Record<string, unknown>, id?: string): void {
  console.log(JSON.stringify({ level, message, cid: id, ...data, ts: new Date().toISOString(), source: "founder-brain" }));
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
export interface DataSourceResult {
  source: string;
  status: "success" | "no_data" | "error" | "unconfigured";
  data: unknown;
  error?: string;
}

export interface LLMResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: "anthropic" | "gemini" | "openai";
}

export interface FounderContext {
  revenue: DataSourceResult;
  leads: DataSourceResult;
  meetings: DataSourceResult;
  milestones: DataSourceResult;
  payments: DataSourceResult;
  memory: DataSourceResult;
  knowledge: DataSourceResult;
}

// ──────────────────────────────────────────────
// reason() — the ONE LLM call path.
// Anthropic (claude-sonnet-4-6) -> Gemini (2.5-flash) -> OpenAI (gpt-4o-mini)
// ──────────────────────────────────────────────
async function reasonCore(
  systemPrompt: string,
  userContent: string,
  maxTokens = 1500,
  correlationId: string = cid(),
): Promise<LLMResult> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";

  if (anthropicKey) {
    try {
      const model = "claude-sonnet-4-6";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: "user", content: userContent }] }),
      });
      if (res.ok) {
        const data = await res.json();
        return {
          text: data?.content?.[0]?.text ?? "",
          inputTokens: data?.usage?.input_tokens ?? 0,
          outputTokens: data?.usage?.output_tokens ?? 0,
          model,
          provider: "anthropic",
        };
      }
      log("ERROR", "Anthropic call failed, trying Gemini", { status: res.status }, correlationId);
    } catch (err) {
      log("ERROR", "Anthropic fetch threw, trying Gemini", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

  if (geminiKey) {
    try {
      const contents = [{ role: "user", parts: [{ text: userContent }] }];
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": geminiKey, "content-type": "application/json" },
          body: JSON.stringify({
            ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
            contents,
            generationConfig: { maxOutputTokens: maxTokens + 256 },
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
        return { text, inputTokens: 0, outputTokens: 0, model: "gemini-2.5-flash", provider: "gemini" };
      }
      log("ERROR", "Gemini call failed, trying OpenAI", { status: res.status }, correlationId);
    } catch (err) {
      log("ERROR", "Gemini fetch threw, trying OpenAI", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

  if (openaiKey) {
    try {
      const model = "gpt-4o-mini";
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return {
          text: data?.choices?.[0]?.message?.content ?? "",
          inputTokens: data?.usage?.prompt_tokens ?? 0,
          outputTokens: data?.usage?.completion_tokens ?? 0,
          model,
          provider: "openai",
        };
      }
      log("ERROR", "OpenAI call failed — all providers exhausted", { status: res.status }, correlationId);
    } catch (err) {
      log("ERROR", "OpenAI fetch threw — all providers exhausted", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

  throw new Error("Founder Brain: no LLM provider succeeded (checked Anthropic, Gemini, OpenAI). Verify ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY secrets.");
}

// ──────────────────────────────────────────────
// reason() — public entry point. Evolution (not addition): wraps
// reasonCore() (the unchanged 3-provider fallback logic above) with
// self-recording into agent_performance_metrics — the SAME table
// auto-agents-engine and others already write to (confirmed real schema:
// agent_id/task_type/input_tokens/output_tokens/success/model/provider/
// error_message). This closes the exact gap getTokenEconomyReport()
// (executive-planner.ts) stated in its own caveat field: the Founder
// Brain's own token spend was previously invisible to that report because
// nothing here wrote to the table it reads from. Now it does.
// Recording is best-effort and NEVER blocks or fails the actual reasoning
// call — a metrics-write failure is caught and logged, never re-thrown,
// matching the pattern already established in every other engine that
// writes to this table (auto-agents-engine's own comment: "a failed LLM
// call still burns money, and hiding that would understate spend").
// estimated_cost_usd is deliberately left null, not computed — no
// per-model pricing table exists anywhere in this codebase, and guessing
// a cost figure would violate the Token Economy's own "never fabricate
// numbers" rule. getTokenEconomyReport() already treats a null/missing
// cost honestly (sums whatever IS present, doesn't invent the rest).
// ──────────────────────────────────────────────
export async function reason(
  systemPrompt: string,
  userContent: string,
  maxTokens = 1500,
  correlationId: string = cid(),
): Promise<LLMResult> {
  const startedAt = Date.now();
  try {
    const result = await reasonCore(systemPrompt, userContent, maxTokens, correlationId);
    try {
      const client = getFounderBrainClient();
      await client.from("agent_performance_metrics").insert({
        agent_id: "founder-brain",
        task_type: "founder_brain_reasoning",
        latency_ms: Date.now() - startedAt,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        success: true,
        model: result.model,
        provider: result.provider,
        prompt_version: "reason-v1",
        retries: 0,
      });
    } catch (metricsErr) {
      log("ERROR", "reason(): self-recording to agent_performance_metrics failed (non-blocking)", { error: metricsErr instanceof Error ? metricsErr.message : String(metricsErr) }, correlationId);
    }
    return result;
  } catch (err) {
    try {
      const client = getFounderBrainClient();
      await client.from("agent_performance_metrics").insert({
        agent_id: "founder-brain",
        task_type: "founder_brain_reasoning",
        latency_ms: Date.now() - startedAt,
        success: false,
        error_message: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        prompt_version: "reason-v1",
        retries: 0,
      });
    } catch { /* recording failure never masks the real error below */ }
    throw err;
  }
}

// ──────────────────────────────────────────────
// buildContext() — real-data grounding across subsystems.
// Ported 1:1 from founder-executive's fetch* helpers (same tables/columns).
// ──────────────────────────────────────────────
async function fetchRevenueData(client: SupabaseClient, brandId: string | null, id: string): Promise<DataSourceResult> {
  try {
    let q = client.from("revenue_snapshots").select("*, brands(name)").order("period_start", { ascending: false }).limit(6);
    if (brandId) q = q.eq("brand_id", brandId);
    const { data } = await q;
    if (!data || data.length === 0) return { source: "revenue_snapshots", status: "no_data", data: null, error: "No revenue snapshots found" };
    return { source: "revenue_snapshots", status: "success", data };
  } catch (err) {
    return { source: "revenue_snapshots", status: "error", data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchLeadPipeline(client: SupabaseClient, brandId: string | null, id: string): Promise<DataSourceResult> {
  try {
    let q = client
      .from("leads")
      .select("id, name, stage, brand_id, assigned_to, created_at, investment_capacity, brands(name)")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(20);
    if (brandId) q = q.eq("brand_id", brandId);
    const { data: leads } = await q;
    if (!leads || leads.length === 0) return { source: "lead_pipeline", status: "no_data", data: null, error: "No active leads found" };
    const leadIds = leads.map((l: { id: string }) => l.id);
    const { data: lifecycles } = await client.from("lead_lifecycle").select("*, agent_lifecycle_stages(name)").in("lead_id", leadIds);
    const summary = {
      total: leads.length,
      byStage: leads.reduce((acc: Record<string, number>, l: { stage: string }) => {
        acc[l.stage] = (acc[l.stage] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };
    return { source: "lead_pipeline", status: "success", data: { leads, lifecycles: lifecycles ?? [], summary } };
  } catch (err) {
    return { source: "lead_pipeline", status: "error", data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchMeetings(client: SupabaseClient, consultantId: string | null, id: string): Promise<DataSourceResult> {
  try {
    const today = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    let q = client.from("meetings").select("*, leads(name, brands(name)), consultants(name)").gte("scheduled_at", today).lte("scheduled_at", tomorrow).order("scheduled_at", { ascending: true });
    if (consultantId) q = q.eq("consultant_id", consultantId);
    const { data } = await q;
    if (!data || data.length === 0) return { source: "meetings", status: "no_data", data: null, error: "No meetings today or tomorrow" };
    return { source: "meetings", status: "success", data };
  } catch (err) {
    return { source: "meetings", status: "error", data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchMilestones(client: SupabaseClient, brandId: string | null, id: string): Promise<DataSourceResult> {
  try {
    let q = client.from("strategic_milestones").select("*, brands(name)").neq("status", "cancelled").order("target_date", { ascending: true });
    if (brandId) q = q.eq("brand_id", brandId);
    const { data } = await q;
    if (!data || data.length === 0) return { source: "strategic_milestones", status: "no_data", data: null, error: "No active milestones found" };
    return { source: "strategic_milestones", status: "success", data };
  } catch (err) {
    return { source: "strategic_milestones", status: "error", data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchPayments(client: SupabaseClient, brandId: string | null, id: string): Promise<DataSourceResult> {
  try {
    let q = client.from("payments").select("*, invoices(id, amount, status), leads(name, brands(name))").order("created_at", { ascending: false }).limit(15);
    if (brandId) q = q.eq("brand_id", brandId);
    const { data } = await q;
    if (!data || data.length === 0) return { source: "payments", status: "no_data", data: null, error: "No recent payments found" };
    return { source: "payments", status: "success", data };
  } catch (err) {
    return { source: "payments", status: "error", data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchFounderMemory(client: SupabaseClient, userId: string, id: string): Promise<DataSourceResult> {
  try {
    const { data } = await client.from("founder_memory").select("*").eq("created_by", userId).order("updated_at", { ascending: false }).limit(20);
    if (!data || data.length === 0) return { source: "founder_memory", status: "no_data", data: null, error: "No stored memory entries" };
    return { source: "founder_memory", status: "success", data };
  } catch (err) {
    return { source: "founder_memory", status: "error", data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchKnowledgeBase(client: SupabaseClient, brandId: string | null, id: string): Promise<DataSourceResult> {
  try {
    const { data: brands } = await client.from("brands").select("id").limit(5);
    const brandIds = brandId ? [brandId] : (brands ?? []).map((b: { id: string }) => b.id);
    const results: Array<Record<string, unknown>> = [];
    for (const bid of brandIds.slice(0, 3)) {
      const { data: chunks } = await client.from("knowledge_chunks").select("content, chunk_index, document_id, documents(title), knowledge_sources(name)").eq("brand_id", bid).limit(3);
      if (chunks) results.push(...chunks);
    }
    if (results.length === 0) return { source: "knowledge_base", status: "no_data", data: null, error: "No matching knowledge entries found" };
    return { source: "knowledge_base", status: "success", data: results };
  } catch (err) {
    return { source: "knowledge_base", status: "error", data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// Drop-in wrappers matching founder-executive/index.ts's original local
// function signatures exactly (brandId/consultantId/userId first, no client
// param — this module owns client creation). Lets founder-executive delegate
// to this single implementation without touching any of its call sites.
export const fetchRevenueDataFor = (brandId: string | null, id: string) => fetchRevenueData(getFounderBrainClient(), brandId, id);
export const fetchLeadPipelineFor = (brandId: string | null, id: string) => fetchLeadPipeline(getFounderBrainClient(), brandId, id);
export const fetchMeetingsFor = (consultantId: string | null, id: string) => fetchMeetings(getFounderBrainClient(), consultantId, id);
export const fetchMilestonesFor = (brandId: string | null, id: string) => fetchMilestones(getFounderBrainClient(), brandId, id);
export const fetchPaymentsFor = (brandId: string | null, id: string) => fetchPayments(getFounderBrainClient(), brandId, id);
export const fetchFounderMemoryFor = (userId: string, id: string) => fetchFounderMemory(getFounderBrainClient(), userId, id);
export const fetchKnowledgeBaseFor = (_question: string, brandId: string | null, id: string) => fetchKnowledgeBase(getFounderBrainClient(), brandId, id);
export const callLLMFor = (systemPrompt: string, userContent: string, maxTokens: number, id: string) => reason(systemPrompt, userContent, maxTokens, id);

export async function buildContext(
  opts: { userId: string; brandId?: string | null; consultantId?: string | null },
  correlationId: string = cid(),
): Promise<FounderContext> {
  const client = getFounderBrainClient();
  const brandId = opts.brandId ?? null;
  const [revenue, leads, meetings, milestones, payments, memory, knowledge] = await Promise.all([
    fetchRevenueData(client, brandId, correlationId),
    fetchLeadPipeline(client, brandId, correlationId),
    fetchMeetings(client, opts.consultantId ?? null, correlationId),
    fetchMilestones(client, brandId, correlationId),
    fetchPayments(client, brandId, correlationId),
    fetchFounderMemory(client, opts.userId, correlationId),
    fetchKnowledgeBase(client, brandId, correlationId),
  ]);
  return { revenue, leads, meetings, milestones, payments, memory, knowledge };
}

// ──────────────────────────────────────────────
// planExecution() — minimal execution-planning shape.
// Sprint 1 scope: structures a plan from an LLM reasoning pass; does not
// execute anything (no agent runtime exists yet — Sprint 6/7).
// ──────────────────────────────────────────────
export interface ExecutionStep {
  step: number;
  description: string;
  requiresAgent: boolean;
}

export async function planExecution(goal: string, context: FounderContext, correlationId: string = cid()): Promise<ExecutionStep[]> {
  const grounding = JSON.stringify(context).slice(0, 6000);
  const result = await reason(
    "You are the Founder Brain execution planner. Given a goal and grounded business context, output a short numbered plan as JSON array of {step, description, requiresAgent}. Only use facts present in the context. If data is missing, say so in the step instead of inventing it.",
    `GOAL: ${goal}\n\nCONTEXT:\n${grounding}`,
    800,
    correlationId,
  );
  try {
    const parsed = JSON.parse(result.text);
    if (Array.isArray(parsed)) return parsed as ExecutionStep[];
  } catch {
    // Model didn't return clean JSON — fall through to single-step fallback.
  }
  return [{ step: 1, description: result.text, requiresAgent: false }];
}

// ──────────────────────────────────────────────
// route() — minimal type-based dispatch. Extend as adapters are approved
// and wired; this is intentionally thin for Sprint 1.
// ──────────────────────────────────────────────
export type FounderBrainRequestType = "ask" | "plan" | "decide" | "learn" | "delegate";

export interface FounderBrainRequest {
  type: FounderBrainRequestType;
  userId: string;
  content: string;
  brandId?: string | null;
}

export async function route(req: FounderBrainRequest, correlationId: string = cid()): Promise<{ text: string; context: FounderContext }> {
  const context = await buildContext({ userId: req.userId, brandId: req.brandId }, correlationId);
  const grounding = JSON.stringify(context).slice(0, 8000);
  const result = await reason(
    "You are the Founder Brain — the single reasoning layer for FKAIOS. Answer using ONLY the grounded context provided. If a data source has no_data or error status, say so explicitly rather than guessing.",
    `${req.content}\n\nGROUNDED CONTEXT:\n${grounding}`,
    1500,
    correlationId,
  );
  // SPRINT 2: episodic memory hook — best-effort, never blocks the response.
  try {
    await founderMemory.episodic.append({
      function_name: "founder-brain", department_code: "EXECUTIVE", action: `route:${req.type}`,
      status: "success", input_summary: req.content.slice(0, 300), output_summary: result.text.slice(0, 300),
    });
  } catch { /* logged inside episodic.append; never break the caller's response */ }
  return { text: result.text, context };
}

// ──────────────────────────────────────────────
// createWorkObject() — STUB. `work_objects` table does not exist in this
// codebase (verified against supabase/migrations/ at inventory time).
// Returns an explicit not_available result. Does NOT fabricate a save.
// ──────────────────────────────────────────────
export async function createWorkObject(_input: { content: string; type?: string; title?: string }): Promise<DataSourceResult> {
  return { source: "work_objects", status: "unconfigured", data: null, error: "work_objects table not present in this codebase — Work Engine sprint not yet started" };
}

// ──────────────────────────────────────────────
// FounderMemory — INTERFACE ONLY (Step 5). No implementation.
// Nothing outside this file may reach permanent/working/episodic memory,
// knowledge, work objects, or the learning engine directly — everything
// routes through FounderBrain, which will implement this interface when
// the Memory Engine sprint (Sprint 2) begins.
// ──────────────────────────────────────────────
export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`Founder Brain: ${method} is not implemented yet — scoped for a later sprint (Memory Engine / Agent Runtime).`);
    this.name = "NotImplementedError";
  }
}

export interface FounderMemory {
  permanent: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  working: {
    get(sessionId: string): Promise<unknown>;
    set(sessionId: string, value: unknown): Promise<void>;
  };
  episodic: {
    append(event: Record<string, unknown>): Promise<void>;
    query(filter: Record<string, unknown>): Promise<unknown[]>;
  };
  knowledge: {
    search(query: string): Promise<unknown[]>;
  };
  workObjects: {
    create(input: Record<string, unknown>): Promise<unknown>;
    link(a: string, b: string, relation: string): Promise<void>;
  };
  learning: {
    recordOutcome(event: Record<string, unknown>): Promise<void>;
  };
}

// ──────────────────────────────────────────────
// FounderMemory — SPRINT 2 (M1-S2): REAL implementation.
// Every method below is backed by a table that ALREADY EXISTS and is
// ALREADY WRITTEN TO elsewhere in this codebase — confirmed by direct grep
// before writing a single line here, per the Constitution's "never create
// duplicate memories" / "reuse existing code":
//   - working   -> brain_messages / brain_conversations (brain-chat's own
//                  conversation history tables — proven insert/select shape)
//   - episodic  -> execution_log (used by 11 other engines already:
//                  governance-dashboard, orchestrator-engine, brain-chat,
//                  vault-engine, workday-engine, lead-capture, etc.)
//   - knowledge -> knowledge_chunks (same table buildContext() already reads)
//   - learning  -> metrics table via recordMetric() from _shared/metrics.ts
//                  (already a generic, proven telemetry sink — not a new
//                  "learning" table)
//   - permanent -> founder_memory (already read by buildContext(); grep
//                  confirmed ZERO existing writers anywhere in the codebase
//                  — .set() below is the first, so schema beyond
//                  created_by/updated_at is inferred, not proven; every
//                  write is try/catch'd and reports failure honestly rather
//                  than claiming success on a schema mismatch)
//   - workObjects -> STILL STUBBED. `work_objects` table does not exist in
//                  this ZIP (Sprint 1 finding, unchanged) — that's the Work
//                  Engine sprint's job, not Memory Engine's. Building it here
//                  would be exactly the "duplicate implementation created
//                  early" the Constitution forbids.
// ──────────────────────────────────────────────
import { recordMetric } from "../_shared/metrics.ts";

export const founderMemory: FounderMemory = {
  permanent: {
    get: async (userId: string) => {
      const client = getFounderBrainClient();
      const { data, error } = await client.from("founder_memory").select("*").eq("created_by", userId).order("updated_at", { ascending: false }).limit(20);
      if (error) { log("ERROR", "permanent.get failed", { error: error.message }); return null; }
      return data;
    },
    set: async (userId: string, value: unknown) => {
      const client = getFounderBrainClient();
      const { error } = await client.from("founder_memory").insert({ created_by: userId, content: value, updated_at: new Date().toISOString() });
      if (error) { log("ERROR", "permanent.set failed — schema may differ from inferred shape", { error: error.message }); throw error; }
    },
  },
  working: {
    get: async (sessionId: string) => {
      const client = getFounderBrainClient();
      const { data, error } = await client.from("brain_messages").select("content, role, created_at").eq("conversation_id", sessionId).order("created_at", { ascending: false }).limit(10);
      if (error) { log("ERROR", "working.get failed", { error: error.message }); return null; }
      return (data ?? []).reverse();
    },
    set: async (sessionId: string, value: unknown) => {
      const client = getFounderBrainClient();
      const v = value as { role?: string; content?: string };
      const { error } = await client.from("brain_messages").insert({ conversation_id: sessionId, role: v.role ?? "assistant", content: v.content ?? String(value) });
      if (error) { log("ERROR", "working.set failed", { error: error.message }); throw error; }
    },
  },
  episodic: {
    append: async (event: Record<string, unknown>) => {
      const client = getFounderBrainClient();
      const { error } = await client.from("execution_log").insert({
        function_name: (event.function_name as string) ?? "founder-brain",
        department_code: (event.department_code as string) ?? "EXECUTIVE",
        action: (event.action as string) ?? "event",
        status: (event.status as string) ?? "success",
        input_summary: event.input_summary ? String(event.input_summary).slice(0, 500) : null,
        output_summary: event.output_summary ? String(event.output_summary).slice(0, 500) : null,
        error: event.error ? String(event.error).slice(0, 500) : null,
      });
      if (error) { log("ERROR", "episodic.append failed", { error: error.message }); throw error; }
    },
    query: async (filter: Record<string, unknown>) => {
      const client = getFounderBrainClient();
      let q = client.from("execution_log").select("*").order("created_at", { ascending: false }).limit(50);
      if (filter.function_name) q = q.eq("function_name", filter.function_name as string);
      if (filter.action) q = q.eq("action", filter.action as string);
      if (filter.status) q = q.eq("status", filter.status as string);
      const { data, error } = await q;
      if (error) { log("ERROR", "episodic.query failed", { error: error.message }); return []; }
      return data ?? [];
    },
  },
  knowledge: {
    search: async (query: string) => {
      const client = getFounderBrainClient();
      const { data, error } = await client.from("knowledge_chunks").select("content, chunk_index, document_id, documents(title), knowledge_sources(name)").ilike("content", `%${query}%`).limit(10);
      if (error) { log("ERROR", "knowledge.search failed", { error: error.message }); return []; }
      return data ?? [];
    },
  },
  workObjects: {
    create: () => { throw new NotImplementedError("FounderMemory.workObjects.create — Work Engine sprint not started (work_objects table does not exist)"); },
    link: () => { throw new NotImplementedError("FounderMemory.workObjects.link — Work Engine sprint not started (work_objects table does not exist)"); },
  },
  learning: {
    recordOutcome: async (event: Record<string, unknown>) => {
      const client = getFounderBrainClient();
      // EVOLUTION AUDIT FINDING (2026-07-18): this previously recorded
      // value=(event.value ?? 1) unconditionally — meaning the metric's
      // VALUE never reflected success/failure at all (success was only a
      // tag). avg(value) over any window would always be 1.0/100%
      // regardless of real outcomes — a metric that could never tell the
      // truth. Now value is derived from success itself, so avg() genuinely
      // is a success rate, not a constant dressed up as one.
      const succeeded = (event.success as boolean) ?? true;
      await recordMetric(client, "founder_brain_outcome", succeeded ? 1 : 0, {
        function: (event.function_name as string) ?? "founder-brain",
        action: (event.action as string) ?? "outcome",
        success: succeeded,
      });
    },
  },
};

// ──────────────────────────────────────────────
// FounderAgent — INTERFACE ONLY (Step 6). No implementation.
// Signatures only, per the sprint's explicit instruction: "Do NOT build
// agents. Only expose: assignTask/receiveResult/requestReasoning/
// requestKnowledge/requestDecision. The implementation comes later."
// ──────────────────────────────────────────────
export interface FounderAgent {
  assignTask(task: Record<string, unknown>): Promise<{ taskId: string }>;
  receiveResult(taskId: string, result: unknown): Promise<void>;
  requestReasoning(prompt: string): Promise<LLMResult>;
  requestKnowledge(query: string): Promise<unknown[]>;
  requestDecision(options: unknown[]): Promise<unknown>;
}

export const founderAgent: FounderAgent = {
  assignTask: async (task: Record<string, unknown>) => {
    // SPRINT 2b: backed by real createTask() -> orchestrator_requests.
    const result = await createTask("founder-agent", {
      description: String(task.description ?? task.content ?? "unlabeled task"),
      department_code: task.department_code as string | undefined,
      risk_level: task.risk_level as TaskCandidate["risk_level"],
    });
    const row = result.data as { id?: string } | null;
    if (result.status !== "success" || !row?.id) throw new Error(`assignTask failed: ${result.error ?? "no id returned"}`);
    return { taskId: row.id };
  },
  receiveResult: () => { throw new NotImplementedError("FounderAgent.receiveResult"); },
  requestReasoning: (prompt: string) => reason("You are the Founder Brain, answering an agent's reasoning request.", prompt), // the one method Sprint 1 CAN back for real — it's just `reason()`
  requestKnowledge: (query: string) => founderMemory.knowledge.search(query), // SPRINT 2: backed by real FounderMemory.knowledge now
  requestDecision: () => { throw new NotImplementedError("FounderAgent.requestDecision"); },
};

// ============================================================================
// COGNITIVE ENGINE — SPRINT 2b (M1-S2b)
// ============================================================================
// Founder's correction: Memory Engine is not storage, it's a substrate for
// thinking/prioritization/imagination/learning/planning/goal tracking/
// automatic task creation. Everything below is built ON TOP OF the real
// FounderMemory primitives above — no new memory system, no new brain.
//
// Table reuse (grep-confirmed before writing, zero new tables):
//   - goals / insights / imagination -> founder_memory (permanent), tagged
//     via a `kind` field in the stored content so they're distinguishable
//     without a schema change.
//   - automatic task creation -> orchestrator_requests (already exists,
//     already wired to approvals via approval_id FK, already has a status
//     lifecycle: processing/completed/failed/awaiting_approval — this IS
//     the task queue; building a parallel "tasks" table would be exactly
//     the duplicate the Constitution forbids).
//   - continuous activity log -> execution_log via founderMemory.episodic
//     (same as Sprint 2).
// ============================================================================

export type GoalLevel = "vision" | "annual" | "quarterly" | "monthly" | "weekly" | "daily";

export interface Goal {
  description: string;
  target?: string;
  deadline?: string;
  level?: GoalLevel;
}

// SPRINT 3 (M1-S3): Goal Hierarchy. Still founder_memory only (kind:'goal'
// with a `level` field) — no new table. seedGoalHierarchy() is the one-time
// bootstrap for the founder's stated hierarchy; calling it again just adds
// more goal rows (founder_memory is append-only by design — see Sprint 2's
// comment on permanent memory), so it's idempotent-safe to call more than
// once, not something that needs a migration flag.
export async function seedGoalHierarchy(userId: string): Promise<void> {
  const hierarchy: Goal[] = [
    { level: "vision", description: "₹1,100 Crore revenue", deadline: "2030" },
    { level: "annual", description: "₹5 Crore revenue gate", deadline: "2027-03-31" },
  ];
  for (const g of hierarchy) {
    try { await setGoal(userId, g); } catch { /* logged inside permanent.set */ }
  }
}

// Every decision must be evaluated against the goal hierarchy — this is
// what Sprint 2c's "Decide" phase was missing (it only saw the thought +
// prediction, not the goals). Returns a short verdict string, not a
// boolean, because the founder wants explainability, not a silent gate.
export async function evaluateAgainstGoals(userId: string, candidateAction: string, correlationId: string = cid()): Promise<string> {
  const goals = await getGoals(userId);
  const result = await reason(
    "You are the Founder Brain evaluating a candidate action against the full goal hierarchy (vision/annual/quarterly/monthly/weekly/daily). In 1-2 sentences, say whether this action moves toward or away from the goals, and which goal it's most relevant to. Be honest if it's neutral/irrelevant.",
    `GOAL HIERARCHY:\n${JSON.stringify(goals)}\n\nCANDIDATE ACTION:\n${candidateAction}`,
    250,
    correlationId,
  );
  return result.text;
}

// ── Goal tracking (permanent memory, kind:'goal') ──────────────────
export async function setGoal(userId: string, goal: Goal): Promise<void> {
  await founderMemory.permanent.set(userId, { kind: "goal", ...goal, created_at: new Date().toISOString() });
}

export async function getGoals(userId: string): Promise<Goal[]> {
  const rows = (await founderMemory.permanent.get(userId)) as Array<{ content?: { kind?: string } }> | null;
  if (!rows) return [];
  return rows.filter((r) => r.content?.kind === "goal").map((r) => r.content as unknown as Goal);
}

// ──────────────────────────────────────────────
// Working Memory wiring for think() — EVOLUTION AUDIT FINDING (2026-07-18):
// same pattern as the goal-hierarchy and knowledge-retrieval fixes.
// founderMemory.working.get()/.set() has existed since Sprint 2, backed by
// real brain_messages/brain_conversations tables, and had ZERO callers
// anywhere in the codebase — grep-confirmed before writing this. "Working
// Memory" is explicitly named in the Constitution's cognition list as
// something that should exist; it existed and was simply never connected.
//
// RISK, handled explicitly rather than assumed away: brain_messages.
// conversation_id almost certainly has a real foreign key to
// brain_conversations.id (brain-engine's own code always creates a
// conversation via insert().select().single() before referencing it by
// id, never by an arbitrary string) — so working memory can't just be
// keyed by a fixed string like "founder-brain-internal-monologue" without
// a real row existing first. This helper finds-or-creates that one real
// row, and is wrapped so that if brain_conversations has constraints this
// guess doesn't satisfy (e.g. a user_id FK to auth.users this synthetic
// "founder" identity can't satisfy), the failure is caught and think()
// simply proceeds without working-memory context that cycle — exactly the
// same graceful-degradation pattern every other memory call in this file
// already uses. Never breaks reasoning to gain a memory feature.
let cachedBrainMonologueId: string | null | undefined; // undefined = not yet attempted this process lifetime
async function getOrCreateBrainMonologueConversation(): Promise<string | null> {
  if (cachedBrainMonologueId !== undefined) return cachedBrainMonologueId;
  try {
    const client = getFounderBrainClient();
    const { data: existing } = await client.from("brain_conversations").select("id").eq("title", "Founder Brain Internal Monologue").limit(1).maybeSingle();
    if (existing?.id) { cachedBrainMonologueId = existing.id; return existing.id; }
    const { data: created, error } = await client.from("brain_conversations").insert({ title: "Founder Brain Internal Monologue" }).select("id").single();
    if (error || !created?.id) { cachedBrainMonologueId = null; return null; }
    cachedBrainMonologueId = created.id;
    return created.id;
  } catch {
    cachedBrainMonologueId = null;
    return null;
  }
}

// ── think() — synthesize current state from grounded context + recent
//    episodic history + stored goals. Stores the insight, doesn't just
//    return it — this is memory-as-cognition, not memory-as-lookup. ──
export async function think(userId: string, topic = "current state of the business", correlationId: string = cid()): Promise<string> {
  // MEMORY MODEL: "the Brain should naturally retrieve information without
  // explicit instructions" — founderMemory.knowledge.search() already
  // existed (Sprint 2) but think() never called it; only 2 narrow explicit
  // call sites did (founderAgent.requestKnowledge — itself never called by
  // anything — and worldLearn()'s own dedup check). Every cognitiveTick
  // cycle was "thinking" without ever recalling anything it had previously
  // learned or ingested. This closes that: relevant knowledge is now
  // retrieved automatically as part of thinking, not as a separate step
  // something has to remember to ask for.
  const monologueId = await getOrCreateBrainMonologueConversation();
  const [context, goals, recentEvents, relevantKnowledge, priorThoughts] = await Promise.all([
    buildContext({ userId }, correlationId),
    getGoals(userId),
    founderMemory.episodic.query({}),
    founderMemory.knowledge.search(topic),
    monologueId ? founderMemory.working.get(monologueId) : Promise.resolve(null),
  ]);
  const result = await reason(
    "You are the Founder Brain thinking — not answering a question, reasoning about the business proactively. Ground every claim in the provided context, goals, recent activity, and relevant prior knowledge. If you were just thinking about something related, build on it rather than repeating it. If something is missing data, say so instead of guessing.",
    `THINK ABOUT: ${topic}\n\nWHAT I WAS JUST THINKING (short-term/working memory):\n${JSON.stringify(priorThoughts).slice(0, 1500)}\n\nGOALS:\n${JSON.stringify(goals)}\n\nRECENT ACTIVITY (last 50 events):\n${JSON.stringify(recentEvents.slice(0, 20))}\n\nRELEVANT PRIOR KNOWLEDGE:\n${JSON.stringify(relevantKnowledge).slice(0, 2000)}\n\nGROUNDED CONTEXT:\n${JSON.stringify(context).slice(0, 6000)}`,
    1200,
    correlationId,
  );
  try { await founderMemory.permanent.set(userId, { kind: "insight", topic, text: result.text, created_at: new Date().toISOString() }); } catch { /* logged inside permanent.set */ }
  if (monologueId) {
    try { await founderMemory.working.set(monologueId, { role: "assistant", content: `[${topic}] ${result.text}`.slice(0, 2000) }); } catch { /* logged inside working.set; never blocks think()'s real return value */ }
  }
  return result.text;
}

// ── imagine() — explicitly speculative reasoning. NOT grounded-required
//    (Constitution's "never fabricate" governs FACTS about the business;
//    imagination is deliberately allowed to speculate, but every output is
//    tagged 'imagination' in memory so nothing downstream can mistake it
//    for a grounded answer). ──
export async function imagine(userId: string, prompt: string, correlationId: string = cid()): Promise<string> {
  const result = await reason(
    "You are the Founder Brain imagining — open-ended, speculative, exploratory. This is explicitly NOT a grounded factual answer; label it as an idea/possibility, never as a fact or a number that looks like real business data.",
    prompt,
    1000,
    correlationId,
  );
  try { await founderMemory.permanent.set(userId, { kind: "imagination", prompt, text: result.text, created_at: new Date().toISOString() }); } catch { /* logged inside permanent.set */ }
  return result.text;
}

// ── prioritize() — ranks arbitrary items (goals, leads, milestones, ideas)
//    against stored goals. Real reasoning pass, not a hardcoded sort. ──
export async function prioritize(userId: string, items: unknown[], correlationId: string = cid()): Promise<unknown[]> {
  const goals = await getGoals(userId);
  const result = await reason(
    "You are the Founder Brain prioritizing. Given goals and a list of items, return ONLY a JSON array containing the same items reordered highest-priority-first. Do not add or remove items, do not invent new ones.",
    `GOALS:\n${JSON.stringify(goals)}\n\nITEMS:\n${JSON.stringify(items)}`,
    1000,
    correlationId,
  );
  try {
    const parsed = JSON.parse(result.text);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  return items; // honest fallback: original order, not a fabricated ranking
}

// ── automatic task creation — writes a REAL row to orchestrator_requests,
//    the existing task/request table (has approval_id FK to `approvals`,
//    a real status lifecycle, department routing). This is not a new task
//    system; it's the Founder Brain becoming a writer of an existing one. ──
export interface TaskCandidate {
  description: string;
  department_code?: string;
  risk_level?: "low" | "medium" | "high" | "critical";
}

export async function createTask(userId: string, task: TaskCandidate, correlationId: string = cid()): Promise<DataSourceResult> {
  const client = getFounderBrainClient();
  const needsApproval = task.risk_level === "high" || task.risk_level === "critical";
  try {
    const { data, error } = await client
      .from("orchestrator_requests")
      .insert({
        raw_request: task.description,
        requested_by: "founder-brain",
        department_code: task.department_code ?? null,
        risk_level: task.risk_level ?? "low",
        status: needsApproval ? "awaiting_approval" : "processing",
      })
      .select()
      .single();
    if (error) { log("ERROR", "createTask failed", { error: error.message }, correlationId); return { source: "orchestrator_requests", status: "error", data: null, error: error.message }; }
    try { await founderMemory.episodic.append({ function_name: "founder-brain", action: "createTask", status: "success", output_summary: task.description.slice(0, 300) }); } catch { /* non-blocking */ }
    return { source: "orchestrator_requests", status: "success", data };
  } catch (err) {
    return { source: "orchestrator_requests", status: "error", data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================================
// SPRINT 3 (M1-S3) additions — World Learning, Constitution Evolution,
// real department routing, Strategic Imagination. All extend the existing
// Founder Brain in place; zero new tables, zero parallel systems.
// ============================================================================

// ── World Learning — learns from EXTERNAL input (research-engine,
//    market-intelligence, web-crawler outputs, or founder-fed signals).
//    This function does not itself fetch the web — those edge functions
//    already exist and already do that; wiring them as callers of
//    worldLearn() is the adapter step (same posture as the other untouched
//    live surfaces from Sprint 1). "Store only meaningful learning, never
//    duplicate" -> checks founderMemory.knowledge.search() for a
//    near-duplicate before writing; skips the write if one exists. ──
export interface WorldLearningInput {
  source: "research-engine" | "market-intelligence" | "web-crawler" | "founder-fed" | string;
  topic: string;
  content: string;
}

export async function worldLearn(userId: string, input: WorldLearningInput, correlationId: string = cid()): Promise<{ stored: boolean; reason: string }> {
  // Dedup check against existing knowledge before touching anything.
  let existing: unknown[] = [];
  try {
    existing = await founderMemory.knowledge.search(input.topic);
  } catch { /* if search fails, fall through and let the LLM check do the work */ }

  const verdict = await reason(
    "You decide whether this external input is MEANINGFULLY NEW versus what's already known, or a duplicate/restatement. Answer ONLY 'new' or 'duplicate'.",
    `TOPIC: ${input.topic}\n\nNEW CONTENT:\n${input.content}\n\nALREADY KNOWN (${existing.length} matches):\n${JSON.stringify(existing).slice(0, 2000)}`,
    10,
    correlationId,
  );

  if (verdict.text.trim().toLowerCase().startsWith("duplicate")) {
    return { stored: false, reason: "duplicate of existing knowledge — not stored, per 'never duplicate knowledge'" };
  }

  const synthesis = await reason(
    "You are the Founder Brain's World Learning function. Summarize what's meaningfully new and actionable about this external input, in 2-3 sentences. Do not restate the raw content verbatim.",
    `SOURCE: ${input.source}\nTOPIC: ${input.topic}\nCONTENT:\n${input.content}`,
    400,
    correlationId,
  );

  try {
    await founderMemory.permanent.set(userId, { kind: "world_learning", source: input.source, topic: input.topic, text: synthesis.text, created_at: new Date().toISOString() });
    await founderMemory.episodic.append({ function_name: "founder-brain", action: "world_learn", status: "success", input_summary: input.topic.slice(0, 300), output_summary: synthesis.text.slice(0, 300) });
  } catch { /* logged inside the memory calls themselves */ }

  return { stored: true, reason: synthesis.text };
}

// ── Constitution Evolution — versioned, explainable, append-only. Reuses
//    founder_memory (kind:'constitution_amendment') exactly like every
//    other memory type in this file; the "version" is just a running count
//    of prior amendments — no new versioning table, no overwriting a row
//    ever (permanent.set is already insert-only, never update). ──
export type ConstitutionArea = "prompts" | "workflows" | "departments" | "kpis" | "reasoning" | "execution" | "governance";

export interface ConstitutionAmendment {
  area: ConstitutionArea;
  change: string;
  rationale: string;
}

export async function proposeAmendment(userId: string, amendment: ConstitutionAmendment): Promise<{ version: number }> {
  const history = await getConstitutionHistory(userId);
  const version = history.length + 1;
  await founderMemory.permanent.set(userId, { kind: "constitution_amendment", version, ...amendment, created_at: new Date().toISOString() });
  try { await founderMemory.episodic.append({ function_name: "founder-brain", action: "constitution_amendment", status: "success", output_summary: `v${version} ${amendment.area}: ${amendment.change}`.slice(0, 300) }); } catch { /* non-blocking */ }
  return { version };
}

export async function getConstitutionHistory(userId: string): Promise<Array<ConstitutionAmendment & { version: number }>> {
  const rows = (await founderMemory.permanent.get(userId)) as Array<{ content?: { kind?: string } }> | null;
  if (!rows) return [];
  return rows.filter((r) => r.content?.kind === "constitution_amendment").map((r) => r.content as unknown as ConstitutionAmendment & { version: number });
}

// ── Real department routing — reads the ACTUAL `departments` table
//    (code/name/mission/kpis, already exists, already governs the
//    org — GovernanceDashboard reads from this same org layer) instead of
//    the hardcoded "EXECUTIVE" string every createTask() call used before.
//    Falls back to "EXECUTIVE" only if the table has no active rows or the
//    LLM can't pick one — never breaks task creation. ──
export async function routeToDepartment(description: string, correlationId: string = cid()): Promise<string> {
  const client = getFounderBrainClient();
  try {
    const { data } = await client.from("departments").select("code, name, mission").eq("is_active", true);
    if (!data || data.length === 0) return "EXECUTIVE";
    const pick = await reason(
      "Given this task and the list of real departments (code/name/mission), answer with ONLY the department code that best fits. If none fit well, answer EXECUTIVE.",
      `TASK: ${description}\n\nDEPARTMENTS:\n${JSON.stringify(data)}`,
      20,
      correlationId,
    );
    const code = pick.text.trim().split(/\s/)[0].toUpperCase();
    return data.some((d: { code: string }) => d.code === code) ? code : "EXECUTIVE";
  } catch (err) {
    log("ERROR", "routeToDepartment failed, defaulting to EXECUTIVE", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    return "EXECUTIVE";
  }
}

// ── Strategic Imagination — simulate MULTIPLE future strategies, predict
//    each, reject weak ones, select the strongest, BEFORE any assignment.
//    Extends imagine()+reason() (no new reasoning path) into a compare
//    step that Sprint 2c's cognitiveTick didn't have (it only ever
//    compared 2 candidates via a single prioritize() call, with no
//    explicit reject/select record). ──
export interface Strategy {
  description: string;
  predictedOutcome: string;
  score: number; // 1-10, LLM-assigned, for an explainable reject/select record
}

export async function simulateStrategies(userId: string, situation: string, count = 3, correlationId: string = cid()): Promise<{ selected: Strategy | null; rejected: Strategy[] }> {
  const goals = await getGoals(userId);
  const gen = await reason(
    `You are the Founder Brain imagining multiple future strategies (not one). Generate exactly ${count} DIFFERENT candidate strategies for the situation below, each genuinely distinct in approach — not variations of the same idea. For each, predict the likely outcome and score it 1-10 against the goal hierarchy. Return ONLY a JSON array of {description, predictedOutcome, score}.`,
    `SITUATION:\n${situation}\n\nGOAL HIERARCHY:\n${JSON.stringify(goals)}`,
    1200,
    correlationId,
  );

  let strategies: Strategy[] = [];
  try {
    const parsed = JSON.parse(gen.text);
    if (Array.isArray(parsed)) strategies = parsed;
  } catch {
    // Honest fallback — no fabricated strategies if parsing fails.
    return { selected: null, rejected: [] };
  }

  if (strategies.length === 0) return { selected: null, rejected: [] };
  const sorted = [...strategies].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const [selected, ...rejected] = sorted;

  try {
    await founderMemory.episodic.append({
      function_name: "founder-brain", action: "simulate_strategies", status: "success",
      input_summary: situation.slice(0, 300),
      output_summary: `selected(score=${selected.score}): ${selected.description}`.slice(0, 300),
    });
  } catch { /* non-blocking */ }

  return { selected, rejected };
}

// ── cognitiveTick() — SPRINT 3 (M1-S3): evolved again — now wires in Strategic
//    Imagination (simulate multiple strategies, reject weak ones, select
//    the strongest BEFORE assigning), goal-hierarchy evaluation in Decide,
//    real department routing in Assign, and versioned Constitution
//    amendments in Improve. Same 12-phase shape from Sprint 2c:
//      Observe → Think → Imagine → Learn → Predict → Decide → Prioritize →
//      Assign → Execute → Review → Learn → Improve → Repeat
//    "Execute" is still NOT the brain doing work — per the Constitution
//    ("Founder Brain never executes... Departments execute"), Execute here
//    means the assignment becomes visible to whichever department/agent
//    picks up `orchestrator_requests` rows. "Repeat" is still the cron
//    schedule calling this function again, not a loop inside it. Every
//    phase stays independently try/catch'd. Same function/entry point
//    since Sprint 2b — evolved in place again, not a parallel v2. ──
export interface TickResult {
  observed: boolean;
  thought: string;
  imagined: string;
  learnedFromPast: number;
  predicted: string;
  goalEvaluation: string;
  decision: "act" | "wait";
  strategySelected: Strategy | null;
  strategiesRejected: number;
  assessedRisk: "low" | "medium" | "high" | "critical" | null;
  assignedDepartment: string | null;
  assigned: { taskId: string } | null;
  reviewed: number;
  improved: { version: number; change: string } | null;
  correlationId: string;
}

export async function cognitiveTick(userId: string): Promise<TickResult> {
  const correlationId = cid();
  log("INFO", "cognitiveTick: cycle starting", {}, correlationId);

  // 1. OBSERVE
  let observed = false;
  try {
    await buildContext({ userId }, correlationId);
    observed = true;
  } catch (err) {
    log("ERROR", "cycle: observe failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
  }

  // 2. THINK
  let thought = "";
  try {
    thought = await think(userId, "what needs the founder's attention right now, given goals vs. actual state", correlationId);
  } catch (err) {
    log("ERROR", "cycle: think failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
  }

  // 3. IMAGINE — single speculative seed, kept for the return shape /
  //    backward compatibility; the REAL multi-strategy imagination now
  //    happens in step 7 (simulateStrategies), not here.
  let imagined = "";
  if (thought) {
    try {
      imagined = await imagine(userId, `Given this observation, what's one non-obvious thing worth trying that hasn't been tried?\n\n${thought}`, correlationId);
    } catch (err) {
      log("ERROR", "cycle: imagine failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

  // 4. LEARN (pre)
  let pastOutcomes: unknown[] = [];
  try {
    pastOutcomes = await founderMemory.episodic.query({ function_name: "founder-brain" });
  } catch (err) {
    log("ERROR", "cycle: learn(pre) failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
  }

  // 5. PREDICT
  let predicted = "";
  if (thought) {
    try {
      const p = await reason(
        "You are the Founder Brain predicting. In 1-2 sentences, predict the likely outcome if this observation is acted on now, given the recent history provided. Be honest if history is too thin to predict from.",
        `OBSERVATION:\n${thought}\n\nRECENT HISTORY (${pastOutcomes.length} events):\n${JSON.stringify(pastOutcomes.slice(0, 10))}`,
        300,
        correlationId,
      );
      predicted = p.text;
    } catch (err) {
      log("ERROR", "cycle: predict failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

  // 5b. GOAL-HIERARCHY EVALUATION — SPRINT 3: every decision now
  //     explicitly evaluated against the goal hierarchy, not just the raw
  //     thought/prediction.
  let goalEvaluation = "";
  if (thought) {
    try {
      goalEvaluation = await evaluateAgainstGoals(userId, thought, correlationId);
    } catch (err) {
      log("ERROR", "cycle: goal evaluation failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

  // 6. DECIDE — now informed by thought + prediction + goal evaluation.
  let decision: "act" | "wait" = "wait";
  if (thought) {
    try {
      const d = await reason(
        "You decide, in ONE word, whether to ACT or WAIT. Answer ONLY 'act' or 'wait'. Act only if there's a concrete gap worth a real task AND it's relevant to the goal hierarchy below.",
        `OBSERVATION:\n${thought}\n\nPREDICTED OUTCOME IF ACTED ON:\n${predicted}\n\nGOAL RELEVANCE:\n${goalEvaluation}`,
        10,
        correlationId,
      );
      decision = d.text.trim().toLowerCase().startsWith("act") ? "act" : "wait";
    } catch (err) {
      log("ERROR", "cycle: decide failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

  // 7. STRATEGIC IMAGINATION + PRIORITIZE — SPRINT 3: simulate multiple
  //    strategies for the situation, reject the weak ones, select the
  //    strongest. Replaces Sprint 2c's 2-candidate prioritize() call with
  //    an explicit reject/select record (Strategy.score), per the
  //    founder's instruction: "compare alternatives, predict outcomes,
  //    reject weak strategies, select the strongest path before execution."
  let strategySelected: Strategy | null = null;
  let strategiesRejected = 0;
  if (decision === "act") {
    try {
      const sim = await simulateStrategies(userId, `${thought}\n\nOne earlier speculative idea: ${imagined}`, 3, correlationId);
      strategySelected = sim.selected;
      strategiesRejected = sim.rejected.length;
    } catch (err) {
      log("ERROR", "cycle: strategic imagination failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

  // 7b. RISK ASSESSMENT — "Fear is not emotion, it is intelligent risk
  //    awareness" (permanent cognitive directive). Previously this cycle
  //    hardcoded risk_level:"low" on every single assignment — meaning
  //    createTask()'s existing high/critical->awaiting_approval gate
  //    (built Sprint 2b) never actually triggered from cognitiveTick,
  //    because nothing upstream ever fed it a real assessment. This closes
  //    that gap with the gate that already existed, not a new one.
  let assessedRisk: "low" | "medium" | "high" | "critical" = "low";
  if (decision === "act" && strategySelected) {
    try {
      const riskResult = await reason(
        "You are the Founder Brain assessing risk before acting — not emotion, intelligent caution. Consider financial, legal, operational, execution, security, and reputation risk in the action described. Answer with ONLY one word: low, medium, high, or critical.",
        strategySelected.description,
        10,
        correlationId,
      );
      const word = riskResult.text.trim().toLowerCase();
      if (word.startsWith("critical")) assessedRisk = "critical";
      else if (word.startsWith("high")) assessedRisk = "high";
      else if (word.startsWith("medium")) assessedRisk = "medium";
      else assessedRisk = "low"; // honest default — an unparseable answer is treated as needing caution, not escalated to false alarm
    } catch (err) {
      log("ERROR", "cycle: risk assessment failed, defaulting to low", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

  // 8+9. ASSIGN + EXECUTE — SPRINT 3: real department routing instead of
  //    the hardcoded "EXECUTIVE" string. Still hands off, never executes.
  let assignedDepartment: string | null = null;
  let assigned: { taskId: string } | null = null;
  if (decision === "act" && strategySelected) {
    try {
      assignedDepartment = await routeToDepartment(strategySelected.description, correlationId);
      const result = await createTask(userId, { description: strategySelected.description.slice(0, 500), department_code: assignedDepartment, risk_level: assessedRisk }, correlationId);
      const row = result.data as { id?: string } | null;
      if (result.status === "success" && row?.id) assigned = { taskId: row.id };
    } catch (err) {
      log("ERROR", "cycle: assign failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

  // 10. REVIEW
  let reviewedCount = 0;
  let completedRows: Array<{ id: string; raw_request: string; status: string }> = [];
  try {
    const client = getFounderBrainClient();
    const { data } = await client.from("orchestrator_requests").select("id, raw_request, status").eq("requested_by", "founder-brain").eq("status", "completed").limit(10);
    completedRows = data ?? [];
    reviewedCount = completedRows.length;
  } catch (err) {
    log("ERROR", "cycle: review failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
  }

  // 11. LEARN (post)
  for (const row of completedRows) {
    try {
      await founderMemory.learning.recordOutcome({ function_name: "founder-brain", action: "task_completed", success: true, value: 1 });
    } catch { /* non-blocking */ }
  }

  // 12. IMPROVE — SPRINT 3: now a versioned, explainable Constitution
  //     amendment (proposeAmendment()) instead of a plain memory note —
  //     "every improvement must be versioned and explainable."
  let improved: { version: number; change: string } | null = null;
  if (completedRows.length > 0) {
    try {
      const imp = await reason(
        "You are the Founder Brain improving. Given these completed tasks, state in 1 sentence whether reasoning/execution/governance should adjust, or say 'no change needed'. If change is warranted, also name which ONE area applies: prompts, workflows, departments, kpis, reasoning, execution, or governance.",
        JSON.stringify(completedRows),
        200,
        correlationId,
      );
      if (!imp.text.toLowerCase().includes("no change")) {
        const areaMatch = (["prompts", "workflows", "departments", "kpis", "reasoning", "execution", "governance"] as ConstitutionArea[]).find((a) => imp.text.toLowerCase().includes(a));
        const { version } = await proposeAmendment(userId, { area: areaMatch ?? "execution", change: imp.text, rationale: `Derived from reviewing ${completedRows.length} completed founder-brain task(s) this cycle.` });
        improved = { version, change: imp.text };
      }
    } catch (err) {
      log("ERROR", "cycle: improve failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

  // REPEAT — the cron schedule calling cognitiveTick() again is the
  // repeat; no loop lives inside this function.

  try {
    await founderMemory.episodic.append({
      function_name: "founder-brain-tick", action: "cognitive_cycle", status: "success",
      output_summary: `observed=${observed} decision=${decision} dept=${assignedDepartment} assigned=${!!assigned} reviewed=${reviewedCount} improved=${!!improved}`.slice(0, 300),
    });
  } catch { /* non-blocking */ }

  return {
    observed, thought, imagined, learnedFromPast: pastOutcomes.length, predicted, goalEvaluation, decision,
    strategySelected, strategiesRejected, assessedRisk: decision === "act" && strategySelected ? assessedRisk : null, assignedDepartment, assigned, reviewed: reviewedCount, improved, correlationId,
  };
}
