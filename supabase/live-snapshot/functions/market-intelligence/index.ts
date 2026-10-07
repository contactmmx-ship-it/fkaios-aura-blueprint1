// market-intelligence v2 — the enterprise's external sensory organ.
// research-engine (Chief Research Officer) observes markets/competitors via
// Anthropic server-side web_search (the SAME proven mechanism the founder-
// avatar uses), extracts structured signals, persists them to dedicated
// tables AND into the Enterprise Knowledge Network (fleet_memory) so the
// Executive Intelligence Layer sees external reality every cycle.
// v2 (P1.5 security parity): the hardcoded fallback secret is GONE. Auth
// reads MARKET_INTEL_SECRET, falling back to the fleet HEARTBEAT_SECRET so
// the Founder's one-step rotation covers this function too. If neither is
// configured the function FAILS CLOSED (503) — it never runs open.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
// P1.5: no hardcoded fallback. Dedicated secret first, fleet secret second, fail closed third.
const MARKET_SECRET = Deno.env.get("MARKET_INTEL_SECRET") ?? Deno.env.get("HEARTBEAT_SECRET") ?? "";
const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const CAPTURE_TOOL = {
  name: "emit_intelligence",
  description: "Emit the structured market and competitor intelligence gathered. ONLY way to output.",
  input_schema: {
    type: "object",
    properties: {
      market_signals: { type: "array", maxItems: 5, items: { type: "object", properties: {
        signal_type: { type: "string", enum: ["industry_trend","opportunity","regulation","technology","economic","demographic","business_model"] },
        industry: { type: "string" }, headline: { type: "string" }, detail: { type: "string" },
        source_url: { type: "string" }, confidence: { type: "number" }, relevance_to_founder_vision: { type: "string" },
      }, required: ["signal_type","headline","confidence"] } },
      competitor_signals: { type: "array", maxItems: 5, items: { type: "object", properties: {
        competitor_name: { type: "string" }, category: { type: "string" }, observation: { type: "string" },
        implication_for_us: { type: "string" }, source_url: { type: "string" }, confidence: { type: "number" },
      }, required: ["competitor_name","observation","confidence"] } },
      research_summary: { type: "string" },
    },
    required: ["research_summary"],
  },
};

Deno.serve(async (req: Request) => {
  const started = Date.now();
  const url = new URL(req.url);
  if (!MARKET_SECRET) return j({ error: "server not configured: MARKET_INTEL_SECRET / HEARTBEAT_SECRET unset — failing closed" }, 503);
  if (url.searchParams.get("secret") !== MARKET_SECRET) return j({ error: "unauthorized" }, 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* default focus */ }
  const focus = String(body.focus ?? "franchise distribution, franchise software, and AI business automation in India; key competitors and market opportunities relevant to a franchise+SaaS holding company");

  try {
    const system = `You are research-engine, the Chief Research Officer of the Bhavishya Associates Artificial Enterprise (franchise distribution via Franchise Kart, apps/SaaS via Aura Tech, real estate via Rajyog Infra; group target 1100 Cr by 2030). Use web search to gather CURRENT, REAL market and competitor intelligence on the requested focus. Extract only decision-relevant, sourced signals — industry trends, opportunities, regulations, technology shifts, and specific competitor moves — each with a real source URL and an honest confidence score. Never fabricate. If search returns nothing useful, say so in research_summary and emit empty arrays. Assess each signal's relevance to the founder's vision of a multi-industry holding company. Output ONLY via emit_intelligence.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 4500,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }, CAPTURE_TOOL],
        tool_choice: { type: "auto" }, system,
        messages: [{ role: "user", content: `Research this now and capture structured intelligence: ${focus}. Search the web for current information, then emit your findings via emit_intelligence.` }] }),
    });
    if (!resp.ok) return j({ error: `Research LLM failed: ${resp.status} ${await resp.text()}` }, 502);
    const data = await resp.json();
    const tb = Array.isArray(data?.content) ? data.content.find((b: any) => b?.type === "tool_use" && b?.name === "emit_intelligence") : null;
    if (!tb?.input) return j({ error: "No intelligence emitted", stop_reason: data?.stop_reason }, 502);
    const intel: any = tb.input;

    const market = Array.isArray(intel.market_signals) ? intel.market_signals.slice(0, 5) : [];
    const competitors = Array.isArray(intel.competitor_signals) ? intel.competitor_signals.slice(0, 5) : [];

    for (const m of market) {
      await supabase.from("market_intelligence").insert({
        signal_type: m.signal_type ?? "industry_trend", industry: m.industry ?? null,
        headline: String(m.headline ?? "").slice(0, 400), detail: String(m.detail ?? "").slice(0, 2000),
        source_url: m.source_url ?? null, confidence: Number(m.confidence ?? 0.6),
        relevance_to_founder_vision: String(m.relevance_to_founder_vision ?? "").slice(0, 1000),
      });
      // flow into Enterprise Knowledge Network
      await supabase.rpc("record_enterprise_memory", { p_source_department: "research", p_memory_type: "market_signal",
        p_title: String(m.headline ?? "").slice(0, 200), p_content: `${m.detail ?? ""} [source: ${m.source_url ?? "n/a"}]`.slice(0, 2000),
        p_structured: { signal_type: m.signal_type, industry: m.industry }, p_confidence: Number(m.confidence ?? 0.6), p_visible_departments: ["*"] });
    }
    for (const c of competitors) {
      await supabase.from("competitor_intelligence").insert({
        competitor_name: String(c.competitor_name ?? "").slice(0, 200), category: c.category ?? null,
        observation: String(c.observation ?? "").slice(0, 2000), implication_for_us: String(c.implication_for_us ?? "").slice(0, 1000),
        source_url: c.source_url ?? null, confidence: Number(c.confidence ?? 0.6),
      });
      await supabase.rpc("record_enterprise_memory", { p_source_department: "research", p_memory_type: "competitor_signal",
        p_title: `${c.competitor_name}: ${String(c.observation ?? "").slice(0, 150)}`, p_content: `${c.observation ?? ""} Implication: ${c.implication_for_us ?? ""} [source: ${c.source_url ?? "n/a"}]`.slice(0, 2000),
        p_structured: { competitor: c.competitor_name }, p_confidence: Number(c.confidence ?? 0.6), p_visible_departments: ["*"] });
    }

    await supabase.from("audit_logs").insert({ action: "research:market_intelligence", resource_type: "market_intelligence", actor_type: "agent",
      decision_reasoning: `research-engine captured ${market.length} market + ${competitors.length} competitor signals. ${String(intel.research_summary ?? "").slice(0, 300)}`,
      requires_human_review: false, metadata: { market: market.length, competitors: competitors.length } });
    await supabase.from("agent_performance_metrics").insert({ agent_id: "research-engine", task_type: "market_intelligence", latency_ms: Date.now() - started,
      input_tokens: data?.usage?.input_tokens ?? null, output_tokens: data?.usage?.output_tokens ?? null, success: true });

    return j({ success: true, market_signals: market.length, competitor_signals: competitors.length, research_summary: intel.research_summary });
  } catch (err) {
    await supabase.from("agent_performance_metrics").insert({ agent_id: "research-engine", task_type: "market_intelligence", latency_ms: Date.now() - started, success: false, error_message: String(err) });
    return j({ error: String(err) }, 500);
  }
});
