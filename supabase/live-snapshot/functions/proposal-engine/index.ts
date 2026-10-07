// ============================================================================
// proposal-engine v1 — THE FUNNEL'S LAST MILE (Delivery + Finance).
//
// THE GAP THIS CLOSES: when a lead finally scores >= 40 it advances to
// 'contacted' — and then NOTHING. There was no path from a qualified lead to a
// proposal, a project, or an invoice. Revenue Desk required the Founder to type
// everything by hand. The funnel had a mouth and a cash register, and nothing
// connecting them.
//
// NOW: qualified lead -> drafted proposal (scope, deliverables, assumptions)
//      -> client_projects row (status 'proposal') -> Founder pricing gate.
//
// THE HARD RULE — PRICING IS A FOUNDER APPROVAL GATE:
// This engine is FORBIDDEN from inventing a price. contract_value_inr is written
// as NULL and the proposal states the price as UNKNOWN — PENDING FOUNDER. A model
// that guesses "Rs 4,50,000" would be fabricating a commercial commitment, which
// is precisely what the Truth Policy forbids. Unknown stays UNKNOWN until a human
// sets it. Nothing is sent to any customer. Ever. By this function.
//
// It also refuses to invent scope: every deliverable must trace to something the
// lead actually said or a brand fact actually on record.
//
// IMPORTED INTO THE REPO (production-fix pass, 2026-09-21): this function was
// deployed directly (version 10) without ever being committed here — closing
// that drift so the deployed source and this repo agree. In the same pass, an
// optional `lead_id` request body field was added (see the leads query below)
// so ai-engine's GENERATE_PROPOSAL job handler can target one specific,
// already-qualified lead instead of only ever processing whichever leads this
// function's own hourly cron batch happens to pick up. Everything else is
// unchanged from the deployed version.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const MODEL = "claude-sonnet-4-6";
const RATES: Record<string, { in: number; out: number }> = { "claude-sonnet-4-6": { in: 3, out: 15 } };
const MODEL_REASON =
  "Sonnet selected for proposal drafting: it must hold a real lead record and real brand terms in context and produce scope/deliverables WITHOUT inventing facts or prices. Haiku hallucinates commercial detail under this pressure; Opus cost is unjustified for a draft the Founder must price and approve anyway.";

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SECRET = Deno.env.get("HEARTBEAT_SECRET") ?? "";
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const EMIT = {
  name: "emit_proposal",
  description: "Emit the drafted proposal. The ONLY way to output.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      scope: { type: "string", description: "What we will actually do for this specific enquirer. Ground every line in what the lead said or a brand fact on record." },
      deliverables: { type: "array", items: { type: "string" }, maxItems: 8 },
      assumptions: { type: "array", items: { type: "string" }, maxItems: 6, description: "Everything you do NOT know and are assuming. Be exhaustive and honest. This list protects the Founder." },
      unknowns: { type: "array", items: { type: "string" }, maxItems: 6, description: "Facts required to price or deliver this that are NOT in the record. Mark them clearly. Do NOT guess them." },
      suggested_timeline_days: { type: "integer" },
      owning_department: { type: "string" },
      why_this_lead_is_real: { type: "string", description: "Cite the actual evidence from the lead record: phone, city, stated investment capacity, BANT score." },
    },
    required: ["title", "scope", "deliverables", "assumptions", "unknowns", "why_this_lead_is_real"],
  },
};

