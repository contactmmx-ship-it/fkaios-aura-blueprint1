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
  type AttemptRecord,
  type FailureCategory,
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
  // Added during the production-fix telemetry pass: gemini is a real,
  // actively-configured fallback provider in buildDefaultRouterConfig()'s
  // chain, not a hypothetical one — without an entry here, a Gemini success
  // silently priced itself as anthropic (the TOKEN_PRICING[provider] fallback
  // below), which is a cost-attribution error of the same shape as the
  // model-mislabeling this pass fixes. Figures match llm-router.ts's own
  // DEFAULT_PRICING for gemini-3.5-flash-lite.
  gemini: { inputPerMtok: 0.30, outputPerMtok: 2.50 },
} as const;
type TokenPricingProvider = keyof typeof TOKEN_PRICING;

interface AIJob {
  id: string; agent_id: string | null; type: string; payload: Record<string, unknown>;
  status: string; result: Record<string, unknown> | null; retry_count: number; created_at: string; updated_at: string;
}
interface LLMResult { text: string; inputTokens: number; outputTokens: number; model: string; provider: TokenPricingProvider; toolCall?: unknown; }

// PHASE 0.1 EXECUTION TRUTH LAYER (2026-07-27): executeJob() has never had a
// persistence step for ANY job type — it calls an LLM, parses the JSON it
// returns, and that parsed object IS the "result". For most job types that's
// honest (the job is asking for an opinion/analysis). For these it was not:
// GENERATE_PROPOSAL and SCHEDULE_MEETING name a real business artifact (a
// proposal, a meeting) that this engine used to never write to proposals-
// adjacent tables (client_projects) or meetings. See
// FKAIOS_CHECKPOINT_PHASE0.1_EXECUTION_TRUTH_FIXED.md for that incident.
//
// PRODUCTION-FIX PASS (2026-09-21): both now have a real capability path —
// see handleGenerateProposal() and handleScheduleMeeting() below, which
// delegate to the existing, already-built proposal-engine and
// meeting-scheduler functions/tables rather than inventing a second system.
// GENERATE_INVOICE was moved out of the old NO_PERSISTENCE_JOB_TYPES set on
// 2026-07-27 the same way, once writeInvoicePersistence() was built.
// NO_PERSISTENCE_JOB_TYPES itself is kept (now empty) as the guard point for
// any future job type that names a real business artifact but has no
// persistence path yet — the discipline this file enforces, not a dead
// artifact of one incident.
const NO_PERSISTENCE_JOB_TYPES = new Set<string>([]);

function noPersistenceError(type: string): string {
  return `${type} has no real persistence path in ai-engine's job runner yet — completing it would only mean an LLM produced a document-shaped JSON blob, with nothing written to the real business table. Refusing to report this as completed. See FKAIOS_CHECKPOINT_PHASE0.1_EXECUTION_TRUTH_FIXED.md.`;
}

