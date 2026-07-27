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
//
// PHASE 0.1 FOLLOW-UP (2026-07-27): the 07-13 fix removed fabrication on LLM
// *failure*, but a second, quieter form survived: on LLM *success*, any
// parseable JSON was written as status='completed' with no check on whether
// it was real business execution or the model's own error message, and no
// persistence step for job types that name a real artifact (invoice,
// proposal, meeting). 153 GENERATE_INVOICE and 153 GENERATE_PROPOSAL jobs
// were 'completed' against 0 rows in invoices/company_invoices/proposals;
// 111 SCHEDULE_MEETING jobs were 'completed' against 0 rows in meetings, one
// sampled result returning the placeholder Zoom link zoom.us/j/1234567890.
// See NO_PERSISTENCE_JOB_TYPES and resultReportsFailure() below, and
// FKAIOS_CHECKPOINT_PHASE0.1_EXECUTION_TRUTH_FIXED.md.
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

// PHASE 0.1 EXECUTION TRUTH LAYER (2026-07-27): executeJob() has never had a
// persistence step for ANY job type — it calls an LLM, parses the JSON it
// returns, and that parsed object IS the "result". For most job types that's
// honest (the job is asking for an opinion/analysis). For these it is not:
// GENERATE_PROPOSAL and SCHEDULE_MEETING name a real business artifact (a
// proposal, a meeting) that this engine has never once written to proposals
// or meetings. A dedicated persistence engine exists for meetings
// (meeting-scheduler, real Google Calendar + `meetings` table writes) but is
// not wired into this job pipeline; no equivalent exists yet for proposals
// (document-engine only does file upload/delete). Building that persistence
// is real business-logic work — Phase 3 (Autonomous Revenue Engine), not a
// truth-layer fix — so until it exists, these two fail loudly and
// immediately instead of reporting an LLM opinion as completed business
// execution. See FKAIOS_CHECKPOINT_PHASE0.1_EXECUTION_TRUTH_FIXED.md.
//
// GENERATE_INVOICE was originally in this set too — moved out (2026-07-27)
// once real persistence was built; see writeInvoicePersistence() below.
const NO_PERSISTENCE_JOB_TYPES = new Set(["GENERATE_PROPOSAL", "SCHEDULE_MEETING"]);

function noPersistenceError(type: string): string {
  return `${type} has no real persistence path in ai-engine's job runner yet — completing it would only mean an LLM produced a document-shaped JSON blob, with nothing written to the real business table. Refusing to report this as completed. See FKAIOS_CHECKPOINT_PHASE0.1_EXECUTION_TRUTH_FIXED.md.`;
}

// A job whose LLM result is itself shaped like a failure (e.g. {"error": "..."}
// or {"status": "error", "message": "..."}) is not completed work — it's the
// model declining or being unable to do the task. Previously this parsed fine
// as JSON and was written to ai_jobs with status='completed' anyway, because
// runJobs() only checked "did JSON.parse succeed", never "does this JSON
// report success". Applies to every job type, not just the three above.
function resultReportsFailure(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.error === "string" && obj.error.trim().length > 0) return obj.error;
  if (obj.status === "error" && typeof obj.message === "string" && obj.message.trim().length > 0) return obj.message;
  return null;
}

// HANDS — FIRST REAL ACTION (2026-07-27): QUALIFY_LEAD has been running for
// real (75 completed, real LLM calls) and producing a well-formed, real
// verdict every time — {score, stage, notes, hot_lead, recommended_action} —
// but that verdict has only ever been written into ai_jobs.result. All 133
// live leads sit at stage='new' regardless of how many times they've been
// qualified: the CRM was never actually touched. This is the same class of
// gap Phase 0.1 found in GENERATE_INVOICE — a real result nothing persists —
// except here the fix is to build the missing hand, not reject the job,
// because the target table and the data both already exist and match.
//
// Deliberately conservative: `stage` is only written if the model's value is
// in a known-safe allowlist (never trust free-text into a CRM field with no
// enum constraint — that's just a structural form of fabrication), `notes`
// and `score` are always safe to persist as-is. If a QUALIFY_LEAD job names a
// lead_id, this now REQUIRES the write-back to succeed for the job to be
// honestly "completed" — same principle as Phase 0.1, applied by building the
// hand instead of refusing the job.
const ALLOWED_LEAD_STAGES = new Set(["new", "contacted", "qualified", "unqualified", "won", "lost"]);

