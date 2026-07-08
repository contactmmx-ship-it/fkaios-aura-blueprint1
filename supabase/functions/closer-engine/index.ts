import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  correlationId as generateCorrelationId,
  structuredLog,
  errorResponse,
  successResponse,
  verifyEnvSecrets,
  verifyJWT,
} from "../_shared/utils.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-ID" };

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function getFounderPrinciplesBlock(agentName: string): Promise<string> {
  try {
    const { data, error } = await supabase.from("founder_principles").select("principle, weight, applies_to").eq("active", true).order("weight", { ascending: false });
    if (error || !data) return "";
    const relevant = data.filter((p: any) => Array.isArray(p.applies_to) && (p.applies_to.includes("*") || p.applies_to.includes(agentName)));
    if (relevant.length === 0) return "";
    return `\n\n=== FOUNDER OPERATING PRINCIPLES (non-negotiable — apply these to every response below) ===\n${relevant.map((p: any) => `- ${p.principle}`).join("\n")}\n=== END FOUNDER OPERATING PRINCIPLES ===`;
  } catch { return ""; }
}

async function handleObjectionWithAI(objectionText: string, leadContext: Record<string, unknown>, brandContext: Record<string, unknown>, cid: string) {
  if (!anthropicApiKey) {
    structuredLog("WARN", "No ANTHROPIC_API_KEY, returning placeholder objection response", {}, cid);
    return { response: "PLACEHOLDER: Objection handler response. Add ANTHROPIC_API_KEY.", confidence: 0, requires_escalation: true };
  }
  try {
    const principlesBlock = await getFounderPrinciplesBlock("closer-engine");
    const systemPrompt = `You are the Objection Handler AI for Franchisee Kart. Your job is to handle common franchise objections with data-backed responses. 

Common objections & your counters:
- "Fees too high": Show ROI breakeven (usually 18-24 months), compare to competitors, explain value
- "Timeline too long": This is standard for franchise setup, explain each phase's why
- "Market saturation": Provide data on market size, our location strategy minimizes competition
- "Support unclear": Detail our 25 AI agents + RM support + training program + ongoing coaching

For the objection: "${objectionText}"

Lead context: ${JSON.stringify(leadContext)}
Brand: ${brandContext.name}

Respond with:
1. Validate their concern
2. Provide data-backed counter
3. Ask a closing question to move forward
4. If you cannot resolve, recommend escalation to RM

Keep response concise (under 150 words). Be conversational, not salesy.${principlesBlock}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicApiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 512, system: systemPrompt, messages: [{ role: "user", content: `Handle this objection: "${objectionText}"` }] }),
    });
    if (!response.ok) {
      const text = await response.text();
      structuredLog("ERROR", "Claude API error in objection handler", { status: response.status, body: text }, cid);
      throw new Error(`Claude API error: ${response.status}`);
    }
    const data = await response.json();
    const responseText = data?.content?.[0]?.text ?? "";
    return { response: responseText, confidence: 0.85, requires_escalation: responseText.toLowerCase().includes("escalat") };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "AI error in objection handler", { error: msg }, cid);
    return { response: `Error: ${msg}`, confidence: 0, requires_escalation: true };
  }
}

async function handleObjection(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
  } catch { return errorResponse("Invalid JSON in request body", 400, undefined, cid); }

  const { lead_id, objection_text, objection_type = "general" } = body;
  if (!lead_id || typeof lead_id !== "string") return errorResponse("Missing or invalid 'lead_id' (string required)", 400, undefined, cid);
  if (!objection_text || typeof objection_text !== "string") return errorResponse("Missing or invalid 'objection_text' (string required)", 400, undefined, cid);
  if (objection_text.length > 2000) return errorResponse("Objection text too long: max 2000 characters", 400, undefined, cid);

  try {
    const { data: lead, error: leadError } = await supabase.from("leads").select("*, brand:brand_id(*)").eq("id", lead_id).single();
    if (leadError || !lead) { structuredLog("WARN", `Lead not found: ${lead_id}`, { error: leadError?.message }, cid); return errorResponse("Lead not found", 404, undefined, cid); }

    const aiResponse = await handleObjectionWithAI(objection_text as string, lead, lead.brand, cid);

    const { data: objection, error: objectionError } = await supabase.from("lead_objections").insert({ lead_id: lead_id, objection_type: objection_type, objection_text: objection_text, ai_handler_response: aiResponse.response, outcome: aiResponse.requires_escalation ? "escalated" : "resolved" }).select().single();
    if (objectionError) { structuredLog("ERROR", "Failed to log objection", { error: objectionError.message, leadId: lead_id }, cid); throw new Error(`Failed to log objection: ${objectionError.message}`); }

    const newStatus = aiResponse.requires_escalation ? "objection_escalated" : "objection_resolved";
    await supabase.from("leads").update({ negotiation_status: newStatus, last_objection: objection_text, objections_count: (lead.objections_count || 0) + 1 }).eq("id", lead_id);
    await supabase.from("lead_activities").insert({ lead_id: lead_id, type: "note", note: `Objection handled: "${objection_text}". Status: ${newStatus}` });

    structuredLog("INFO", `Objection handled for lead ${lead_id}`, { outcome: newStatus, escalated: aiResponse.requires_escalation }, cid);
    return successResponse({ success: true, objection_id: objection.id, ai_response: aiResponse.response, requires_escalation: aiResponse.requires_escalation, confidence: aiResponse.confidence, next_step: aiResponse.requires_escalation ? "Escalate to RM for manual handling" : "Share response with lead, await reply" }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 500, undefined, cid);
  }
}

// FIXED (Founder Vision Audit, Phase 3): stage was 'Onboarded', which violates
// the real leads_stage check constraint (new|contacted|qualified|proposal_sent|
// negotiation|closed|lost) and would have failed every deal closure. Now sets
// stage='closed' AND drafts a company_invoices row + files it for founder
// approval via the approvals table — completing the Sales→Finance→Founder
// chain instead of jumping straight to "invoice sent".
async function handleDealClosure(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
  } catch { return errorResponse("Invalid JSON in request body", 400, undefined, cid); }

  const { lead_id, approval_by_consultant_id, notes, amount_inr, line_items } = body;
  if (!lead_id || typeof lead_id !== "string") return errorResponse("Missing or invalid 'lead_id' (string required)", 400, undefined, cid);
  if (!approval_by_consultant_id || typeof approval_by_consultant_id !== "string") return errorResponse("Missing or invalid 'approval_by_consultant_id' (string required)", 400, undefined, cid);

  try {
    structuredLog("INFO", `Closing deal for lead ${lead_id}`, { consultantId: approval_by_consultant_id }, cid);

    const { data: lead, error: updateError } = await supabase
      .from("leads")
      .update({ stage: "closed", negotiation_status: "closed", deal_closure_date: new Date().toISOString() })
      .eq("id", lead_id)
      .select()
      .single();

    if (updateError || !lead) {
      structuredLog("ERROR", "Failed to close deal", { error: updateError?.message, leadId: lead_id }, cid);
      throw new Error(`Failed to close deal: ${updateError?.message}`);
    }

    await supabase.from("negotiation_history").insert({
      lead_id: lead_id, change_type: "deal_closure", field_name: "stage",
      old_value: "negotiation", new_value: "closed",
      changed_by: approval_by_consultant_id, change_reason: notes || "Manual approval by RM/Founder",
    });

    // Draft the invoice in Finance's queue (real amount only — if not provided,
    // leave it null and flag for Finance to price rather than inventing a figure).
    const total = typeof amount_inr === "number" && amount_inr > 0 ? amount_inr : null;
    const { data: invoice, error: invErr } = await supabase.from("company_invoices").insert({
      company_id: lead.company_id ?? null,
      lead_id: lead_id,
      invoice_number: `DRAFT-${lead_id.slice(0, 8)}-${Date.now().toString(36)}`,
      client_name: lead.contact_name ?? lead.company_name,
      client_email: lead.contact_email ?? null,
      client_phone: lead.contact_phone ?? null,
      line_items: line_items ?? [],
      subtotal_inr: total,
      tax_inr: null,
      total_inr: total,
      status: total ? "pending_approval" : "draft",
    }).select("id").single();
    if (invErr) { structuredLog("ERROR", "Failed to draft invoice", { error: invErr.message }, cid); throw new Error(`Failed to draft invoice: ${invErr.message}`); }

    let approvalId: string | null = null;
    if (total) {
      const { data: approval, error: apErr } = await supabase.from("approvals").insert({
        requested_by_agent: null,
        department_code: "FINANCE",
        action_type: "invoice_release",
        payload: { lead_id, invoice_id: invoice.id, client_name: lead.contact_name ?? lead.company_name, total_inr: total },
        risk_level: total > 500000 ? "high" : "medium",
        amount_inr: total,
        reason: `Invoice for closed deal: ${lead.company_name} (${total_inr_str(total)})`,
      }).select("id").single();
      if (!apErr) {
        approvalId = approval?.id ?? null;
        await supabase.from("company_invoices").update({ approval_id: approvalId }).eq("id", invoice.id);
      }
    }

    await supabase.from("lead_activities").insert({
      lead_id: lead_id, type: "note",
      note: total
        ? `Deal CLOSED. Invoice ${invoice.id} drafted (₹${total}) and filed for founder approval (approval ${approvalId}).`
        : `Deal CLOSED. Invoice ${invoice.id} drafted with no amount yet — Finance must price it before it can be filed for approval.`,
    });

    structuredLog("INFO", `Deal closed successfully for lead ${lead_id}`, { stage: "closed", invoiceId: invoice.id, approvalId }, cid);

    return successResponse({
      success: true, lead_id: lead_id, stage: "closed",
      invoice_id: invoice.id, approval_id: approvalId,
      message: total ? "Deal closed. Invoice drafted and filed for founder approval." : "Deal closed. Invoice drafted with no amount — Finance needs to price it before approval.",
      next_steps: total
        ? ["Awaiting founder approval on the invoice", "On approval, Accounts sends it and begins collection follow-up", "On payment, Sales/Finance/Executive are notified"]
        : ["Finance department prices the invoice", "Then it is filed for founder approval"],
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 500, undefined, cid);
  }
}

function total_inr_str(n: number): string { return `₹${n.toLocaleString("en-IN")}`; }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const cid = req.headers.get("X-Correlation-ID") || generateCorrelationId();
  structuredLog("INFO", `Request received: ${req.method} ${req.url}`, {}, cid);
  try {
    const envError = verifyEnvSecrets({ SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey });
    if (envError) return errorResponse(envError, 500, "Configuration error", cid);
    if (req.method !== "POST") return errorResponse("Method not allowed", 405, undefined, cid);
    const authHeader = req.headers.get("Authorization") || "";
    const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
    if (!user) return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
    let body: Record<string, unknown>;
    try {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    } catch { return errorResponse("Invalid JSON in request body", 400, undefined, cid); }
    const { action } = body;
    if (!action || typeof action !== "string") return errorResponse("Missing or invalid 'action' field", 400, undefined, cid);
    switch (action) {
      case "handle_objection": return await handleObjection(req, cid);
      case "close_deal": return await handleDealClosure(req, cid);
      default: return errorResponse(`Unknown action: ${action}`, 400, undefined, cid);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errorResponse(message, 500, undefined, cid);
  }
});