// RETRY BEHAVIOR (production-fix pass, item 3): a job's failure is either
// something a retry might plausibly fix (LLM flakiness, a transient network
// error, momentarily-malformed output) or something structurally certain to
// fail identically every time (missing required payload data, a business
// precondition that isn't met, a required integration that isn't
// configured). Throwing this instead of a plain Error routes runJobs()
// straight to a terminal 'failed' status with a recorded, categorized
// reason — never silently burning through the retry budget on a job that
// cannot ever succeed as submitted.
export class NonRetryableJobError extends Error {
  constructor(message: string, public readonly disposition: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}

// A job whose LLM result is itself shaped like a failure (e.g. {"error": "..."}
// or {"status": "error", "message": "..."}) is not completed work — it's the
// model declining or being unable to do the task. Previously this parsed fine
// as JSON and was written to ai_jobs with status='completed' anyway, because
// runJobs() only checked "did JSON.parse succeed", never "does this JSON
// report success". Applies to every job type, not just the three above.
export function resultReportsFailure(parsed: unknown): string | null {
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
    throw new NonRetryableJobError("QUALIFY_LEAD job has no payload.lead_id — nothing to write the qualification back to.", "INVALID_PAYLOAD");
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
    throw new NonRetryableJobError(
      `QUALIFY_LEAD referenced lead_id ${leadId} which does not exist in leads — nothing was updated.`,
      "INVALID_PAYLOAD",
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

export interface NormalizedLineItem { description: string; quantity: number; unit_price_inr: number; }

export function normalizeInvoiceLineItems(result: Record<string, unknown>): NormalizedLineItem[] {
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

export function computeInvoiceTotals(items: NormalizedLineItem[]): { subtotal: number; tax: number; total: number } {
  const subtotal = items.reduce((sum, li) => sum + li.quantity * li.unit_price_inr, 0);
  const tax = subtotal * (GST_RATE_PCT / 100);
  return { subtotal, tax, total: subtotal + tax };
}

// GENERATE_INVOICE JSON FAILURE FIX (production-fix pass, item 2): the
// documented live failure is "Unexpected non-whitespace character after JSON
// at position 25" — the model returns valid JSON followed by trailing prose
// (or vice versa) despite being told "respond with ONLY a valid JSON
// object". Two layers, in order of preference:
//
// 1. STRUCTURED OUTPUT: INVOICE_TOOL_SCHEMA is passed as an Anthropic tool
//    schema (see executeJob's GENERATE_INVOICE branch and llm-router.ts's
//    tool_choice support) so the model is forced to answer through a typed
//    tool call. Anthropic's tool-use response has no free-text wrapper to
//    go wrong in the first place — this eliminates the failure mode at the
//    source for the primary provider, rather than getting better at
//    cleaning up its output after the fact.
// 2. EXTRACTION FALLBACK: extractJSONFromText() below, for providers this
//    router falls over to that don't get a tool schema (Gemini/OpenAI
//    adapters don't implement tool_choice yet) or for any other case where
//    a toolCall didn't come back. It finds the first balanced {...} object
//    in the text rather than requiring the whole string to already be
//    valid JSON.
//
// Either way, the result is then run through the SAME structural validation
// (normalizeInvoiceLineItems producing >=1 item) before it is ever
// considered for persistence — extracted JSON alone is not completion; see
// writeInvoicePersistence() below, which is the actual completion gate.
const INVOICE_TOOL_SCHEMA = {
  name: "emit_invoice",
  description: "Emit the invoice line items for this job. The ONLY way to answer — do not respond with prose or markdown.",
  input_schema: {
    type: "object",
    properties: {
      line_items: {
        type: "array",
        description: "Real, billable line items grounded in the job payload/lead/brand data. Never invented.",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            quantity: { type: "number" },
            unit_price_inr: { type: "number" },
          },
          required: ["description", "quantity", "unit_price_inr"],
        },
      },
    },
    required: ["line_items"],
  },
} as const;

/**
 * Finds the first balanced top-level JSON object or array in `text` by
 * brace/bracket counting (string- and escape-aware, so a `}` inside a quoted
 * value never closes the scan early) and parses that substring. Falls back
 * to parsing the whole trimmed string. Throws with a clear, distinguishing
 * message if no balanced JSON structure can be found at all — this is a
 * real, reportable failure, not a value to invent a default for.
 */
export function extractJSONFromText(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through to brace-scanning extraction */ }

  const openers = new Set(["{", "["]);
  const closers: Record<string, string> = { "}": "{", "]": "[" };
  let start = -1;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (start === -1) {
      if (openers.has(ch)) { start = i; stack.push(ch); }
      continue;
    }
    if (inString) {
      if (escaped) { escaped = false; }
      else if (ch === "\\") { escaped = true; }
      else if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (openers.has(ch)) { stack.push(ch); continue; }
    if (ch in closers) {
      if (stack[stack.length - 1] !== closers[ch]) {
        throw new Error(`LLM output contains mismatched JSON delimiters (found '${ch}' without a matching opener) — cannot safely extract a JSON object from: ${trimmed.slice(0, 200)}`);
      }
      stack.pop();
      if (stack.length === 0) {
        const candidate = trimmed.slice(start, i + 1);
        return JSON.parse(candidate);
      }
    }
  }

  throw new Error(`LLM returned no balanced JSON object or array — cannot extract structured data from: ${trimmed.slice(0, 200)}`);
}

/** Every job type in this engine expects a JSON *object* result (never a bare array/primitive) — a parsed-but-wrong-shape value is a validation failure, not completion. */
export function asJSONObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context}: expected a JSON object, got ${Array.isArray(value) ? "an array" : typeof value}`);
  }
  return value as Record<string, unknown>;
}

/**
 * The GENERATE_INVOICE-specific parse+validate step. Prefers a structured
 * tool call (guaranteed shape from Anthropic's tool_choice); otherwise
 * extracts JSON from free text. Either way, the result must still pass
 * normalizeInvoiceLineItems (>=1 real, well-formed line item) — a
 * successfully parsed object with no usable line items is a validation
 * failure, not completion, exactly like a JSON parse failure.
 */
export function parseAndValidateInvoicePayload(toolCall: unknown, text: string): Record<string, unknown> {
  let parsed: unknown;
  if (toolCall && typeof toolCall === "object") {
    parsed = toolCall;
  } else {
    const cleaned = text.replace(/```json|```/g, "").trim();
    parsed = extractJSONFromText(cleaned);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`GENERATE_INVOICE: extracted JSON is not an object (got ${Array.isArray(parsed) ? "array" : typeof parsed}) — cannot validate against the invoice schema.`);
  }
  const record = parsed as Record<string, unknown>;
  const items = normalizeInvoiceLineItems(record);
  if (items.length === 0) {
    throw new Error("GENERATE_INVOICE: parsed JSON has no valid line items (checked line_items, invoice.items, and items) — schema validation failed, refusing to treat this as a usable invoice payload.");
  }
  return record;
}

async function writeInvoicePersistence(job: AIJob, result: Record<string, unknown>, cid: string): Promise<Record<string, unknown>> {
  const leadId = job.payload?.lead_id;
  if (typeof leadId !== "string" || !leadId) {
    throw new NonRetryableJobError("GENERATE_INVOICE job has no payload.lead_id — nothing to generate the invoice for.", "INVALID_PAYLOAD");
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, company_id, company_name, contact_name, contact_email, contact_phone")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) throw new Error(`Failed to look up lead ${leadId}: ${leadError.message}`);
  if (!lead) throw new NonRetryableJobError(`GENERATE_INVOICE referenced lead_id ${leadId} which does not exist in leads.`, "INVALID_PAYLOAD");
  if (!lead.company_id) throw new NonRetryableJobError(`Lead ${leadId} has no company_id — cannot create a company_invoices row (company_id is required).`, "INVALID_PAYLOAD");

  const items = normalizeInvoiceLineItems(result);
  if (items.length === 0) {
    throw new Error("GENERATE_INVOICE: no valid line items in the LLM result (checked result.line_items and result.invoice.items) — refusing to create an invoice with no real line items.");
  }
  const { subtotal, tax, total } = computeInvoiceTotals(items);

  const clientName = (typeof lead.contact_name === "string" && lead.contact_name.trim())
    || (typeof lead.company_name === "string" && lead.company_name.trim())
    || null;
  if (!clientName) {
    throw new NonRetryableJobError(`Lead ${leadId} has neither contact_name nor company_name — cannot set the required client_name field.`, "INVALID_PAYLOAD");
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

// GENERATE_PROPOSAL — REAL CAPABILITY PATH (production-fix pass, item 4).
// Keeps the guard's spirit (never report completion without a real,
// persisted business artifact) but replaces the blanket up-front rejection
// with an attempt at the REAL capability: proposal-engine already exists,
// already drafts a grounded proposal (scope/deliverables/unknowns, price
// deliberately left UNKNOWN pending Founder approval — see its own header)
// and already persists it as a client_projects row plus an approvals gate.
// Reused here via an internal call (with an explicit lead_id target — see
// proposal-engine's own lead_id-targeting addition, same pass) rather than
// building a second proposal system inside ai-engine.
//
// Lifecycle: EXECUTING (call proposal-engine for this exact lead) ->
// VERIFYING (independently re-query client_projects, never trust the HTTP
// response alone) -> COMPLETED, or FAILED/BLOCKED with a recorded reason.
const PROPOSAL_MIN_SCORE = 40; // must match proposal-engine's own qualification bar

async function handleGenerateProposal(job: AIJob, cid: string): Promise<Record<string, unknown>> {
  const leadId = job.payload?.lead_id;
  if (typeof leadId !== "string" || !leadId) {
    throw new NonRetryableJobError("GENERATE_PROPOSAL job has no payload.lead_id — nothing to draft a proposal for.", "INVALID_PAYLOAD");
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, lead_score, is_active")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) throw new Error(`Failed to look up lead ${leadId}: ${leadError.message}`);
  if (!lead) throw new NonRetryableJobError(`GENERATE_PROPOSAL referenced lead_id ${leadId} which does not exist in leads.`, "INVALID_PAYLOAD");

  if ((lead.lead_score ?? 0) < PROPOSAL_MIN_SCORE || lead.is_active === false) {
    throw new NonRetryableJobError(
      `Lead ${leadId} does not meet proposal-engine's qualification bar (lead_score ${lead.lead_score ?? 0} < ${PROPOSAL_MIN_SCORE}, is_active ${lead.is_active}) — not eligible for a proposal yet. Retrying will not change this until the lead's own score/status changes.`,
      "NOT_ELIGIBLE",
    );
  }

  // Idempotency: if a client_projects row already exists for this lead
  // (this job's own prior retry, OR proposal-engine's independent hourly
  // cron picking up the same lead first), the work is already done —
  // verify and complete rather than re-drafting or erroring.
  const { data: existingProject } = await supabase
    .from("client_projects")
    .select("id, title, status")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (existingProject) {
    structuredLog("INFO", "GENERATE_PROPOSAL: client_projects row already exists for this lead (idempotent, no duplicate drafted)", { jobId: job.id, leadId, projectId: existingProject.id }, cid);
    return { proposal_drafted: true, client_project_id: existingProject.id, title: existingProject.title, status: existingProject.status, price_policy: "UNKNOWN — Founder gate. Never guessed." };
  }

  const heartbeatSecret = Deno.env.get("HEARTBEAT_SECRET") ?? "";
  if (!heartbeatSecret) {
    throw new Error("HEARTBEAT_SECRET is not configured in this environment — cannot authenticate to proposal-engine.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/proposal-engine`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-heartbeat-secret": heartbeatSecret },
    body: JSON.stringify({ lead_id: leadId }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`proposal-engine call failed (${response.status}): ${text.slice(0, 300)}`);
  }
  const proposalResult = await response.json();

  // VERIFICATION: a successful capability call is NOT automatic completion.
  // Independently re-query client_projects rather than trusting the HTTP
  // response body — see the kernel lifecycle's EXECUTING -> VERIFYING gate.
  const { data: verifiedProject, error: verifyError } = await supabase
    .from("client_projects")
    .select("id, title, status")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (verifyError) throw new Error(`Verification query failed after calling proposal-engine: ${verifyError.message}`);
  if (!verifiedProject) {
    throw new Error(`proposal-engine responded ${JSON.stringify(proposalResult).slice(0, 200)} but no client_projects row exists for lead ${leadId} afterward — persistence did not actually happen.`);
  }

  structuredLog("INFO", "Real hand action: GENERATE_PROPOSAL created a real client_projects row via proposal-engine", { jobId: job.id, leadId, projectId: verifiedProject.id }, cid);
  return {
    proposal_drafted: true,
    client_project_id: verifiedProject.id,
    title: verifiedProject.title,
    status: verifiedProject.status,
    price_policy: "UNKNOWN — Founder gate. Never guessed.",
  };
}

