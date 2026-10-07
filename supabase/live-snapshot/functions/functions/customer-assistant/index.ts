// ============================================================================
// Customer-Facing AI — Assistant with Mandatory Escalation Rules
// ============================================================================
// Handles customer messages across WhatsApp and web channels with strict
// escalation guards for sensitive topics.
//
// Routes:
//   POST /customer-assistant/chat                — Handle customer message
//   POST /customer-assistant/escalation-rules     — List all escalation rules (admin)
//   POST /customer-assistant/test-escalation      — Test escalation triggers (admin)
//
// HONESTY PROTOCOL:
//   If ANY external dependency (Anthropic, OpenAI, knowledge-search) fails or
//   is unconfigured, the function MUST:
//   1. Log the failure clearly with structuredLog.
//   2. Respond to the customer with a graceful fallback message — never
//      expose internal error details.
//   3. NEVER fabricate information, pricing, terms, or guarantees.
//   4. If unsure, respond with "I'll connect you with a team member" rather
//      than guessing.
//
// MANDATORY ESCALATION RULES:
//   Before generating any response, the system checks for escalation triggers:
//   - Legal questions (contract, liability, sue, etc.)
//   - Refund requests
//   - Pricing negotiation
//   - Contract changes
//   - Sensitive complaints / escalation demands
//   If ANY trigger matches, the message is NOT answered. An approval_queue
//   entry is created and the assigned consultant is notified.
//
// REAL DATA GROUNDING:
//   All responses are generated ONLY from knowledge base results + lead
//   context. No synthetic data. Source citations are included in every response.
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
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
// Escalation Rules — MANDATORY triggers
// ──────────────────────────────────────────────
interface EscalationRule {
  name: string;
  category: string;
  keywords: string[];
  risk_level: "high" | "critical";
  response_template: string;
}

const ESCALATION_RULES: EscalationRule[] = [
  {
    name: "Legal Question",
    category: "legal",
    keywords: [
      "legal", "contract", "agreement", "liability", "sue", "court", "lawyer",
      "terms", "conditions", "warranty", "guarantee", "legal action", "attorney",
    ],
    risk_level: "critical",
    response_template: "This involves a legal matter. Connecting you with our team for specialized assistance.",
  },
  {
    name: "Refund Request",
    category: "refund",
    keywords: [
      "refund", "money back", "return", "cancel payment", "chargeback",
      "refund my money", "get my money back", "refund the amount",
    ],
    risk_level: "high",
    response_template: "Your refund request has been noted. A team member will reach out to assist you shortly.",
  },
  {
    name: "Pricing Negotiation",
    category: "pricing",
    keywords: [
      "discount", "negotiate", "cheaper", "lower price", "best price",
      "deal", "offer", "price match", "reduce price", "can you do better",
    ],
    risk_level: "high",
    response_template: "I understand you're looking for the best value. A consultant will review pricing options with you.",
  },
  {
    name: "Contract Change",
    category: "contract",
    keywords: [
      "change contract", "modify agreement", "amendment", "alter terms",
      "update contract", "change terms", "renegotiate", "exit clause",
    ],
    risk_level: "critical",
    response_template: "Contract modifications require careful review. Connecting you with a senior consultant.",
  },
  {
    name: "Sensitive Complaint",
    category: "complaint",
    keywords: [
      "complaint", "manager", "supervisor", "escalate", "unhappy",
      "terrible", "worst", "disappointed", "fed up", "angry", "frustrated",
    ],
    risk_level: "high",
    response_template: "I'm sorry to hear about your experience. Escalating this to a senior team member immediately.",
  },
];

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

interface ChatRequest {
  message: string;
  lead_id: string;
  conversation_history?: Array<{ role: string; content: string }>;
  channel: "whatsapp" | "web";
}

interface TestEscalationRequest {
  test_message: string;
  lead_id: string;
}

