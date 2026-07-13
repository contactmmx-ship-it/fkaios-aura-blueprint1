// avatar-orchestrator v8 — LIVE WEB SEARCH + group project awareness
// v7: FIL identity + corrected DB map. v8: (a) Anthropic server-side
// web_search tool enabled — VERIFIED live on this account/model before
// deploying (returned real Tata Sierra EV launch with source); the avatar
// can now answer current events, prices, laws, movies, market info from the
// real web with citations. (b) Final answer now joins ALL text blocks
// (search-cited answers arrive as multiple text blocks). (c) query_data map
// extended with the new Tata-style group tables (client_projects,
// project_phases, project_team_assignments, company_leadership).

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
const AVATAR_VOICE_ID = Deno.env.get("AVATAR_VOICE_ID") ?? "21m00Tcm4TlvDq8ikWAM";
const BRAIN_MODEL = "claude-sonnet-5";

const COST_PER_1M: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5": { in: 3, out: 15 },
};
// LLM EXECUTION GRAPH (Master Realignment Phase 2): every call must record the
// model, WHY it was selected, prompt version, retries, owner department and the
// BUSINESS OBJECTIVE it spent money toward. This function is 100% of the
// enterprise's measured AI spend and recorded NONE of it — cost was logged, but
// nothing said what the money bought.
const AVATAR_MODEL_REASON =
  "Sonnet selected for the Founder avatar: open-ended reasoning + tool-use + live web_search over a multi-step agentic loop, where response quality directly shapes Founder decisions. Haiku degrades multi-step tool reasoning; an Opus-class model would multiply cost on a conversational surface that already consumes 100% of measured spend.";
const AVATAR_PROMPT_VERSION = "avatar-fil-v8";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function cid() { return crypto.randomUUID().slice(0, 8); }
function log(level: string, message: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...(data ? { data } : {}) }));
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
async function verifyJWT(authHeader: string): Promise<{ userId: string } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { userId: payload.sub as string };
  } catch { return null; }
}

