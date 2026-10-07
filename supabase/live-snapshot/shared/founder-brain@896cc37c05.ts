import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

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
    const { data } = await client
      .from("fleet_memory")
      .select("memory_type, structured_content, created_at")
      .eq("source_department", FOUNDER_BRAIN_DEPARTMENT)
      .order("created_at", { ascending: false })
      .limit(20);
    if (!data || data.length === 0) return { source: "founder_memory", status: "no_data", data: null, error: "No stored memory entries" };
    const mapped = data.map((row: { memory_type: string; structured_content: Record<string, unknown> | null; created_at: string }) => ({
      content: { kind: row.memory_type, ...(row.structured_content ?? {}) },
      updated_at: row.created_at,
    }));
    return { source: "founder_memory", status: "success", data: mapped };
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
  try {
    await founderMemory.episodic.append({
      function_name: "founder-brain", department_code: "EXECUTIVE", action: `route:${req.type}`,
      status: "success", input_summary: req.content.slice(0, 300), output_summary: result.text.slice(0, 300),
    });
  } catch { /* logged inside episodic.append; never break the caller's response */ }
  return { text: result.text, context };
}

export async function createWorkObject(_input: { content: string; type?: string; title?: string }): Promise<DataSourceResult> {
  return { source: "work_objects", status: "unconfigured", data: null, error: "work_objects table not present in this codebase — Work Engine sprint not yet started" };
}

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

export const FOUNDER_BRAIN_DEPARTMENT = "EXECUTIVE";

function summarizeMemoryPayload(v: Record<string, unknown>): string {
  const candidates = ["text", "description", "currentBelief", "recommendedChange", "change", "topic", "principle"];
  for (const key of candidates) {
    const val = v[key];
    if (typeof val === "string" && val.length > 0) return val.slice(0, 500);
  }
  return "";
}

export const founderMemory: FounderMemory = {
  permanent: {
    get: async (userId: string) => {
      void userId;
      const client = getFounderBrainClient();
      const { data, error } = await client
        .from("fleet_memory")
        .select("memory_type, structured_content, created_at")
        .eq("source_department", FOUNDER_BRAIN_DEPARTMENT)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) { log("ERROR", "permanent.get failed", { error: error.message }); return null; }
      return (data ?? []).map((row: { memory_type: string; structured_content: Record<string, unknown> | null; created_at: string }) => ({
        content: { kind: row.memory_type, ...(row.structured_content ?? {}) },
        updated_at: row.created_at,
      }));
    },
    set: async (userId: string, value: unknown) => {
      void userId;
      const client = getFounderBrainClient();
      const v = (value ?? {}) as { kind?: string; resolved?: boolean; confidence?: number } & Record<string, unknown>;
      const kind = v.kind ?? "insight";
      const founderOnly = kind === "imagination" || (kind === "belief" && v.resolved === false);
      const { error } = await client.from("fleet_memory").insert({
        source_department: FOUNDER_BRAIN_DEPARTMENT,
        memory_type: kind,
        title: kind,
        content: summarizeMemoryPayload(v),
        structured_content: v,
        confidence: typeof v.confidence === "number" ? v.confidence : null,
        visible_to_departments: founderOnly ? [FOUNDER_BRAIN_DEPARTMENT] : ["*"],
        visible_to_agents: [],
      });
      if (error) { log("ERROR", "permanent.set failed (fleet_memory adapter)", { error: error.message }); throw error; }
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
      const succeeded = (event.success as boolean) ?? true;
      const { error } = await client.from("fleet_memory").insert({
        source_department: FOUNDER_BRAIN_DEPARTMENT,
        memory_type: "learning",
        title: "learning",
        content: `${(event.function_name as string) ?? "founder-brain"}:${(event.action as string) ?? "outcome"} -> ${succeeded ? "success" : "failure"}`,
        structured_content: {
          function: (event.function_name as string) ?? "founder-brain",
          action: (event.action as string) ?? "outcome",
          success: succeeded,
        },
        confidence: succeeded ? 100 : 0,
        visible_to_departments: ["*"],
        visible_to_agents: [],
      });
      if (error) { log("ERROR", "learning.recordOutcome failed (fleet_memory adapter)", { error: error.message }); }
    },
  },
};