// SCHEDULE_MEETING — REAL CAPABILITY PATH (production-fix pass, item 5).
// meeting-scheduler already exists, already writes real `meetings` rows via
// its schedule_meeting action, and already integrates with Google Calendar
// (OAuth or a read-only API key) where configured — see getAvailableSlots()
// there. Reused as-is via an internal call rather than building a second
// scheduling system.
//
// Ownership: this job pipeline has no independent way to decide which
// consultant/rep should hold the meeting — leads.assigned_to is the only
// signal for that in this schema. A lead with no assigned_to is a genuine
// data-ownership gap (not something an LLM should guess at), so it is
// BLOCKED, honestly, rather than assigning an arbitrary consultant.
// Similarly, if meeting-scheduler reports no real calendar integration is
// configured, this stops at AWAITING_INTEGRATION rather than fabricating a
// success — see meeting-scheduler's calendarConfigured fix, same pass.
async function handleScheduleMeeting(job: AIJob, cid: string): Promise<Record<string, unknown>> {
  const leadId = job.payload?.lead_id;
  if (typeof leadId !== "string" || !leadId) {
    throw new NonRetryableJobError("SCHEDULE_MEETING job has no payload.lead_id — nothing to schedule a meeting for.", "INVALID_PAYLOAD");
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, assigned_to")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) throw new Error(`Failed to look up lead ${leadId}: ${leadError.message}`);
  if (!lead) throw new NonRetryableJobError(`SCHEDULE_MEETING referenced lead_id ${leadId} which does not exist in leads.`, "INVALID_PAYLOAD");

  if (!lead.assigned_to) {
    throw new NonRetryableJobError(
      `Lead ${leadId} has no assigned_to (consultant) — there is no way to determine who should hold this meeting. This is a data-ownership gap that must be fixed on the lead record, not guessed by this job.`,
      "BLOCKED",
    );
  }

  const { data: consultant, error: consultantError } = await supabase
    .from("consultants")
    .select("id")
    .eq("id", lead.assigned_to)
    .maybeSingle();
  if (consultantError) throw new Error(`Failed to look up consultant ${lead.assigned_to}: ${consultantError.message}`);
  if (!consultant) {
    throw new NonRetryableJobError(`Lead ${leadId}'s assigned_to (${lead.assigned_to}) does not match any row in consultants.`, "INVALID_PAYLOAD");
  }

  // Idempotency: a meeting may already exist for this lead.
  const { data: existingMeeting } = await supabase
    .from("meetings")
    .select("id, status, scheduled_at")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (existingMeeting) {
    structuredLog("INFO", "SCHEDULE_MEETING: a meeting already exists for this lead (idempotent, no duplicate scheduled)", { jobId: job.id, leadId, meetingId: existingMeeting.id }, cid);
    return { meeting_scheduled: true, meeting_id: existingMeeting.id, status: existingMeeting.status, scheduled_at: existingMeeting.scheduled_at };
  }

  const heartbeatSecret = Deno.env.get("HEARTBEAT_SECRET") ?? "";
  if (!heartbeatSecret) {
    throw new Error("HEARTBEAT_SECRET is not configured in this environment — cannot authenticate to meeting-scheduler.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/meeting-scheduler`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-heartbeat-secret": heartbeatSecret },
    body: JSON.stringify({ action: "schedule_meeting", lead_id: leadId, rm_id: lead.assigned_to }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`meeting-scheduler call failed (${response.status}): ${text.slice(0, 300)}`);
  }
  const schedulerResult = await response.json();

  if (schedulerResult?.reason === "calendar_not_configured") {
    // Never fake success — no real availability check was possible.
    throw new NonRetryableJobError(
      `meeting-scheduler could not perform a real calendar availability check for consultant ${lead.assigned_to}: ${schedulerResult.message ?? "calendar not configured"}`,
      "AWAITING_INTEGRATION",
    );
  }
  if (schedulerResult?.success !== true) {
    // e.g. "No available slots found for RM" — plausibly transient (a
    // future window may open up), bounded by the normal retry cap.
    throw new Error(`meeting-scheduler did not schedule a meeting: ${schedulerResult?.message ?? JSON.stringify(schedulerResult).slice(0, 200)}`);
  }

  // VERIFICATION: independently re-query meetings rather than trusting the
  // HTTP response body.
  const { data: verifiedMeeting, error: verifyError } = await supabase
    .from("meetings")
    .select("id, status, scheduled_at")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (verifyError) throw new Error(`Verification query failed after calling meeting-scheduler: ${verifyError.message}`);
  if (!verifiedMeeting) {
    throw new Error(`meeting-scheduler reported success but no meetings row exists for lead ${leadId} afterward — persistence did not actually happen.`);
  }

  structuredLog("INFO", "Real hand action: SCHEDULE_MEETING created a real meetings row via meeting-scheduler", { jobId: job.id, leadId, meetingId: verifiedMeeting.id }, cid);
  return {
    meeting_scheduled: true,
    meeting_id: verifiedMeeting.id,
    status: verifiedMeeting.status,
    scheduled_at: verifiedMeeting.scheduled_at,
    available_slots_offered: Array.isArray(schedulerResult.available_slots) ? schedulerResult.available_slots.length : null,
  };
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
      // GENERATE_INVOICE gets a forced structured-output tool schema (see
      // INVOICE_TOOL_SCHEMA) so Anthropic answers via tool_choice instead of
      // free text that can carry trailing prose — the documented live
      // failure ("Unexpected non-whitespace character after JSON at
      // position 25"). Other job types are unaffected.
      const llmResult = await callLLM(systemPrompt, userContent, cid, job.type === "GENERATE_INVOICE" ? INVOICE_TOOL_SCHEMA : undefined);
      await trackTokenUsage(agent.id, llmResult.model, llmResult.inputTokens, llmResult.outputTokens, llmResult.provider, cid);
      const parsed = job.type === "GENERATE_INVOICE"
        ? parseAndValidateInvoicePayload(llmResult.toolCall, llmResult.text)
        : asJSONObject(extractJSONFromText(llmResult.text.replace(/```json|```/g, "").trim()), `Job ${job.id} (${job.type})`);
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
    cid,
    job.type === "GENERATE_INVOICE" ? INVOICE_TOOL_SCHEMA : undefined,
  );
  await trackTokenUsage(null, llmResult.model, llmResult.inputTokens, llmResult.outputTokens, llmResult.provider, cid);
  try {
    return job.type === "GENERATE_INVOICE"
      ? parseAndValidateInvoicePayload(llmResult.toolCall, llmResult.text)
      : asJSONObject(extractJSONFromText(llmResult.text.replace(/```json|```/g, "").trim()), `Job ${job.id} (${job.type})`);
  } catch (err) {
    // Even an unparseable/invalid response is a REAL FAILURE, not a
    // placeholder. Re-thrown with the job's own identity for the retry/
    // failed path in runJobs() to log and persist.
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Job ${job.id} (${job.type}): ${detail}`);
  }
}

async function queueJob(type: string, payload: Record<string, unknown>, agentId: string | undefined, cid: string) {
  structuredLog("INFO", "Queuing new job", { type, agentId }, cid);
  const { data, error } = await supabase.from("ai_jobs").insert({ type, payload, agent_id: agentId ?? null, status: "pending" }).select().single();
  if (error) { structuredLog("ERROR", "Failed to queue job", { error: error.message, type }, cid); throw new Error(`Failed to queue job: ${error.message}`); }
  return { job: data };
}

// PROVIDER AVAILABILITY (production-fix pass, item 6): llm-router.ts is
// deliberately stateless — see its own header comment — so it retries a
// provider known to be unavailable (OpenAI has zero credits in this
// deployment) on every single call, forever, at guaranteed-failure cost.
// This is the cross-invocation memory the router intentionally doesn't own;
// ai-engine (the caller) owns reading and updating it instead, against the
// provider_health_state table (see migration 20260921130000). TTLs are
// env-overridable, never a hardcoded "OpenAI is down" anywhere in code —
// disable a provider by category-appropriate cooldown, not by name.
const DEFAULT_HEALTH_TTL_MINUTES: Partial<Record<FailureCategory, number>> = {
  credit_exhaustion: 360, // durable — won't fix itself; recheck a few times a day
  authentication_failure: 360, // almost certainly a bad/missing key
  provider_outage: 5,
  timeout: 5,
  rate_limit: 2,
  // invalid_response / invalid_request are about THIS request's content, not
  // the provider's availability — no persistent suppression for either.
};

export function getHealthTtlMinutes(category: FailureCategory): number {
  const envKey = `PROVIDER_HEALTH_TTL_${category.toUpperCase()}_MIN`;
  const override = Deno.env.get(envKey);
  const parsed = override ? Number(override) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_HEALTH_TTL_MINUTES[category] ?? 0;
}

async function getUnavailableProviders(cid: string): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from("provider_health_state")
      .select("provider, unavailable_until")
      .not("unavailable_until", "is", null)
      .gt("unavailable_until", new Date().toISOString());
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((row) => row.provider as string));
  } catch (err) {
    // Health-state read failure must never block a real LLM call — fail
    // open (try every configured provider) rather than fail closed.
    structuredLog("WARN", "Failed to read provider_health_state (failing open — no providers suppressed)", { error: err instanceof Error ? err.message : String(err) }, cid);
    return new Set();
  }
}

async function updateProviderHealthFromAttempts(attempts: AttemptRecord[], cid: string): Promise<void> {
  const now = new Date();
  for (const attempt of attempts) {
    try {
      if (attempt.outcome === "success") {
        await supabase.from("provider_health_state").upsert({
          provider: attempt.provider, status: "available", failure_category: null, reason: null,
          unavailable_until: null, consecutive_failures: 0, last_success_at: now.toISOString(), updated_at: now.toISOString(),
        }, { onConflict: "provider" });
        continue;
      }
      const category = attempt.failureCategory;
      const ttlMinutes = category ? getHealthTtlMinutes(category) : 0;
      if (ttlMinutes <= 0) continue; // this failure category doesn't imply the provider itself is unavailable
      const unavailableUntil = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
      const { data: existing } = await supabase.from("provider_health_state").select("consecutive_failures").eq("provider", attempt.provider).maybeSingle();
      await supabase.from("provider_health_state").upsert({
        provider: attempt.provider,
        status: ttlMinutes >= 60 ? "unavailable" : "degraded",
        failure_category: category,
        reason: `${category} at ${now.toISOString()}, model ${attempt.model}`,
        unavailable_until: unavailableUntil,
        consecutive_failures: ((existing?.consecutive_failures as number) ?? 0) + 1,
        last_failure_at: now.toISOString(),
        updated_at: now.toISOString(),
      }, { onConflict: "provider" });
    } catch (err) {
      // Same fail-open principle: health-state bookkeeping is telemetry, not
      // a gate — it must never throw and break the job it's observing.
      structuredLog("WARN", "Failed to update provider_health_state (non-blocking)", { provider: attempt.provider, error: err instanceof Error ? err.message : String(err) }, cid);
    }
  }
}

async function callLLM(systemPrompt: string, userContent: string, cid: string, toolSchema?: unknown): Promise<LLMResult> {
  const unavailable = await getUnavailableProviders(cid);
  const allProviders = buildDefaultRouterConfig();
  const candidateProviders = allProviders.providers.filter((p) => !unavailable.has(p.name));
  // Fail OPEN if suppression would remove every candidate — an honest
  // real-provider failure beats a router that can never call anyone. Keep
  // Anthropic available: in practice this only ever trims a provider with
  // zero remaining candidates (e.g. OpenAI alone configured and suppressed).
  const config = { ...allProviders, providers: candidateProviders.length > 0 ? candidateProviders : allProviders.providers };
  if (unavailable.size > 0) {
    structuredLog("INFO", "Provider health gate suppressed candidates for this call", { suppressed: [...unavailable], remaining: config.providers.map((p) => p.name) }, cid);
  }

  const result = await routedCallLLM(
    {
      systemPrompt,
      userContent,
      toolSchema,
      functionName: "ai-engine",
      functionClass: "background_agent",
    },
    config,
  );

  await updateProviderHealthFromAttempts(result.log.attempts, cid);

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
      successful_model: result.log.successful_model,
      attempted_providers: result.log.attempted_providers,
      failure_reason: result.log.failure_reason,
      functionName: "ai-engine",
    }, cid);
  }

  const provider = (result.log.successful_provider ?? "anthropic") as TokenPricingProvider;
  // TELEMETRY FIX (production-fix pass, item 1): the model is whatever the
  // router says actually answered — never re-derived from `provider` here.
  // This is the exact bug that mislabeled every anthropic call as the
  // deprecated "claude-3-haiku-20240307" while claude-haiku-4-5-20251001 was
  // the model actually being billed and answering.
  const model = result.model ?? result.log.successful_model ?? "unknown";

  return {
    text: result.content ?? "",
    toolCall: result.toolCall,
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
  const llmResult = await callLLM(systemPrompt, userContent, cid);
  await trackTokenUsage(agentId, llmResult.model, llmResult.inputTokens, llmResult.outputTokens, llmResult.provider, cid);
  const responseText = llmResult.text;
  validateGrounding(responseText, `${systemPrompt}\n${userContent}`, cid);
  const { data: conversation, error: convError } = await supabase.from("agent_conversations").insert({ agent_id: agentId, message, response: responseText, context: { live: true } }).select().single();
  if (convError) { structuredLog("ERROR", "Failed to save conversation", { error: convError.message, agentId }, cid); throw new Error(`Failed to save conversation: ${convError.message}`); }
  await supabase.from("agent_activity_log").insert({ agent_id: agentId, activity_type: "chat", title: `Responded to: "${message.slice(0, 40)}"`, description: responseText.slice(0, 200), metadata: { live: true, tokens: { input: llmResult.inputTokens, output: llmResult.outputTokens } } });
  return { conversation };
}

const MAX_RETRY_ATTEMPTS = 3;

// STARVATION FIX (2026-09-21): a strict `ORDER BY created_at ASC` fetch lets
// an old backlog of never-succeeding jobs (retry_count > 0, resurrected by
// job-scheduler's claimEligibleRetryJobs after months dormant) permanently
// outrank brand-new work, since resurrected retries keep their original,
// older created_at forever. Observed live: 1,690 retry-status jobs dating to
// July/August starved two same-day autonomy-test jobs across 5+ consecutive
// 10-minute cron ticks. Fix: reserve part of each batch for jobs that have
// never failed yet (retry_count = 0), so new work always gets a turn
// regardless of how large the historical backlog is. This does not change
// retry/exhaustion semantics (MAX_RETRY_ATTEMPTS below is untouched) — it
// only changes fetch fairness.
const FRESH_JOB_RESERVED_SLOTS = 5;
const BACKLOG_JOB_SLOTS = 5;

async function fetchJobBatch(cid: string): Promise<AIJob[]> {
  const { data: freshJobs, error: freshError } = await supabase
    .from("ai_jobs").select("*").eq("status", "pending").eq("retry_count", 0)
    .order("created_at", { ascending: true }).limit(FRESH_JOB_RESERVED_SLOTS);
  if (freshError) throw new Error(`Failed to fetch fresh jobs: ${freshError.message}`);
  const { data: backlogJobs, error: backlogError } = await supabase
    .from("ai_jobs").select("*").eq("status", "pending").gt("retry_count", 0)
    .order("created_at", { ascending: true }).limit(BACKLOG_JOB_SLOTS);
  if (backlogError) throw new Error(`Failed to fetch backlog jobs: ${backlogError.message}`);
  const seen = new Set<string>();
  const combined: AIJob[] = [];
  for (const job of [...(freshJobs ?? []), ...(backlogJobs ?? [])]) {
    if (!seen.has(job.id)) { seen.add(job.id); combined.push(job); }
  }
  structuredLog("INFO", "Fetched job batch", { fresh: freshJobs?.length ?? 0, backlog: backlogJobs?.length ?? 0 }, cid);
  return combined;
}

async function runJobs(cid: string) {
  structuredLog("INFO", "Running pending jobs", {}, cid);
  const jobs: AIJob[] = await fetchJobBatch(cid);
  const results: Array<{ job_id: string; status: string; result?: Record<string, unknown>; error?: string }> = [];
  for (const job of jobs) {
    // PHASE 0.1: these types cannot complete honestly via this generic runner
    // (see NO_PERSISTENCE_JOB_TYPES above) — reject before spending an LLM
    // call on a result that would just be discarded. Terminal, not retryable:
    // this isn't a transient failure, so retry_count is left untouched.
    if (NO_PERSISTENCE_JOB_TYPES.has(job.type)) {
      const errorMessage = noPersistenceError(job.type);
      structuredLog("ERROR", `Job ${job.id} rejected: no persistence path for type ${job.type}`, { jobId: job.id, type: job.type }, cid);
      await supabase.from("ai_jobs").update({ status: "failed", updated_at: new Date().toISOString(), result: { error: errorMessage }, error: errorMessage }).eq("id", job.id);
      await recordOutcome(job, "failed", { error: errorMessage }, `${job.type} rejected: no persistence path exists yet.`, cid);
      results.push({ job_id: job.id, status: "failed", error: errorMessage });
      continue;
    }

    // DUPLICATE-RETRY PREVENTION (production-fix pass, item 3): claim the
    // job atomically by conditioning the UPDATE on status still being
    // 'pending'. If a concurrent invocation (an overlapping cron tick, or
    // job-scheduler and the direct ai-engine-run-jobs-5min cron racing each
    // other) already claimed it, this UPDATE affects zero rows and .select()
    // returns nothing — skip rather than double-process the same job.
    const { data: claimed, error: runningError } = await supabase
      .from("ai_jobs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "pending")
      .select()
      .maybeSingle();
    if (runningError) { results.push({ job_id: job.id, status: "error", error: runningError.message }); continue; }
    if (!claimed) {
      structuredLog("INFO", `Job ${job.id} already claimed by another invocation — skipping`, { jobId: job.id }, cid);
      continue;
    }

    try {
      let result: Record<string, unknown>;
      // GENERATE_PROPOSAL / SCHEDULE_MEETING (items 4/5): real capability
      // calls to proposal-engine / meeting-scheduler, each with its own
      // verification step — never ai-engine's own generic LLM-guesses-JSON
      // path, which has no way to persist either artifact.
      if (job.type === "GENERATE_PROPOSAL") {
        result = await handleGenerateProposal(job, cid);
      } else if (job.type === "SCHEDULE_MEETING") {
        result = await handleScheduleMeeting(job, cid);
      } else {
        result = await executeJob(job, cid);
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
      }
      const { error: completeError } = await supabase.from("ai_jobs").update({ status: "completed", result, updated_at: new Date().toISOString(), error: null }).eq("id", job.id);
      if (completeError) throw new Error(completeError.message);
      await recordOutcome(job, "completed", result, `${job.type} completed.`, cid);
      results.push({ job_id: job.id, status: "completed", result });
    } catch (err) {
      // HONEST FAILURE PATH. The job is marked retry/failed with the REAL
      // error and a recorded, categorized reason. Nothing is invented to
      // keep the queue looking productive.
      const isNonRetryable = err instanceof NonRetryableJobError;
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      const newRetryCount = (job.retry_count ?? 0) + 1;
      // Non-retryable errors stop retrying immediately, regardless of
      // retry_count — a structural/business failure (missing payload data,
      // a precondition that isn't met, a missing integration) will fail
      // identically on every future attempt, so burning through the retry
      // budget on it only delays an honest terminal status.
      const newStatus = isNonRetryable || newRetryCount >= MAX_RETRY_ATTEMPTS ? "failed" : "retry";
      const disposition = isNonRetryable ? (err as NonRetryableJobError).disposition : (newStatus === "failed" ? "RETRY_EXHAUSTED" : "RETRYING");
      structuredLog(isNonRetryable ? "WARN" : "ERROR", `Job ${job.id} failed`, { error: errorMessage, retryCount: newRetryCount, newStatus, disposition, nonRetryable: isNonRetryable }, cid);
      await supabase.from("ai_jobs").update({
        status: newStatus,
        retry_count: newRetryCount,
        updated_at: new Date().toISOString(),
        error: errorMessage,
        result: { error: errorMessage, kernel_disposition: disposition, retryable: !isNonRetryable, retry_count: newRetryCount },
      }).eq("id", job.id);
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
        await recordOutcome(job, "failed", { error: errorMessage, kernel_disposition: disposition }, `${job.type} failed after ${newRetryCount} attempt(s), disposition ${disposition}: ${errorMessage}`, cid);
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