// ---------- The brain's capabilities (tools) ----------
const TOOLS: Array<Record<string, unknown>> = [
  {
    name: "query_data",
    description: "Run a single read-only SELECT query on the FK AIOS Postgres database to answer any question about the business from REAL data. Results capped at 50 rows. VERIFIED key tables and columns: leads(id,brand_id,company_name,contact_name,contact_phone,city,state,stage,lead_score,investment_capacity,negotiation_status,deal_closure_date,source,next_followup,is_active,created_at) — note: lead status column is `stage`; brands(id,name,vertical,sector,type,investment_range,royalty,status,is_active); ai_agents(id,name,department,dept,status,is_active,autonomy_level,total_tasks_completed,success_rate,last_active_at); approvals(id,action_type,payload,risk_level,amount_inr,reason,status,created_at); ceo_daily_briefing(work_date,summary,top_performers,underperformers,blockers,company_kpi_snapshot); company_revenue_milestones(year,quarter,target_inr,actual_inr,status,owning_department,risk_notes); departments(code,name,mission,executive_agent,automation_level,is_active); companies(id,name); company_leadership(company_id,agent_id,role,mandate,active); client_projects(id,company_id,lead_id,client_name,title,scope,contract_value_inr,status,deadline,owning_department,md_review_notes) — status lifecycle: lead,proposal,negotiation,sow_signed,execution,qa,management_review,delivered,closed,lost; project_phases(project_id,phase_number,name,owner_agent,due_date,status,deliverable,result_summary); project_team_assignments(project_id,agent_name,project_role); agent_workday(agent_id,work_date,status,morning_plan,evening_summary,tasks_planned,tasks_completed); invoices(invoice_number,amount,currency,status,issue_date,due_date,lead_id); payments(invoice_id,lead_id,amount,status,payment_date,payment_gateway); meetings(lead_id,title,meeting_date,scheduled_at,status); avatar_conversations(session_id,transcript,response_text,created_at); travel_booking_requests; agent_task_delegations(from_agent,to_agent,task_description,status); fleet_memory(title,content,memory_type); connectors(name,status); founder_principles(principle,weight,active); agent_performance_metrics(agent_id,task_type,latency_ms,estimated_cost_usd,success). Use information_schema.columns to discover other columns when unsure.",
    input_schema: { type: "object", properties: { sql: { type: "string", description: "One SELECT statement, no semicolons" } }, required: ["sql"] },
  },
  {
    name: "save_memory",
    description: "Save a durable fact/preference/decision/insight to shared fleet memory so the whole AI workforce and future conversations remember it. Use whenever the founder tells you something worth remembering long-term.",
    input_schema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, memory_type: { type: "string", description: "one of: fact, preference, decision, insight, learning" } }, required: ["title", "content", "memory_type"] },
  },
  {
    name: "delegate_task",
    description: "Delegate a real tracked task to another AI engine in the fleet (e.g. sales-engine, finance-engine, builder-engine, research-engine, legal-engine, mis-engine, pr-engine, training-engine). Creates a pending delegation row the target picks up. Use for work that should continue outside this conversation.",
    input_schema: { type: "object", properties: { to_agent: { type: "string" }, task_description: { type: "string" }, requires_founder_approval: { type: "boolean" } }, required: ["to_agent", "task_description"] },
  },
  {
    name: "create_approval",
    description: "Create a pending approval item for the founder. MANDATORY before anything involving money movement, vendor commitments, payments, or sending documents — those may never proceed without an approved item here.",
    input_schema: { type: "object", properties: { action_type: { type: "string", description: "short snake_case label" }, reason: { type: "string" }, risk_level: { type: "string", description: "low | medium | high" }, amount_inr: { type: "number" }, payload: { type: "object" } }, required: ["action_type", "reason", "risk_level"] },
  },
  {
    name: "send_whatsapp",
    description: "Send a REAL WhatsApp message via the connected WhatsApp Business API. Only use when the founder has explicitly confirmed in this conversation that this exact message should go to this exact number. Never send payment details or documents without a prior approved approval item.",
    input_schema: { type: "object", properties: { to: { type: "string", description: "phone with country code, digits only" }, message: { type: "string" } }, required: ["to", "message"] },
  },
  // Server-side tool: Anthropic executes web searches within the same request.
  { type: "web_search_20250305", name: "web_search", max_uses: 3 },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    if (name === "query_data") {
      const { data, error } = await supabase.rpc("avatar_readonly_query", { q: String(input.sql ?? "") });
      if (error) return `Query error: ${error.message}`;
      return JSON.stringify(data).slice(0, 6000);
    }
    if (name === "save_memory") {
      const { error } = await supabase.from("fleet_memory").insert({
        source_department: "founder-avatar",
        memory_type: String(input.memory_type ?? "fact"),
        title: String(input.title ?? ""),
        content: String(input.content ?? ""),
        confidence: 0.95,
      });
      return error ? `Failed to save memory: ${error.message}` : "Memory saved to fleet_memory.";
    }
    if (name === "delegate_task") {
      const { data, error } = await supabase.from("agent_task_delegations").insert({
        from_agent: "founder-avatar",
        to_agent: String(input.to_agent ?? ""),
        task_description: String(input.task_description ?? ""),
        requires_founder_approval: Boolean(input.requires_founder_approval ?? false),
      }).select("id").single();
      return error ? `Failed to delegate: ${error.message}` : `Delegation created (id ${data.id}).`;
    }
    if (name === "create_approval") {
      const { data, error } = await supabase.from("approvals").insert({
        action_type: String(input.action_type ?? "avatar_request"),
        payload: (input.payload as Record<string, unknown>) ?? { source: "founder-avatar" },
        risk_level: String(input.risk_level ?? "medium"),
        amount_inr: typeof input.amount_inr === "number" ? input.amount_inr : null,
        reason: String(input.reason ?? ""),
        status: "pending",
        department_code: "FOUNDER",
      }).select("id").single();
      return error ? `Failed to create approval: ${error.message}` : `Approval item created (id ${data.id}), status pending.`;
    }
    if (name === "send_whatsapp") {
      const resp = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${supabaseServiceRoleKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: String(input.to ?? ""), message: String(input.message ?? "") }),
      });
      const text = await resp.text();
      return `whatsapp-send responded ${resp.status}: ${text.slice(0, 800)}`;
    }
    return `Unknown tool: ${name}`;
  } catch (err) {
    return `Tool ${name} threw: ${String(err)}`;
  }
}