async function writeLeadQualificationBack(job: AIJob, result: Record<string, unknown>, cid: string): Promise<void> {
  const leadId = job.payload?.lead_id;
  if (typeof leadId !== "string" || !leadId) {
    throw new Error("QUALIFY_LEAD job has no payload.lead_id — nothing to write the qualification back to.");
  }
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof result.score === "number" && Number.isFinite(result.score)) {
    update.lead_score = Math.max(0, Math.min(100, Math.round(result.score as number)));
  }
  if (typeof result.stage === "string" && ALLOWED_LEAD_STAGES.has(result.stage)) {
    update.stage = result.stage;
  }
  if (typeof result.notes === "string" && result.notes.trim().length > 0) {
    update.notes = result.notes.slice(0, 2000);
  }
  const { data, error } = await supabase
    .from("leads")
    .update(update)
    .eq("id", leadId)
    .select("id");

  if (error) {
    throw new Error(`Failed to write qualification back to leads: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error(
      `QUALIFY_LEAD referenced lead_id ${leadId} which does not exist in leads — nothing was updated.`
    );
  }
  structuredLog("INFO", "Real hand action: QUALIFY_LEAD result written to leads table", { jobId: job.id, leadId, update }, cid);
}

// HANDS — SECOND REAL ACTION (2026-07-27): GENERATE_INVOICE was one of the
// three job types Phase 0.1 rejected outright (NO_PERSISTENCE_JOB_TYPES)
// because nothing wrote its output anywhere real. That has changed: a real,
// already-built, founder-approval-gated invoice system exists —
// invoice-engine's `draft`/`approve`/`reject` actions against
// `company_invoices` — it just never had a job-pipeline writer feeding it.
// This function is that writer, reusing invoice-engine's own contract
// exactly (same table, same status vocabulary, same totals formula, same
// invoice-number convention) rather than inventing a second one.
//
// `company_invoices` is deliberately targeted over the separate `invoices`/
// `invoice_items` pair — that pair belongs to payment-engine's disconnected
// Razorpay payment-link flow; `company_invoices` is what finance-engine,
// governance-dashboard, and dashboard-engine actually read as the founder-
// facing source of revenue truth (governance-dashboard's own comment: "real
// money from company_invoices, honestly 0 today").
//
// Line items are read from whatever shape the LLM actually produced —
// {description,quantity,unit_price_inr} (invoice-engine's own LineItem
// shape) or the GST-style {description,amount} actually observed in
// production job results, mapped to quantity:1 — never invented. Totals are
// computed here with invoice-engine's own 18%-default formula rather than
// trusting any total the LLM claims, same discipline as the stage allowlist
// above. A job with no lead_id, an unresolvable lead/company, or no valid
// line items fails honestly — no fallback invoice is fabricated.
//
// Idempotency: `company_invoices.source_job_id` (added this session,
// company_invoices_source_job_id_uniq partial unique index) is the
// idempotency key. A unique-violation on insert means this exact job
// already created its invoice — the existing row is fetched and returned as
// success rather than failing or duplicating.
const GST_RATE_PCT = 18;

interface NormalizedLineItem { description: string; quantity: number; unit_price_inr: number; }

function normalizeInvoiceLineItems(result: Record<string, unknown>): NormalizedLineItem[] {
  const items: NormalizedLineItem[] = [];

  const direct = result.line_items;
  if (Array.isArray(direct)) {
    for (const raw of direct) {
      if (!raw || typeof raw !== "object") continue;
      const li = raw as Record<string, unknown>;
      const description = typeof li.description === "string" ? li.description.trim() : "";
      const quantity = Number(li.quantity);
      const unitPrice = Number(li.unit_price_inr);
      if (description && Number.isFinite(quantity) && quantity > 0 && Number.isFinite(unitPrice) && unitPrice >= 0) {
        items.push({ description: description.slice(0, 500), quantity, unit_price_inr: unitPrice });
      }
    }
    if (items.length > 0) return items;
  }

  // GST-style shape actually seen in production: result.invoice.items[{description, amount}].
  const invoiceBlock = result.invoice;
  const gstItems = invoiceBlock && typeof invoiceBlock === "object" ? (invoiceBlock as Record<string, unknown>).items : undefined;
  if (Array.isArray(gstItems)) {
    for (const raw of gstItems) {
      if (!raw || typeof raw !== "object") continue;
      const li = raw as Record<string, unknown>;
      const description = typeof li.description === "string" ? li.description.trim() : "";
      const amount = Number(li.amount);
      if (description && Number.isFinite(amount) && amount >= 0) {
        items.push({ description: description.slice(0, 500), quantity: 1, unit_price_inr: amount });
      }
    }
    if (items.length > 0) return items;
  }

  // Top-level shape actually seen in production (2026-07-27, with the
  // schema-instructed GENERATE_INVOICE prompt): result.items[{description,
  // amount}], no "invoice" wrapper key. Same discipline as the GST-style
  // branch above — real description + real amount only, never invented.
  const topLevelItems = result.items;
  if (Array.isArray(topLevelItems)) {
    for (const raw of topLevelItems) {
      if (!raw || typeof raw !== "object") continue;
      const li = raw as Record<string, unknown>;
      const description = typeof li.description === "string" ? li.description.trim() : "";
      const amount = Number(li.amount);
      if (description && Number.isFinite(amount) && amount >= 0) {
        items.push({ description: description.slice(0, 500), quantity: 1, unit_price_inr: amount });
      }
    }
  }
  return items;
}

function computeInvoiceTotals(items: NormalizedLineItem[]): { subtotal: number; tax: number; total: number } {
  const subtotal = items.reduce((sum, li) => sum + li.quantity * li.unit_price_inr, 0);
  const tax = subtotal * (GST_RATE_PCT / 100);
  return { subtotal, tax, total: subtotal + tax };
}

async function writeInvoicePersistence(job: AIJob, result: Record<string, unknown>, cid: string): Promise<Record<string, unknown>> {
  const leadId = job.payload?.lead_id;
  if (typeof leadId !== "string" || !leadId) {
    throw new Error("GENERATE_INVOICE job has no payload.lead_id — nothing to generate the invoice for.");
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, company_id, company_name, contact_name, contact_email, contact_phone")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) throw new Error(`Failed to look up lead ${leadId}: ${leadError.message}`);
  if (!lead) throw new Error(`GENERATE_INVOICE referenced lead_id ${leadId} which does not exist in leads.`);
  if (!lead.company_id) throw new Error(`Lead ${leadId} has no company_id — cannot create a company_invoices row (company_id is required).`);

  const items = normalizeInvoiceLineItems(result);
  if (items.length === 0) {
    throw new Error("GENERATE_INVOICE: no valid line items in the LLM result (checked result.line_items and result.invoice.items) — refusing to create an invoice with no real line items.");
  }
  const { subtotal, tax, total } = computeInvoiceTotals(items);

  const clientName = (typeof lead.contact_name === "string" && lead.contact_name.trim())
    || (typeof lead.company_name === "string" && lead.company_name.trim())
    || null;
  if (!clientName) {
    throw new Error(`Lead ${leadId} has neither contact_name nor company_name — cannot set the required client_name field.`);
  }

  const { count: existingCount } = await supabase
    .from("company_invoices")
    .select("id", { count: "exact", head: true })
    .eq("company_id", lead.company_id);
  const invoiceNumber = `INV-${new Date().getFullYear()}-${String((existingCount ?? 0) + 1).padStart(4, "0")}-${Date.now().toString().slice(-4)}`;

  const insertPayload = {
    company_id: lead.company_id,
    lead_id: leadId,
    invoice_number: invoiceNumber,
    client_name: clientName,
    client_email: typeof lead.contact_email === "string" ? lead.contact_email : null,
    client_phone: typeof lead.contact_phone === "string" ? lead.contact_phone : null,
    line_items: items,
    subtotal_inr: subtotal,
    tax_inr: tax,
    total_inr: total,
    status: "pending_approval",
    drafted_by_agent_id: job.agent_id,
    source_job_id: job.id,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("company_invoices")
    .insert(insertPayload)
    .select("*")
    .single();

  if (!insertError) {
    structuredLog("INFO", "Real hand action: GENERATE_INVOICE created a real company_invoices row", { jobId: job.id, invoiceId: inserted.id, invoiceNumber, total }, cid);
    return inserted;
  }

  // 23505 = unique_violation. If it's the source_job_id constraint, this job
  // already created its invoice on a prior attempt (retry) — fetch and
  // return that row as the (idempotent) result instead of duplicating or
  // failing.
  if ((insertError as { code?: string }).code === "23505") {
    const { data: existing, error: fetchError } = await supabase
      .from("company_invoices")
      .select("*")
      .eq("source_job_id", job.id)
      .maybeSingle();
    if (!fetchError && existing) {
      structuredLog("INFO", "GENERATE_INVOICE retry: invoice already exists for this job (idempotent, no duplicate created)", { jobId: job.id, invoiceId: existing.id }, cid);
      return existing;
    }
  }

  throw new Error(`Failed to create company_invoices row: ${insertError.message}`);
}

async function writeExecutionLogEvidence(
  job: AIJob,
  action: string,
  status: "success" | "failure",
  inputSummary: string,
  outputSummary: string,
  cid: string,
): Promise<void> {
  try {
    const { error } = await supabase.from("execution_log").insert({
      function_name: "ai-engine",
      agent_id: job.agent_id,
      department_code: "ACCOUNTS",
      action,
      input_summary: inputSummary.slice(0, 500),
      output_summary: outputSummary.slice(0, 500),
      status,
      error: status === "failure" ? outputSummary.slice(0, 500) : null,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    structuredLog("WARN", "Failed to write execution_log evidence (non-blocking)", { jobId: job.id, action, error: err instanceof Error ? err.message : String(err) }, cid);
  }
}

// DIGESTIVE SYSTEM — FIRST ORGAN (2026-07-27): ai_outcomes has existed, empty,
// since before this file's fabrication incident — 15,227+ jobs have run
// through this engine and none of them left a trace of what happened for
// anything to learn from. This writes one row per *terminal* outcome
// (completed, or failed after retries are exhausted / rejected outright) —
// not on "retry", which isn't a concluded experience yet. It only captures
// experience; it does not analyze it or feed it back into a prompt (that's
// ai_evolution — deliberately not attempted here, see
// FKAIOS_BODY_COMPLETION_ROADMAP.md). Recording an outcome must never fail
// the job it's recording — this is memory, not a gate.
async function recordOutcome(job: AIJob, outcomeType: "completed" | "failed", result: Record<string, unknown>, summary: string, cid: string): Promise<void> {
  try {
    const { error } = await supabase.from("ai_outcomes").insert({
      job_id: job.id,
      agent_id: job.agent_id,
      outcome_type: outcomeType,
      result,
      outcome: summary.slice(0, 500),
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    structuredLog("WARN", "Failed to record ai_outcomes row (non-blocking)", { jobId: job.id, outcomeType, error: err instanceof Error ? err.message : String(err) }, cid);
  }
}

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
      // GENERATE_INVOICE persistence (writeInvoicePersistence) parses a specific
      // shape (result.line_items[]). Without telling the LLM that shape, its
      // free-form JSON almost never matches it and the job fails honestly
      // instead of ever persisting — this closes that gap without touching any
      // other job type's prompt.
      const invoiceSchemaBlock = job.type === "GENERATE_INVOICE"
        ? `\nThis is a GENERATE_INVOICE job. Respond with ONLY this JSON structure:\n\n{\n  "line_items": [\n    {\n      "description": "string",\n      "quantity": number,\n      "unit_price_inr": number\n    }\n  ]\n}\n\nRules:\n- Use only real payload/lead/brand data.\n- Never invent products, services, or amounts.\n- If no real billable data exists, return:\n{\n  "line_items": []\n}`
        : "";
      const systemPrompt = `${agent.prompt}${groundedContext}${principlesBlock}\n\nYou will receive a job payload as JSON.\nExecute the task and respond with ONLY a valid JSON object.\nNo prose.\nNo markdown fences.\n${invoiceSchemaBlock}`;
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
    // PHASE 0.1: these types cannot complete honestly via this generic runner
    // (see NO_PERSISTENCE_JOB_TYPES above) — reject before spending an LLM
    // call on a result that would just be discarded. Terminal, not retryable:
    // this isn't a transient failure, so retry_count is left untouched.
    if (NO_PERSISTENCE_JOB_TYPES.has(job.type)) {
      const errorMessage = noPersistenceError(job.type);
      structuredLog("ERROR", `Job ${job.id} rejected: no persistence path for type ${job.type}`, { jobId: job.id, type: job.type }, cid);
      await supabase.from("ai_jobs").update({ status: "failed", updated_at: new Date().toISOString(), result: { error: errorMessage } }).eq("id", job.id);
      await recordOutcome(job, "failed", { error: errorMessage }, `${job.type} rejected: no persistence path exists yet.`, cid);
      results.push({ job_id: job.id, status: "failed", error: errorMessage });
      continue;
    }
    const { error: runningError } = await supabase.from("ai_jobs").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", job.id);
    if (runningError) { results.push({ job_id: job.id, status: "error", error: runningError.message }); continue; }
    try {
      const result = await executeJob(job, cid);
      // A result that reports its own failure is a failure, not completed
      // work — route it through the same honest retry/failed path below
      // instead of writing status='completed' over an error the model
      // already told us about.
      const failureReason = resultReportsFailure(result);
      if (failureReason) throw new Error(`Job reported its own failure: ${failureReason}`);
      // HANDS: for job types with a real, built persistence target, the write
      // must succeed for this to be honestly "completed" — see
      // writeLeadQualificationBack() above. A throw here routes into the same
      // honest failure path below, exactly like any other real failure.
      if (job.type === "QUALIFY_LEAD") {
        await writeLeadQualificationBack(job, result, cid);
      }
      if (job.type === "GENERATE_INVOICE") {
        const invoice = await writeInvoicePersistence(job, result, cid);
        await writeExecutionLogEvidence(
          job, "generate_invoice",
          "success",
          `job ${job.id}, lead_id ${job.payload?.lead_id}`,
          `company_invoices row ${invoice.id} (${invoice.invoice_number}), total_inr ${invoice.total_inr}`,
          cid,
        );
      }
      const { error: completeError } = await supabase.from("ai_jobs").update({ status: "completed", result, updated_at: new Date().toISOString() }).eq("id", job.id);
      if (completeError) throw new Error(completeError.message);
      await recordOutcome(job, "completed", result, `${job.type} completed.`, cid);
      results.push({ job_id: job.id, status: "completed", result });
    } catch (err) {
      // HONEST FAILURE PATH. The job is marked retry/failed with the REAL error.
      // Nothing is invented to keep the queue looking productive.
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      const newRetryCount = (job.retry_count ?? 0) + 1;
      const newStatus = newRetryCount < 3 ? "retry" : "failed";
      structuredLog("ERROR", `Job ${job.id} failed`, { error: errorMessage, retryCount: newRetryCount, newStatus }, cid);
      await supabase.from("ai_jobs").update({ status: newStatus, retry_count: newRetryCount, updated_at: new Date().toISOString(), result: { error: errorMessage } }).eq("id", job.id);
      if (job.type === "GENERATE_INVOICE") {
        await writeExecutionLogEvidence(
          job, "generate_invoice",
          "failure",
          `job ${job.id}, lead_id ${job.payload?.lead_id}`,
          errorMessage,
          cid,
        );
      }
      if (newStatus === "failed") {
        await recordOutcome(job, "failed", { error: errorMessage }, `${job.type} failed after ${newRetryCount} attempt(s): ${errorMessage}`, cid);
      }
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