interface EscalationCheckResult {
  escalated: boolean;
  matched_rules: EscalationRule[];
  reason?: string;
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
// Helpers — Fetch consultant role for admin gate
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
        function: "customer-assistant",
        model,
        provider: "anthropic",
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
        function: "customer-assistant",
        model,
        provider: "openai",
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
// Escalation Check — MANDATORY before any response
// ──────────────────────────────────────────────
function checkEscalation(message: string): EscalationCheckResult {
  const lowerMessage = message.toLowerCase();
  const matchedRules: EscalationRule[] = [];

  for (const rule of ESCALATION_RULES) {
    for (const keyword of rule.keywords) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        // Verify it's a meaningful match (keyword appears as a word, not substring)
        const wordBoundaryRegex = new RegExp(`\\b${keyword.toLowerCase()}\\b`);
        if (wordBoundaryRegex.test(lowerMessage)) {
          matchedRules.push(rule);
          break; // One match per rule is enough
        }
      }
    }
  }

  if (matchedRules.length > 0) {
    return {
      escalated: true,
      matched_rules: matchedRules,
      reason: `Message triggered escalation rules: ${matchedRules.map((r) => r.name).join(", ")}`,
    };
  }

  return { escalated: false, matched_rules: [] };
}

// ──────────────────────────────────────────────
// Helpers — Fetch knowledge base for a brand
// ──────────────────────────────────────────────
async function fetchKnowledgeForBrand(
  brandId: string,
  message: string,
  cid: string
): Promise<{ content: string; sources: Array<{ document: string; source: string }> }> {
  try {
    // Query knowledge chunks for the brand
    const { data: chunks } = await supabase
      .from("knowledge_chunks")
      .select("content, chunk_index, document_id, documents(title), knowledge_sources(name)")
      .eq("brand_id", brandId)
      .limit(8);

    if (!chunks || chunks.length === 0) {
      structuredLog("INFO", "No knowledge chunks found for brand", { brandId }, cid);
      return { content: "", sources: [] };
    }

    const contentParts: string[] = [];
    const sources: Array<{ document: string; source: string }> = [];

    for (const chunk of chunks) {
      const chunkData = chunk as {
        content: string;
        chunk_index: number;
        documents: { title: string } | null;
        knowledge_sources: { name: string } | null;
      };
      contentParts.push(chunkData.content);
      sources.push({
        document: chunkData.documents?.title ?? "Unknown Document",
        source: chunkData.knowledge_sources?.name ?? "Unknown Source",
      });
    }

    // Deduplicate sources
    const uniqueSources = sources.filter(
      (s, i, arr) => arr.findIndex((t) => t.document === s.document && t.source === s.source) === i
    );

    return {
      content: contentParts.join("\n\n---\n\n").substring(0, 8000),
      sources: uniqueSources,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "Knowledge base fetch failed", { error: msg, brandId }, cid);
    return { content: "", sources: [] };
  }
}