// ---------- Context builders ----------
async function getFounderIdentity(): Promise<string> {
  const { data } = await supabase.from("founder_identity").select("content, version").eq("active", true).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!data) return "";
  return `\n\n=== FOUNDER INTELLIGENCE LAYER v${data.version} (your foundation identity) ===\n${data.content}\n=== END FIL ===`;
}
async function getFounderPrinciplesBlock(): Promise<string> {
  const { data } = await supabase.from("founder_principles").select("principle, weight").eq("active", true).order("weight", { ascending: false });
  if (!data || data.length === 0) return "";
  return `\n\n=== FOUNDER OPERATING PRINCIPLES (non-negotiable) ===\n${data.map((p: any) => `- ${p.principle}`).join("\n")}\n=== END ===`;
}
async function getFleetMemoryContext(): Promise<string> {
  const { data } = await supabase.from("fleet_memory").select("title, content, memory_type").order("created_at", { ascending: false }).limit(10);
  if (!data || data.length === 0) return "";
  return `\n\n=== FLEET MEMORY (recent shared learnings) ===\n${data.map((m: any) => `- [${m.memory_type}] ${m.title}: ${m.content}`).join("\n")}\n=== END ===`;
}
async function getConversationHistory(sessionId: string): Promise<Array<{ role: string; content: string }>> {
  const { data } = await supabase
    .from("avatar_conversations")
    .select("transcript, response_text")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(8);
  if (!data) return [];
  const history: Array<{ role: string; content: string }> = [];
  for (const turn of data.reverse()) {
    if (turn.transcript) history.push({ role: "user", content: turn.transcript });
    if (turn.response_text) history.push({ role: "assistant", content: turn.response_text });
  }
  return history;
}

// ---------- The agentic loop ----------
interface BrainResult { text: string; toolsUsed: string[]; inputTokens: number; outputTokens: number; steps: number; }