Deno.serve(async (req) => {
  const started = Date.now();
  const provided = new URL(req.url).searchParams.get("secret") ?? req.headers.get("x-heartbeat-secret");
  if (!SECRET) return j({ error: "HEARTBEAT_SECRET unset — failing closed" }, 503);
  if (provided !== SECRET) return j({ error: "unauthorized" }, 401);

  // Optional single-lead targeting (production-fix pass addition): a caller
  // (ai-engine, handling one specific GENERATE_PROPOSAL ai_job) can ask for
  // exactly one lead by id instead of this function's own batch-of-3 scan.
  // Same qualification bar applies either way — lead_score >= 40 — this
  // never bypasses it, it only narrows WHICH qualifying lead(s) to consider.
  let requestedLeadId: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json().catch(() => null);
      if (body && typeof body === "object" && typeof (body as Record<string, unknown>).lead_id === "string") {
        requestedLeadId = (body as Record<string, unknown>).lead_id as string;
      }
    } catch { /* no body, or not JSON — fall through to the batch path */ }
  }

  try {
    // Qualified leads with no project yet. Bar of 40 = the qualifier's own bar.
    let leadsQuery = db
      .from("leads")
      .select("id, company_name, contact_name, contact_phone, contact_email, city, state, investment_capacity, lead_score, stage, notes, source, brand_id")
      .gte("lead_score", 40)
      .eq("is_active", true);
    leadsQuery = requestedLeadId ? leadsQuery.eq("id", requestedLeadId).limit(1) : leadsQuery.limit(3);
    const { data: leads, error: leadErr } = await leadsQuery;

    if (leadErr) return j({ error: "lead select failed: " + leadErr.message }, 500);
    if (!leads || leads.length === 0) {
      // HONEST EMPTY. Not a silent success.
      return j({
        success: true, drafted: 0,
        message: requestedLeadId
          ? `Lead ${requestedLeadId} was not found, is inactive, or scores below 40 — not eligible for a proposal.`
          : "No lead has scored >= 40. There is nothing to propose. This is a REAL check, not a skipped one — the funnel is empty because no qualifying enquiry has arrived yet.",
      });
    }

    let drafted = 0, skipped = 0, spend = 0;
    for (const lead of leads) {
      const { data: exists } = await db.from("client_projects").select("id").eq("lead_id", lead.id).maybeSingle();
      if (exists) { skipped++; continue; }

      let brand: any = null;
      if (lead.brand_id) {
        const { data: b } = await db.from("brands").select("name, sector, investment_range, royalty, type").eq("id", lead.brand_id).maybeSingle();
        brand = b;
      }

      const system = [
        "You are the Chief Delivery Officer of Franchise Kart / Aura Tech, drafting a proposal for a REAL enquirer who came to us inbound.",
        "",
        "THE LEAD (this is the complete record — you know NOTHING else about this person):",
        JSON.stringify(lead),
        "",
        "THE BRAND THEY ENQUIRED ABOUT (real commercial terms on record):",
        brand ? JSON.stringify(brand) : "(no brand linked to this enquiry)",
        "",
        "ABSOLUTE RULES — breaking any of these makes the proposal dangerous, not merely wrong:",
        "1. DO NOT INVENT A PRICE. Pricing is the Founder's decision and yours to inform, not make. Never state a fee, a rupee figure, or a payment schedule anywhere.",
        "2. DO NOT INVENT FACTS about this person. If the record does not say they have a location, staff, experience or funding in hand, you do not know it. Put it in 'assumptions' or 'unknowns'.",
        "3. DO NOT INVENT MARKET DATA, ROI figures, payback periods, or revenue projections. Not one number that is not in the record above.",
        "4. 'unknowns' must list everything genuinely needed to price or deliver this that is NOT in the record. An honest, uncomfortable unknowns list is the most valuable part of this document.",
        "5. Scope must be what WE will actually do, grounded in the brand's real terms and what this person actually told us.",
        "",
        "Emit via emit_proposal. Nothing else.",
      ].join("\n");

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 2500, system,
          tools: [EMIT], tool_choice: { type: "tool", name: "emit_proposal" },
          messages: [{ role: "user", content: "Draft the proposal for this enquirer now. Price is NOT yours to set — leave it out entirely and list what you would need to know in order to price it." }],
        }),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const tb = (data?.content ?? []).find((b: any) => b?.type === "tool_use" && b?.name === "emit_proposal");
      if (!tb?.input) continue;
      const p: any = tb.input;

      const inTok = Number(data?.usage?.input_tokens ?? 0);
      const outTok = Number(data?.usage?.output_tokens ?? 0);
      spend += (inTok / 1e6) * RATES[MODEL].in + (outTok / 1e6) * RATES[MODEL].out;

      const scopeDoc = [
        p.scope,
        "",
        "DELIVERABLES:",
        ...(p.deliverables ?? []).map((d: string) => "- " + d),
        "",
        "ASSUMPTIONS (not verified — confirm before committing):",
        ...(p.assumptions ?? []).map((a: string) => "- " + a),
        "",
        "UNKNOWN — REQUIRED BEFORE THIS CAN BE PRICED OR PROMISED:",
        ...(p.unknowns ?? []).map((u: string) => "- " + u),
        "",
        "PRICE: UNKNOWN — PENDING FOUNDER. This engine is forbidden from setting a price; a guessed fee would be a fabricated commercial commitment.",
        "",
        "WHY THIS LEAD IS REAL: " + (p.why_this_lead_is_real ?? ""),
      ].join("\n");

      const { data: proj, error: projErr } = await db.from("client_projects").insert({
        lead_id: lead.id,
        client_name: lead.contact_name ?? lead.company_name ?? "Unnamed enquirer",
        title: String(p.title ?? "Franchise proposal").slice(0, 200),
        scope: scopeDoc.slice(0, 4000),
        contract_value_inr: null,           // UNKNOWN. Founder sets it. Never guessed.
        status: "proposal",
        owning_department: p.owning_department ?? "SALES",
        md_review_notes: "AWAITING FOUNDER: price is UNKNOWN and must be set by the Founder. Nothing has been sent to this person.",
      }).select("id").single();
      if (projErr || !proj) continue;

      await db.from("approvals").insert({
        action_type: "price_and_send_proposal",
        payload: {
          project_id: proj.id, lead_id: lead.id,
          client: lead.contact_name, phone: lead.contact_phone, city: lead.city,
          stated_investment_capacity: lead.investment_capacity, bant_score: lead.lead_score,
          brand: brand?.name ?? null,
          price_inr: "UNKNOWN — FOUNDER MUST SET",
          unknowns: p.unknowns ?? [],
        },
        risk_level: "high",
        amount_inr: null,
        reason: "PRICING + CUSTOMER COMMUNICATION GATE — " + (lead.contact_name ?? "enquirer") + " (" + (lead.city ?? "?") + ", BANT " + lead.lead_score + ", stated capacity " + (lead.investment_capacity ?? "UNKNOWN") + "). A proposal has been DRAFTED, not sent. The price is UNKNOWN and only you may set it. Review the unknowns list before committing to anything.",
        status: "pending", department_code: "SALES",
      });

      drafted++;
    }

    await db.from("agent_performance_metrics").insert({
      agent_id: "proposal-engine", task_type: "draft_proposal", latency_ms: Date.now() - started,
      estimated_cost_usd: spend, success: true, model: MODEL, provider: "anthropic",
      selection_reason: MODEL_REASON, prompt_version: "proposal-engine-v1", retries: 0,
      department: "DELIVERY",
      business_objective: "Rs 5 Cr gate: convert a qualified inbound lead into a priceable proposal (funnel last mile)",
    });

    await db.from("execution_log").insert({
      function_name: "proposal-engine", department_code: "DELIVERY", action: "draft_proposals",
      output_summary: drafted + " proposal(s) drafted, " + skipped + " skipped (project already exists). PRICE LEFT UNKNOWN on every one — the Founder sets it. Nothing sent to any customer.",
      status: "completed",
    });

    return j({ success: true, drafted, skipped, model: MODEL, spend_usd: Number(spend.toFixed(6)), price_policy: "UNKNOWN — Founder gate. Never guessed." });
  } catch (e) {
    await db.from("agent_performance_metrics").insert({
      agent_id: "proposal-engine", task_type: "draft_proposal", latency_ms: Date.now() - started,
      success: false, error_message: String(e), model: MODEL, provider: "anthropic", department: "DELIVERY",
    });
    return j({ error: String(e) }, 500);
  }
});