// ──────────────────────────────────────────────
// Helpers — Create approval queue entry on escalation
// ──────────────────────────────────────────────
async function createEscalationApproval(
  leadId: string,
  message: string,
  matchedRules: EscalationRule[],
  channel: string,
  cid: string
): Promise<{ approvalId: string | null; error?: string }> {
  try {
    // Find the lead and its assigned consultant
    const { data: lead } = await supabase
      .from("leads")
      .select("id, name, brand_id, assigned_to, brands(name)")
      .eq("id", leadId)
      .maybeSingle();

    if (!lead) {
      structuredLog("WARN", "Lead not found for escalation", { leadId }, cid);
      return { approvalId: null, error: `Lead ${leadId} not found` };
    }

    const highestRisk = matchedRules.some((r) => r.risk_level === "critical") ? "critical" : "high";
    const escalationCategories = matchedRules.map((r) => r.category);

    const { data, error } = await supabase
      .from("approval_queue")
      .insert({
        action_type: "escalation",
        entity_type: "lead",
        entity_id: leadId,
        request_data: {
          original_message: message,
          matched_rules: matchedRules.map((r) => ({ name: r.name, category: r.category })),
          channel,
          lead_name: (lead as { name: string }).name,
          brand_name: (lead as { brands: { name: string } | null }).brands?.name ?? "Unknown",
        },
        risk_level: highestRisk,
        status: "pending",
        requested_by_user_id: (lead as { assigned_to: string | null }).assigned_to,
      })
      .select("id")
      .single();

    if (error) {
      structuredLog("ERROR", "Failed to create approval queue entry", { error: error.message }, cid);
      return { approvalId: null, error: error.message };
    }

    // Attempt to notify the assigned consultant via notifications table
    try {
      const assignedTo = (lead as { assigned_to: string | null }).assigned_to;
      if (assignedTo) {
        await supabase.from("notifications").insert({
          user_id: assignedTo,
          title: `Customer Escalation — ${matchedRules.map((r) => r.name).join(", ")}`,
          body: `A customer message triggered escalation: "${message.substring(0, 150)}..." Brand: ${(lead as { brands: { name: string } | null }).brands?.name ?? "Unknown"}. Lead: ${(lead as { name: string }).name}.`,
          type: "escalation",
          metadata: {
            lead_id: leadId,
            approval_id: data?.id,
            matched_rules: matchedRules.map((r) => r.name),
            channel,
          },
        });
        structuredLog("INFO", "Consultant notification sent", { assignedTo, approvalId: data?.id }, cid);
      }
    } catch (notifErr) {
      structuredLog("WARN", "Failed to send consultant notification", {
        error: notifErr instanceof Error ? notifErr.message : String(notifErr),
      }, cid);
    }

    structuredLog("INFO", "Escalation approval created", {
      approvalId: data?.id,
      leadId,
      rules: matchedRules.map((r) => r.name),
      riskLevel: highestRisk,
    }, cid);

    return { approvalId: data?.id as string };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "Escalation approval creation failed", { error: msg }, cid);
    return { approvalId: null, error: msg };
  }
}