export interface FounderAgent {
  assignTask(task: Record<string, unknown>): Promise<{ taskId: string }>;
  receiveResult(taskId: string, result: unknown): Promise<void>;
  requestReasoning(prompt: string): Promise<LLMResult>;
  requestKnowledge(query: string): Promise<unknown[]>;
  requestDecision(options: unknown[]): Promise<unknown>;
}

export const founderAgent: FounderAgent = {
  assignTask: async (task: Record<string, unknown>) => {
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
  requestReasoning: (prompt: string) => reason("You are the Founder Brain, answering an agent's reasoning request.", prompt),
  requestKnowledge: (query: string) => founderMemory.knowledge.search(query),
  requestDecision: () => { throw new NotImplementedError("FounderAgent.requestDecision"); },
};

export type GoalLevel = "vision" | "annual" | "quarterly" | "monthly" | "weekly" | "daily";

export interface Goal {
  description: string;
  target?: string;
  deadline?: string;
  level?: GoalLevel;
}

export async function seedGoalHierarchy(userId: string): Promise<void> {
  const hierarchy: Goal[] = [
    { level: "vision", description: "₹1,100 Crore revenue", deadline: "2030" },
    { level: "annual", description: "₹5 Crore revenue gate", deadline: "2027-03-31" },
  ];
  for (const g of hierarchy) {
    try { await setGoal(userId, g); } catch { /* logged inside permanent.set */ }
  }
}

export interface FounderIdentitySnapshot {
  version: number;
  name: string;
  content: string;
  active: boolean;
}

export interface FounderPrincipleSnapshot {
  principle: string;
  category: string;
  weight: number;
}

export async function getFounderIdentity(): Promise<FounderIdentitySnapshot | null> {
  const client = getFounderBrainClient();
  try {
    const { data, error } = await client
      .from("founder_identity")
      .select("version, name, content, active")
      .eq("active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as FounderIdentitySnapshot;
  } catch {
    return null;
  }
}

export async function getFounderPrinciples(agentContext = "founder-brain"): Promise<FounderPrincipleSnapshot[]> {
  const client = getFounderBrainClient();
  try {
    const { data, error } = await client
      .from("founder_principles")
      .select("principle, category, applies_to, weight")
      .eq("active", true)
      .order("weight", { ascending: false })
      .limit(50);
    if (error || !data) return [];
    return (data as Array<{ principle: string; category: string; applies_to: string[] | null; weight: number }>)
      .filter((r) => !r.applies_to || r.applies_to.includes("*") || r.applies_to.includes(agentContext))
      .map((r) => ({ principle: r.principle, category: r.category, weight: r.weight }));
  } catch {
    return [];
  }
}

export async function evaluateAgainstGoals(userId: string, candidateAction: string, correlationId: string = cid()): Promise<string> {
  const [goals, principles] = await Promise.all([getGoals(userId), getFounderPrinciples()]);
  const result = await reason(
    "You are the Founder Brain evaluating a candidate action against the full goal hierarchy (vision/annual/quarterly/monthly/weekly/daily) AND the founder's governing principles. In 1-2 sentences, say whether this action moves toward or away from the goals, which goal it's most relevant to, and flag explicitly if it conflicts with any stated principle. Be honest if it's neutral/irrelevant.",
    `GOAL HIERARCHY:\n${JSON.stringify(goals)}\n\nFOUNDER PRINCIPLES:\n${JSON.stringify(principles)}\n\nCANDIDATE ACTION:\n${candidateAction}`,
    250,
    correlationId,
  );
  return result.text;
}

export async function setGoal(userId: string, goal: Goal): Promise<void> {
  await founderMemory.permanent.set(userId, { kind: "goal", ...goal, created_at: new Date().toISOString() });
}

export async function getGoals(userId: string): Promise<Goal[]> {
  const rows = (await founderMemory.permanent.get(userId)) as Array<{ content?: { kind?: string } }> | null;
  if (!rows) return [];
  return rows.filter((r) => r.content?.kind === "goal").map((r) => r.content as unknown as Goal);
}

let cachedBrainMonologueId: string | null | undefined;
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

export async function think(userId: string, topic = "current state of the business", correlationId: string = cid()): Promise<string> {
  const monologueId = await getOrCreateBrainMonologueConversation();
  const [context, goals, identity, principles, recentEvents, relevantKnowledge, priorThoughts] = await Promise.all([
    buildContext({ userId }, correlationId),
    getGoals(userId),
    getFounderIdentity(),
    getFounderPrinciples(),
    founderMemory.episodic.query({}),
    founderMemory.knowledge.search(topic),
    monologueId ? founderMemory.working.get(monologueId) : Promise.resolve(null),
  ]);
  const result = await reason(
    "You are the Founder Brain thinking — not answering a question, reasoning about the business proactively. Ground every claim in the provided context, goals, founder identity/principles, recent activity, and relevant prior knowledge. Recommendations must not conflict with the stated principles. If you were just thinking about something related, build on it rather than repeating it. If something is missing data, say so instead of guessing.",
    `THINK ABOUT: ${topic}\n\nWHAT I WAS JUST THINKING (short-term/working memory):\n${JSON.stringify(priorThoughts).slice(0, 1500)}\n\nFOUNDER IDENTITY:\n${JSON.stringify(identity)}\n\nFOUNDER PRINCIPLES:\n${JSON.stringify(principles)}\n\nGOALS:\n${JSON.stringify(goals)}\n\nRECENT ACTIVITY (last 50 events):\n${JSON.stringify(recentEvents.slice(0, 20))}\n\nRELEVANT PRIOR KNOWLEDGE:\n${JSON.stringify(relevantKnowledge).slice(0, 2000)}\n\nGROUNDED CONTEXT:\n${JSON.stringify(context).slice(0, 6000)}`,
    1200,
    correlationId,
  );
  try { await founderMemory.permanent.set(userId, { kind: "insight", topic, text: result.text, created_at: new Date().toISOString() }); } catch { /* logged inside permanent.set */ }
  if (monologueId) {
    try { await founderMemory.working.set(monologueId, { role: "assistant", content: `[${topic}] ${result.text}`.slice(0, 2000) }); } catch { /* logged inside working.set; never blocks think()'s real return value */ }
  }
  return result.text;
}

export interface ImaginationEntry { prompt: string; text: string; created_at: string }
export async function getImaginationHistory(userId: string): Promise<ImaginationEntry[]> {
  const rows = (await founderMemory.permanent.get(userId)) as Array<{ content?: { kind?: string } }> | null;
  if (!rows) return [];
  return rows.filter((r) => r.content?.kind === "imagination").map((r) => r.content as unknown as ImaginationEntry);
}

export async function imagine(userId: string, prompt: string, correlationId: string = cid()): Promise<string> {
  const priorImaginings = await getImaginationHistory(userId);
  const result = await reason(
    "You are the Founder Brain imagining — open-ended, speculative, exploratory. This is explicitly NOT a grounded factual answer; label it as an idea/possibility, never as a fact or a number that looks like real business data. If you have imagined something related before, build on or explicitly diverge from it rather than repeating it — say which.",
    `NEW PROMPT: ${prompt}\n\nPRIOR IMAGININGS (build on or diverge from these, don't just repeat):\n${JSON.stringify(priorImaginings.slice(-5))}`,
    1000,
    correlationId,
  );
  try { await founderMemory.permanent.set(userId, { kind: "imagination", prompt, text: result.text, created_at: new Date().toISOString() }); } catch { /* logged inside permanent.set */ }
  return result.text;
}

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
  return items;
}

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
    if (needsApproval && data?.id) {
      try {
        await client.from("approvals").insert({
          department_code: task.department_code ?? null,
          action_type: "founder_brain_task",
          payload: { orchestrator_request_id: data.id, description: task.description },
          risk_level: task.risk_level,
          reason: `Founder Brain assessed this task as ${task.risk_level} risk before assignment`,
        });
      } catch (approvalErr) {
        log("ERROR", "createTask: failed to file approvals row (task itself was still created, but may be invisible to the Founder)", { error: approvalErr instanceof Error ? approvalErr.message : String(approvalErr) }, correlationId);
      }
    }
    try { await founderMemory.episodic.append({ function_name: "founder-brain", action: "createTask", status: "success", output_summary: task.description.slice(0, 300) }); } catch { /* non-blocking */ }
    return { source: "orchestrator_requests", status: "success", data };
  } catch (err) {
    return { source: "orchestrator_requests", status: "error", data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface WorldLearningInput {
  source: "research-engine" | "market-intelligence" | "web-crawler" | "founder-fed" | string;
  topic: string;
  content: string;
}

export async function worldLearn(userId: string, input: WorldLearningInput, correlationId: string = cid()): Promise<{ stored: boolean; reason: string }> {
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

export interface DecisionCandidate {
  description: string;
  reasoning: string;
  expectedOutcome: string;
  confidence: number;
  tradeoffs?: string;
  departmentCode?: string | null;
  riskLevel?: "low" | "medium" | "high" | "critical";
}

export interface CapturedDecision extends DecisionCandidate {
  created_at: string;
}

export async function captureDecision(userId: string, decision: DecisionCandidate, correlationId: string = cid()): Promise<void> {
  try {
    await founderMemory.permanent.set(userId, {
      kind: "decision",
      description: decision.description,
      reasoning: decision.reasoning,
      expectedOutcome: decision.expectedOutcome,
      confidence: decision.confidence,
      tradeoffs: decision.tradeoffs ?? "",
      departmentCode: decision.departmentCode ?? null,
      riskLevel: decision.riskLevel ?? "low",
      created_at: new Date().toISOString(),
    });
    try { await founderMemory.episodic.append({ function_name: "founder-brain", action: "capture_decision", status: "success", output_summary: decision.description.slice(0, 300) }); } catch { /* non-blocking */ }
  } catch (err) {
    log("ERROR", "captureDecision failed (non-blocking — task creation proceeds regardless)", { error: err instanceof Error ? err.message : String(err) }, correlationId);
  }
}

export async function getDecisionHistory(userId: string): Promise<CapturedDecision[]> {
  const rows = (await founderMemory.permanent.get(userId)) as Array<{ content?: { kind?: string } }> | null;
  if (!rows) return [];
  return rows.filter((r) => r.content?.kind === "decision").map((r) => r.content as unknown as CapturedDecision);
}

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

export interface Strategy {
  description: string;
  predictedOutcome: string;
  score: number;
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

  let observed = false;
  try {
    await buildContext({ userId }, correlationId);
    observed = true;
  } catch (err) {
    log("ERROR", "cycle: observe failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
  }

  let thought = "";
  try {
    thought = await think(userId, "what needs the founder's attention right now, given goals vs. actual state", correlationId);
  } catch (err) {
    log("ERROR", "cycle: think failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
  }

  let imagined = "";
  if (thought) {
    try {
      imagined = await imagine(userId, `Given this observation, what's one non-obvious thing worth trying that hasn't been tried?\n\n${thought}`, correlationId);
    } catch (err) {
      log("ERROR", "cycle: imagine failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

  let pastOutcomes: unknown[] = [];
  try {
    pastOutcomes = await founderMemory.episodic.query({ function_name: "founder-brain" });
  } catch (err) {
    log("ERROR", "cycle: learn(pre) failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
  }

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

  let goalEvaluation = "";
  if (thought) {
    try {
      goalEvaluation = await evaluateAgainstGoals(userId, thought, correlationId);
    } catch (err) {
      log("ERROR", "cycle: goal evaluation failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

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
      else assessedRisk = "low";
    } catch (err) {
      log("ERROR", "cycle: risk assessment failed, defaulting to low", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

  let assignedDepartment: string | null = null;
  let assigned: { taskId: string } | null = null;
  if (decision === "act" && strategySelected) {
    try {
      assignedDepartment = await routeToDepartment(strategySelected.description, correlationId);
      await captureDecision(userId, {
        description: strategySelected.description,
        reasoning: goalEvaluation || thought,
        expectedOutcome: strategySelected.predictedOutcome,
        confidence: strategySelected.score * 10,
        departmentCode: assignedDepartment,
        riskLevel: assessedRisk,
      }, correlationId);
      const result = await createTask(userId, { description: strategySelected.description.slice(0, 500), department_code: assignedDepartment, risk_level: assessedRisk }, correlationId);
      const row = result.data as { id?: string } | null;
      if (result.status === "success" && row?.id) assigned = { taskId: row.id };
    } catch (err) {
      log("ERROR", "cycle: assign failed", { error: err instanceof Error ? err.message : String(err) }, correlationId);
    }
  }

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

  for (const row of completedRows) {
    try {
      await founderMemory.learning.recordOutcome({ function_name: "founder-brain", action: "task_completed", success: true, value: 1 });
    } catch { /* non-blocking */ }
  }

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
