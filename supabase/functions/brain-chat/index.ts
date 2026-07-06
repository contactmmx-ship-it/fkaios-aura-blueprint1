// BRAIN-CHAT v47 — rebuilt on Phase 1 architecture.
// Real Claude (claude-sonnet-4-6), real vector RAG via match_knowledge_chunks, full execution_log observability.
// REMOVED: Groq/llama fallback-as-primary, keyword ILIKE "RAG", the "seed arofur" fake-data backdoor, "diag" backdoor.
import { createClient } from "npm:@supabase/supabase-js@2";

// ── __LLM_FALLBACK__ v1 (injected) ─────────────────────────────────────────
// Drop-in replacement for the raw Anthropic fetch: primary claude-sonnet-4-6,
// fallback gemini-2.5-flash via GEMINI_API_KEY on ANY Anthropic failure
// (credit exhaustion 400, 401, 429, 529, network). On fallback it returns an
// ANTHROPIC-SHAPED response body ({content:[{text}], usage:{...}, model}) so
// every existing parse site downstream works unchanged. model field carries
// the model that actually served.
async function llmFetch(apiKey: string, payload: Record<string, unknown>): Promise<Response> {
  let errMsg = '';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return res;
    errMsg = `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`;
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }
  const gKey = Deno.env.get('GEMINI_API_KEY');
  if (!gKey) return new Response(JSON.stringify({ error: errMsg }), { status: 502, headers: { 'content-type': 'application/json' } });
  console.log('LLM FALLBACK to gemini-2.5-flash \u2014', errMsg.slice(0, 150));
  const sys = typeof payload.system === 'string' ? payload.system : '';
  const msgs = Array.isArray(payload.messages) ? payload.messages : [];
  const contents = msgs.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] }));
  const gRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'x-goog-api-key': gKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
      contents,
      generationConfig: { maxOutputTokens: Number(payload.max_tokens ?? 1024) + 256, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!gRes.ok) return new Response(JSON.stringify({ error: `${errMsg} | Gemini ${gRes.status}: ${(await gRes.text()).slice(0, 200)}` }), { status: 502, headers: { 'content-type': 'application/json' } });
  const g = await gRes.json() as any;
  const text = (g.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  const shaped = { model: 'gemini-2.5-flash', content: [{ type: 'text', text }], usage: { input_tokens: g.usageMetadata?.promptTokenCount ?? 0, output_tokens: g.usageMetadata?.candidatesTokenCount ?? 0 } };
  return new Response(JSON.stringify(shaped), { status: 200, headers: { 'content-type': 'application/json' } });
}
// ── end __LLM_FALLBACK__ ───────────────────────────────────────────────────


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID",
};

const MODEL = "claude-sonnet-4-6";
const INR_PER_INPUT_MTOK = 270;
const INR_PER_OUTPUT_MTOK = 1350;

const session = new Supabase.ai.Session("gte-small");
async function embed(text: string): Promise<string> {
  const out = await session.run(text, { mean_pool: true, normalize: true });
  return JSON.stringify(Array.from(out as Float32Array | number[]));
}

async function claude(apiKey: string, system: string, messages: { role: string; content: string }[], maxTokens = 1024) {
  const res = await llmFetch(apiKey, { model: MODEL, max_tokens: maxTokens, system, messages });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`); }
  const data = await res.json() as any;
  return { text: data.content?.[0]?.text ?? "", inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const t0 = Date.now();
  let supabase: any;

  try {
    const { message, conversationId, userId } = await req.json();
    if (!message || !conversationId) {
      return new Response(JSON.stringify({ error: "Missing message or conversationId" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    supabase = createClient(supabaseUrl, serviceKey);

    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // === REAL SEMANTIC RETRIEVAL (Prompt 7 RAG) ===
    let ragMatches: any[] = [];
    try {
      const queryEmbedding = await embed(message);
      const { data: matches } = await supabase.rpc("match_knowledge_chunks", {
        query_embedding: queryEmbedding,
        match_count: 5,
        filter_brand_id: null,
      });
      ragMatches = (matches ?? []).filter((m: any) => m.similarity > 0.3);
    } catch (ragErr) {
      console.log("RAG retrieval failed (non-fatal):", ragErr);
    }

    const knowledgeContext = ragMatches.length > 0
      ? "\n\nRELEVANT CONTEXT FROM THE KNOWLEDGE VAULT (verified organizational knowledge — ground your answer in this, cite it, never contradict it):\n" +
        ragMatches.map((m: any, i: number) => `[${i + 1}] (similarity ${m.similarity.toFixed(2)}) ${m.chunk_text}`).join("\n\n")
      : "\n\nNo relevant knowledge vault entries were found for this query. Say so honestly if the question needed vault data; do not fabricate specifics (numbers, dates, brand facts) that aren't given here.";

    const { data: history } = await supabase.from("brain_messages").select("content, role, created_at").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(10);
    const contextMessages = (history || []).reverse().map((m: any) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));

    const systemPrompt = `You are the AI Brain of FKAIOS — Franchise Kart's AI Company Operating System. You serve Rajeev, Chairman and Founder.

CRITICAL RULES:
- Never invent statistics, figures, brand facts, or business data not present in the vault context below or the conversation history.
- If the vault has no relevant data, say so plainly and answer from general knowledge only, clearly distinguishing the two.
- Cite vault sources by their bracket number [1], [2] etc. when you use them.
- You know the org runs on autonomy levels 0-5. Accounts and Marketing agents are locked at Level 4 (prepare + human approval only — never execute money movement or ad spend directly).
- Be concise and direct.
${knowledgeContext}`;

    const t1 = Date.now();
    const result = await claude(anthropicKey, systemPrompt, [...contextMessages, { role: "user", content: message }], 1024);
    const latencyMs = Date.now() - t1;

    try {
      await supabase.from("brain_messages").insert({ conversation_id: conversationId, role: "user", content: message });
      await supabase.from("brain_messages").insert({ conversation_id: conversationId, role: "assistant", content: result.text });
      await supabase.from("brain_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
    } catch (e) { console.error("Save failed:", e); }

    try {
      await supabase.from("execution_log").insert({
        function_name: "brain-chat", department_code: "EXECUTIVE", action: "chat_response", status: "success",
        input_summary: message.slice(0, 300), output_summary: result.text.slice(0, 300),
        model: MODEL, input_tokens: result.inputTokens, output_tokens: result.outputTokens,
        cost_estimate_inr: (result.inputTokens / 1_000_000) * INR_PER_INPUT_MTOK + (result.outputTokens / 1_000_000) * INR_PER_OUTPUT_MTOK,
        latency_ms: latencyMs,
      });
    } catch (_) {}

    return new Response(JSON.stringify({ content: result.text, vault_sources: ragMatches.length }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("brain-chat error:", msg);
    try {
      if (supabase) await supabase.from("execution_log").insert({ function_name: "brain-chat", action: "chat_response", status: "failure", error: msg.slice(0, 500), latency_ms: Date.now() - t0 });
    } catch (_) {}
    return new Response(JSON.stringify({ error: "Internal server error: " + msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