// ──────────────────────────────────────────────
// POST /customer-assistant/chat
// ──────────────────────────────────────────────
async function handleChat(
  req: Request,
  cid: string,
  userId: string | null
): Promise<Response> {
  const startTime = performance.now();

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  // Validate required fields
  if (!body.message || typeof body.message !== "string" || body.message.trim().length === 0) {
    return errorResponse("Missing or invalid 'message' field. Must be a non-empty string.", 400, undefined, cid);
  }

  if (!body.lead_id || !isValidUUID(body.lead_id)) {
    return errorResponse("Missing or invalid 'lead_id'. Must be a valid UUID.", 400, undefined, cid);
  }

  if (body.channel !== "whatsapp" && body.channel !== "web") {
    return errorResponse("Invalid 'channel'. Must be 'whatsapp' or 'web'.", 400, undefined, cid);
  }

  if (body.message.length > 10000) {
    return errorResponse("Message too long: max 10000 characters", 400, undefined, cid);
  }

  const message = body.message.trim();

  structuredLog("INFO", "Processing customer message", {
    leadId: body.lead_id,
    channel: body.channel,
    messageLength: message.length,
    messagePreview: message.substring(0, 100),
  }, cid);

  // ── Step 1: Get lead context ──
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*, brands(name, slug, investment_range, royalty, sector, description), consultants(name, role)")
    .eq("id", body.lead_id)
    .maybeSingle();

  if (leadError || !lead) {
    structuredLog("ERROR", "Lead not found", { leadId: body.lead_id, error: leadError?.message }, cid);
    return errorResponse(`Lead not found: ${body.lead_id}`, 404, undefined, cid);
  }

  const leadData = lead as Record<string, unknown>;

  // ── Step 2: MANDATORY ESCALATION CHECK ──
  const escalationResult = checkEscalation(message);

  if (escalationResult.escalated) {
    structuredLog("WARN", "Escalation triggered — NOT answering", {
      leadId: body.lead_id,
      matchedRules: escalationResult.matched_rules.map((r) => r.name),
      reason: escalationResult.reason,
    }, cid);

    // Create approval queue entry
    const approvalResult = await createEscalationApproval(
      body.lead_id,
      message,
      escalationResult.matched_rules,
      body.channel,
      cid
    );

    // Store the escalated conversation
    try {
      await supabase.from("agent_conversations").insert({
        agent_id: null, // Customer assistant — not a specific AI agent
        user_id: userId ?? null,
        message: message,
        response: `ESCALATED: ${escalationResult.reason}. Approval ID: ${approvalResult.approvalId ?? "not_created"}`,
        context: {
          lead_id: body.lead_id,
          channel: body.channel,
          escalated: true,
          matched_rules: escalationResult.matched_rules.map((r) => r.name),
          approval_id: approvalResult.approvalId,
        },
      });
    } catch (convErr) {
      structuredLog("WARN", "Failed to store escalated conversation", {
        error: convErr instanceof Error ? convErr.message : String(convErr),
      }, cid);
    }

    await recordMetric(supabase, "customer_escalation_count", 1, {
      function: "customer-assistant",
      channel: body.channel,
      rules_matched: escalationResult.matched_rules.map((r) => r.name).join(","),
    });

    const elapsed = Math.round(performance.now() - startTime);

    return successResponse({
      escalated: true,
      reason: escalationResult.reason,
      matched_rules: escalationResult.matched_rules.map((r) => ({
        name: r.name,
        category: r.category,
        risk_level: r.risk_level,
      })),
      approval_id: approvalResult.approvalId,
      approval_error: approvalResult.error ?? undefined,
      customer_message: escalationResult.matched_rules[0]?.response_template ?? "A team member will contact you shortly.",
    }, 200, cid);
  }

  // ── Step 3: NOT escalated — proceed with knowledge-grounded response ──
  const brandId = leadData.brand_id as string | null;

  // Fetch knowledge base for the brand
  const { content: knowledgeContent, sources: knowledgeSources } = brandId
    ? await fetchKnowledgeForBrand(brandId, message, cid)
    : { content: "", sources: [] };

  // Fetch lead lifecycle / history for context
  let lifecycleContext = "";
  try {
    const { data: lifecycle } = await supabase
      .from("lead_lifecycle")
      .select("stage_history, next_action, blocked")
      .eq("lead_id", body.lead_id)
      .maybeSingle();

    if (lifecycle) {
      lifecycleContext = JSON.stringify(lifecycle).substring(0, 2000);
    }
  } catch (err) {
    structuredLog("WARN", "Failed to fetch lead lifecycle", {
      error: err instanceof Error ? err.message : String(err),
    }, cid);
  }

  // Fetch recent conversation history
  let historyContext = "";
  if (body.conversation_history && body.conversation_history.length > 0) {
    const recentHistory = body.conversation_history.slice(-6);
    historyContext = recentHistory
      .map((h) => `${h.role}: ${h.content.substring(0, 500)}`)
      .join("\n");
  }

  // ── Step 4: Build LLM prompt ──
  const brandInfo = leadData.brands as Record<string, unknown> | null;
  const consultantInfo = leadData.consultants as Record<string, unknown> | null;

  const systemPrompt = `You are a customer service assistant for ${brandInfo?.name ?? "our company"}, part of the Franchisee Kart franchise consulting platform.

YOUR STRICT RULES:
1. Answer ONLY from the knowledge base content provided below. If the knowledge base is empty, say "I'll connect you with a team member who can help you with this."
2. NEVER fabricate pricing, terms, investment ranges, royalty rates, guarantees, or any factual claims not in the provided data.
3. If you are unsure about any detail, respond with "Let me connect you with a team member who can give you the most accurate information." Do NOT guess.
4. Be polite, professional, and concise.
5. For WhatsApp messages, keep responses under 320 characters when possible.
6. Include source citations at the end of your response: "Source: [document name]"
7. Do NOT discuss internal operations, AI systems, or system details.
8. Do NOT make promises about timelines, guarantees, or outcomes not stated in the knowledge base.
9. The customer's name is ${leadData.name ?? "Valued Customer"}.
10. If the customer asks about a different brand, redirect them to contact us for that specific brand.

CUSTOMER CONTEXT:
${JSON.stringify({
  lead_name: leadData.name,
  lead_stage: leadData.stage,
  city: leadData.city,
  state: leadData.state,
  investment_capacity: leadData.investment_capacity,
  brand: brandInfo ? { name: brandInfo.name, sector: brandInfo.sector, investment_range: brandInfo.investment_range, royalty: brandInfo.royalty } : null,
  assigned_consultant: consultantInfo ? { name: consultantInfo.name } : null,
}, null, 2)}

LEAD LIFECYCLE:
${lifecycleContext || "No lifecycle data available."}

KNOWLEDGE BASE (brand SOPs, pricing, process info):
${knowledgeContent || "NO KNOWLEDGE BASE DATA AVAILABLE FOR THIS BRAND."}

PREVIOUS CONVERSATION:
${historyContext || "No previous conversation history provided."}`;

  let responseText: string;
  try {
    const llmResult = await callLLM(systemPrompt, message, 1024, cid);
    responseText = llmResult.text;

    // Post-hoc grounding check: warn if response contains potential fabrications
    const groundingCheckResponse = responseText;

    if (brandInfo && knowledgeContent.length === 0) {
      // If no knowledge base but the response contains specific numbers
      const numbers = groundingCheckResponse.match(/\d[\d,]*(\.\d+)?/g);
      if (numbers && numbers.length > 2) {
        structuredLog("WARN", "Response contains multiple numbers but knowledge base was empty", {
          leadId: body.lead_id,
          numbersFound: numbers.length,
        }, cid);
      }
    }

    structuredLog("INFO", "Customer response generated", {
      model: llmResult.model,
      provider: llmResult.provider,
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
      responseLength: responseText.length,
    }, cid);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown LLM error";
    structuredLog("ERROR", "LLM call failed for customer chat", { error: msg }, cid);

    // Graceful fallback — never expose internal errors to customer
    responseText = "I'm experiencing a technical issue right now. Let me connect you with a team member who can help. Please give us a moment.";

    // Store the failed attempt
    try {
      await supabase.from("agent_conversations").insert({
        agent_id: null,
        user_id: userId ?? null,
        message: message,
        response: responseText,
        context: {
          lead_id: body.lead_id,
          channel: body.channel,
          escalated: false,
          llm_error: msg,
          llm_available: false,
        },
      });
    } catch (_) {
      // Best effort
    }

    return successResponse({
      response: responseText,
      sources: [],
      escalated: false,
      llm_available: false,
    }, 200, cid);
  }

  // ── Step 5: Store conversation ──
  try {
    await supabase.from("agent_conversations").insert({
      agent_id: null,
      user_id: userId ?? null,
      message: message,
      response: responseText,
      context: {
        lead_id: body.lead_id,
        channel: body.channel,
        escalated: false,
        sources_used: knowledgeSources.map((s) => s.document),
        knowledge_source_count: knowledgeSources.length,
      },
    });
  } catch (convErr) {
    structuredLog("WARN", "Failed to store conversation", {
      error: convErr instanceof Error ? convErr.message : String(convErr),
    }, cid);
  }

  const elapsed = Math.round(performance.now() - startTime);

  await recordMetric(supabase, "api_latency_ms", elapsed, {
    function: "customer-assistant",
    endpoint: "chat",
    channel: body.channel,
  });

  return successResponse({
    response: responseText,
    sources: knowledgeSources,
    escalated: false,
    llm_available: true,
  }, 200, cid);
}