async function runBrain(systemPrompt: string, history: Array<{ role: string; content: string }>, transcript: string): Promise<BrainResult> {
  const messages: Array<Record<string, unknown>> = [...history, { role: "user", content: transcript }];
  const toolsUsed: string[] = [];
  let inputTokens = 0, outputTokens = 0;

  for (let step = 0; step < 6; step++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: BRAIN_MODEL, max_tokens: 2500, system: systemPrompt, tools: TOOLS, messages }),
    });
    if (!response.ok) throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
    const data = await response.json();
    inputTokens += data?.usage?.input_tokens ?? 0;
    outputTokens += data?.usage?.output_tokens ?? 0;
    messages.push({ role: "assistant", content: data.content });

    // Track server-side web searches Anthropic ran within this response
    if (Array.isArray(data?.content)) {
      for (const b of data.content) {
        if (b?.type === "server_tool_use") toolsUsed.push(String(b.name ?? "web_search"));
      }
    }

    if (data.stop_reason === "tool_use") {
      const results: Array<Record<string, unknown>> = [];
      for (const block of data.content) {
        if (block.type === "tool_use") {
          toolsUsed.push(block.name);
          log("INFO", "Brain using tool", { tool: block.name });
          const out = await executeTool(block.name, block.input ?? {});
          results.push({ type: "tool_result", tool_use_id: block.id, content: out });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    // Search-cited answers arrive as MULTIPLE text blocks — join them all.
    const text = Array.isArray(data?.content)
      ? data.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
      : "";
    return { text, toolsUsed, inputTokens, outputTokens, steps: step + 1 };
  }
  return { text: "Maine 6 internal steps use kar liye is task pe aur abhi bhi complete nahi hua — honestly bata raha hoon bajaye adha-adhura result dene ke. Thoda break down karke do, ya bolo continue karun.", toolsUsed, inputTokens, outputTokens, steps: 6 };
}

async function synthesizeSpeech(text: string): Promise<string | null> {
  if (!ELEVENLABS_API_KEY) return null;
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${AVATAR_VOICE_ID}`, {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    if (!response.ok) { log("ERROR", "ElevenLabs TTS failed", { status: response.status, body: await response.text() }); return null; }
    const buf = await response.arrayBuffer();
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  } catch (err) { log("ERROR", "ElevenLabs TTS threw", { error: String(err) }); return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const correlationId = req.headers.get("X-Correlation-ID") || cid();
  const startedAt = Date.now();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const user = await verifyJWT(req.headers.get("Authorization") || "");
  if (!user) return jsonResponse({ error: "Unauthorized: this is the founder's voice avatar, JWT required" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }

  const transcript = String(body.transcript ?? "").trim();
  const sessionId = String(body.session_id ?? crypto.randomUUID());
  const turnNumber = Number(body.turn_number ?? 1);
  const inputMode = String(body.input_mode ?? "voice");
  const wantsAudio = body.wants_audio !== false;
  if (!transcript) return jsonResponse({ error: "Missing 'transcript'" }, 400);

  try {
    const [fil, principles, fleetContext, history] = await Promise.all([
      getFounderIdentity(),
      getFounderPrinciplesBlock(),
      getFleetMemoryContext(),
      getConversationHistory(sessionId),
    ]);

    const systemPrompt = `You are Rajeev's personal AI avatar inside FK AIOS — his second brain, running his zero-human-employee AI company group (Bhavishya Associates as holding; Franchise Kart, Aura Tech, Rajyog Infra as group companies — Tata-style structure where Rajeev is MD/Chairman: observing, reviewing, approving, intervening — not executing). You are ONE reasoning brain with capabilities (tools), not a menu of features. Like a human: understand what he actually means — mood, seriousness, joke vs command, context — then decide the path yourself and use your capabilities to get it done.${fil}

How you operate in conversation:
- Speak naturally in Hinglish when it fits his phrasing, otherwise plain English. Keep spoken answers tight (2-4 sentences) unless he clearly wants depth — the FIL's structured report format is for when he asks for a strategic analysis, not for casual talk.
- You HAVE live web_search — use it freely for current events, latest cars/movies/laws/news, market prices, competitor moves, anything time-sensitive. Mention your source. Combine it with query_data when a question spans the world AND the business.
- For business questions, USE query_data to answer from real data instead of guessing. Client project delivery runs the lifecycle in client_projects (lead→proposal→sow_signed→execution→qa→management_review→delivered) with project_phases and project_team_assignments — management_review is the MD's gate.
- Take real action when he asks: query data, save memories, delegate work to fleet engines, stage approvals, send WhatsApp (only with his explicit in-conversation confirmation).
- ABSOLUTE RULE — no fake data, ever. If a capability is genuinely missing, say so plainly and offer the nearest real path. Never invent numbers, names, or results.
- Money, payments, vendor commitments, documents: create_approval first, and a second explicit founder confirmation before anything is sent. Finance and legal execution always stays with the founder.
- If a tool errors, tell him honestly what failed — never paper over it.${principles}${fleetContext}`;

    const brain = await runBrain(systemPrompt, history, transcript);
    const responseText = brain.text;
    const audioB64 = wantsAudio ? await synthesizeSpeech(responseText) : null;
    const latencyMs = Date.now() - startedAt;

    await supabase.from("avatar_conversations").insert({
      session_id: sessionId, turn_number: turnNumber, input_mode: inputMode, transcript,
      intent: "agentic", routed_to: brain.toolsUsed.join(",") || "reasoning_only",
      action_taken: { tools_used: brain.toolsUsed },
      response_text: responseText, audio_generated: !!audioB64, latency_ms: latencyMs,
    });

    await supabase.from("audit_logs").insert({
      user_id: user.userId, action: `avatar:agentic:${brain.toolsUsed.join("+") || "chat"}`,
      resource_type: "avatar_conversation", actor_type: "founder",
      decision_reasoning: `Agentic brain turn with FIL; tools used: ${brain.toolsUsed.join(", ") || "none"}`,
      requires_human_review: false,
      metadata: { session_id: sessionId, turn_number: turnNumber, transcript_length: transcript.length },
    });

    const costRate = COST_PER_1M[BRAIN_MODEL];
    await supabase.from("agent_performance_metrics").insert({
      agent_id: "founder-avatar", task_type: "agentic_turn", latency_ms: latencyMs,
      estimated_cost_usd: (brain.inputTokens / 1_000_000) * costRate.in + (brain.outputTokens / 1_000_000) * costRate.out,
      input_tokens: brain.inputTokens || null, output_tokens: brain.outputTokens || null, success: true,
      model: BRAIN_MODEL, provider: "anthropic", selection_reason: AVATAR_MODEL_REASON,
      prompt_version: AVATAR_PROMPT_VERSION, retries: Math.max(0, brain.steps - 1),
      department: "FOUNDER",
      business_objective: "Founder supervision & decision support (NOT a revenue-producing path — this surface is 100% of measured AI spend and has produced Rs 0)",
    });

    return jsonResponse({
      success: true, session_id: sessionId, turn_number: turnNumber,
      intent: "agentic", routed_to: brain.toolsUsed.join(",") || "reasoning_only",
      response_text: responseText, audio_base64: audioB64, latency_ms: latencyMs, correlationId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    log("ERROR", "avatar-orchestrator failed", { correlationId, error: message });
    await supabase.from("agent_performance_metrics").insert({
      agent_id: "founder-avatar", task_type: "agentic_turn", latency_ms: Date.now() - startedAt,
      success: false, error_message: message,
      model: BRAIN_MODEL, provider: "anthropic", prompt_version: AVATAR_PROMPT_VERSION,
      department: "FOUNDER", business_objective: "Founder supervision & decision support",
    });
    return jsonResponse({ error: message, correlationId }, 500);
  }
});