// ──────────────────────────────────────────────
// POST /customer-assistant/escalation-rules — Admin view
// ──────────────────────────────────────────────
async function handleEscalationRules(
  req: Request,
  cid: string,
  userId: string
): Promise<Response> {
  structuredLog("INFO", "Listing escalation rules (admin view)", { userId }, cid);

  // Return the compiled escalation rules with full metadata
  const rulesList = ESCALATION_RULES.map((rule) => ({
    name: rule.name,
    category: rule.category,
    keywords: rule.keywords,
    risk_level: rule.risk_level,
    response_template: rule.response_template,
    keyword_count: rule.keywords.length,
    compiled_pattern: rule.keywords.map((kw) => `\\b${kw}\\b`).join("|"),
  }));

  return successResponse({
    rules: rulesList,
    total_rules: rulesList.length,
    categories: [...new Set(ESCALATION_RULES.map((r) => r.category))],
    last_updated: "compiled_at_runtime",
  }, 200, cid);
}

// ──────────────────────────────────────────────
// POST /customer-assistant/test-escalation — Admin testing
// ──────────────────────────────────────────────
async function handleTestEscalation(
  req: Request,
  cid: string,
  userId: string
): Promise<Response> {
  let body: TestEscalationRequest;
  try {
    body = (await req.json()) as TestEscalationRequest;
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  if (!body.test_message || typeof body.test_message !== "string" || body.test_message.trim().length === 0) {
    return errorResponse("Missing or invalid 'test_message' field", 400, undefined, cid);
  }

  if (!body.lead_id || !isValidUUID(body.lead_id)) {
    return errorResponse("Missing or invalid 'lead_id'", 400, undefined, cid);
  }

  structuredLog("INFO", "Testing escalation triggers", {
    test_message: body.test_message.substring(0, 100),
    leadId: body.lead_id,
    adminUserId: userId,
  }, cid);

  // Run escalation check WITHOUT creating real approval entries
  const escalationResult = checkEscalation(body.test_message);

  // Also test what a non-escalated response would look like
  let simulatedResponse: string | null = null;
  if (!escalationResult.escalated) {
    simulatedResponse = "This message would NOT trigger escalation. A knowledge-grounded AI response would be generated normally.";
  } else {
    simulatedResponse = escalationResult.matched_rules[0]?.response_template ?? "A team member would be contacted.";
  }

  // Detailed per-rule analysis
  const ruleAnalysis = ESCALATION_RULES.map((rule) => {
    const lowerMsg = body.test_message.toLowerCase();
    const matchedKeywords: string[] = [];

    for (const keyword of rule.keywords) {
      const wordBoundaryRegex = new RegExp(`\\b${keyword.toLowerCase()}\\b`);
      if (wordBoundaryRegex.test(lowerMsg)) {
        matchedKeywords.push(keyword);
      }
    }

    return {
      rule_name: rule.name,
      triggered: matchedKeywords.length > 0,
      matched_keywords: matchedKeywords,
      risk_level: rule.risk_level,
      category: rule.category,
    };
  });

  const elapsed = Math.round(performance.now() - startTime);

  structuredLog("INFO", "Escalation test complete", {
    would_escalate: escalationResult.escalated,
    matched_rules: escalationResult.matched_rules.map((r) => r.name),
    elapsedMs: elapsed,
  }, cid);

  return successResponse({
    would_escalate: escalationResult.escalated,
    matched_rules: escalationResult.matched_rules.map((r) => ({
      name: r.name,
      category: r.category,
      risk_level: r.risk_level,
    })),
    simulated_response: simulatedResponse,
    rule_analysis: ruleAnalysis,
    test_message: body.test_message.substring(0, 200),
    dry_run: true,
    note: "This was a dry-run test. No approval entries were created.",
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

  structuredLog("INFO", `Customer Assistant request: ${req.method} ${req.url}`, {}, cid);

  try {
    // Verify required env secrets
    const envError = verifyEnvSecrets({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
    });
    if (envError) {
      return errorResponse(envError, 500, "Configuration error", cid);
    }

    // Route dispatch
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (method === "POST") {
      // /chat — allows anonymous WhatsApp (no JWT required for WhatsApp channel)
      if (path.endsWith("/chat")) {
        // For WhatsApp channel, JWT is optional (anonymous lead context)
        // For web channel, JWT is required
        let userId: string | null = null;
        let isWebChannel = false;

        // Parse body early to check channel
        let body: ChatRequest | null = null;
        try {
          body = (await req.json()) as ChatRequest;
        } catch {
          return errorResponse("Invalid JSON in request body", 400, undefined, cid);
        }

        if (!body.channel || body.channel === "web") {
          isWebChannel = true;
        }

        if (isWebChannel) {
          // Web channel requires JWT
          const authHeader = req.headers.get("Authorization") || "";
          const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
          if (!user) {
            return errorResponse("Unauthorized: valid JWT required for web channel", 401, undefined, cid);
          }
          userId = user.userId;
        } else {
          // WhatsApp channel — try JWT, proceed without if absent
          const authHeader = req.headers.get("Authorization") || "";
          const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
          userId = user?.userId ?? null;
          if (!userId) {
            structuredLog("INFO", "WhatsApp channel: proceeding without JWT (anonymous lead)", {}, cid);
          }
        }

        // Reconstruct the request body since we already consumed it
        // by passing body to handleChat directly
        const syntheticReq = new Request(req.url, {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify(body),
        });

        return await handleChat(syntheticReq, cid, userId);
      }

      // /escalation-rules and /test-escalation — admin only
      if (path.endsWith("/escalation-rules") || path.endsWith("/test-escalation")) {
        const authHeader = req.headers.get("Authorization") || "";
        const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
        if (!user) {
          return errorResponse("Unauthorized: valid JWT required for admin endpoints", 401, undefined, cid);
        }

        const role = await getConsultantRole(user.userId, cid);
        const isAdmin = role === "Founder" || role === "OpsHead" || role === "Admin";

        if (!isAdmin) {
          return errorResponse(
            "Forbidden: only admin roles (Founder, OpsHead, Admin) can access escalation management",
            403,
            `Your role is '${role ?? "unknown"}'`,
            cid
          );
        }

        structuredLog("INFO", "Admin authenticated for escalation endpoint", { userId: user.userId, role }, cid);

        if (path.endsWith("/escalation-rules")) {
          return await handleEscalationRules(req, cid, user.userId);
        }
        if (path.endsWith("/test-escalation")) {
          return await handleTestEscalation(req, cid, user.userId);
        }
      }
    }

    return errorResponse(
      "Endpoint not found",
      404,
      "Available: POST /chat, POST /escalation-rules (admin), POST /test-escalation (admin)",
      cid
    );
  } catch (err) {
    const elapsed = Math.round(performance.now() - startTime);
    const message = err instanceof Error ? err.message : "Internal server error";

    structuredLog("ERROR", "Unhandled error in customer-assistant", {
      error: message,
      stack: err instanceof Error ? err.stack?.substring(0, 500) : undefined,
      elapsedMs: elapsed,
    }, cid);

    await recordMetric(supabase, "error_count", 1, {
      function: "customer-assistant",
      error_type: err instanceof Error ? err.name : "unknown",
      error_message: message.substring(0, 200),
    });

    return errorResponse(message, 500, undefined, cid);
  } finally {
    const elapsed = Math.round(performance.now() - startTime);
    structuredLog("INFO", "Request completed", { method: req.method, elapsedMs: elapsed }, cid);
  }
});
