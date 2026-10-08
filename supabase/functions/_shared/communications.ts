// COMMUNICATIONS — sending a message is a capability, not a vendor call.
//   request ─► plan (capability → authorised resource, recipient checks,
//   channel rules) ─► founder approval (external messages are outward actions)
//   ─► send through the chosen resource ─► provider acknowledgement recorded
// Nothing is ever sent from a plan or a request: only an approvals row the
// founder approved is executed, once (claimed by compare-and-swap), and the
// provider's message id is the evidence that it left. Platform rules are
// respected, not bypassed: WhatsApp free-form text only inside the 24 h
// session the recipient opened; outside it a pre-approved template is needed.

import { classifyLLMFailure } from "./llm-router.ts";
import { parseRef } from "./resource-identity.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type CommunicationCapability = "send_whatsapp_message" | "send_email" | "send_sms" | "make_voice_call";

export interface CommunicationRequest {
  capability: CommunicationCapability;
  recipient: string;
  /** Free-form text, or the template body for template sends. */
  content: string;
  template?: { name: string; language: string; params?: string[] } | null;
  purpose: string;
  objectiveId?: string | null;
  requestedBy: string;
}

export interface CommunicationResourceRow {
  capability: string;
  resource_ref: string;
  provider: string;
  tier: string;
  credential_ref: string | null;
  lifecycle_state: string;
  health_status: string;
  unavailable_until: string | null;
  requires_approval: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface CommunicationPlan {
  capability: CommunicationCapability;
  resource: string | null;
  requiresApproval: boolean;
  blockers: string[];
  notes: string[];
  recipient: string;
  sessionOpen: boolean | null;
}

export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Pure planning: picks an authorised resource and lists every reason the
 * message cannot go. An empty blockers list means "may be sent once approved".
 */
export function planFromRows(req: CommunicationRequest, rows: CommunicationResourceRow[], env: (k: string) => string | undefined, lastInboundAt: Date | null, now = new Date()): CommunicationPlan {
  const blockers: string[] = [];
  const notes: string[] = [];
  let recipient = req.recipient.trim();
  if (req.capability === "send_whatsapp_message" || req.capability === "send_sms" || req.capability === "make_voice_call") {
    const p = normalisePhone(recipient);
    if (!p) blockers.push(`recipient '${req.recipient}' is not a valid international phone number`);
    else recipient = p;
  } else if (req.capability === "send_email" && !EMAIL.test(recipient)) {
    blockers.push(`recipient '${req.recipient}' is not a valid email address`);
  }
  if (!req.content.trim() && !req.template) blockers.push("empty message");

  const candidates = rows.filter((r) => r.capability === req.capability && r.lifecycle_state !== "retired");
  if (!candidates.length) blockers.push(`no resource is registered for ${req.capability}`);
  let chosen: CommunicationResourceRow | null = null;
  for (const r of candidates) {
    const missing = [r.credential_ref, String(r.metadata?.phone_number_ref ?? "") || null].filter((c): c is string => !!c && !env(c));
    if (missing.length) { notes.push(`${r.resource_ref}: not configured (${missing.join(", ")} unset)`); continue; }
    if (r.health_status === "unavailable" && r.unavailable_until && new Date(r.unavailable_until).getTime() > now.getTime()) { notes.push(`${r.resource_ref}: unavailable until ${r.unavailable_until}`); continue; }
    chosen = r;
    break;
  }
  if (candidates.length && !chosen) blockers.push(`no authorised resource for ${req.capability}: ${notes.join("; ")}`);

  let sessionOpen: boolean | null = null;
  if (req.capability === "send_whatsapp_message") {
    sessionOpen = !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < 24 * 3600_000;
    if (!sessionOpen && !req.template) blockers.push("outside the 24 h WhatsApp session the recipient opened: a pre-approved template is required (free-form text would be rejected by the platform)");
  }
  return { capability: req.capability, resource: chosen?.resource_ref ?? null, requiresApproval: chosen ? chosen.requires_approval !== false : true, blockers, notes, recipient, sessionOpen };
}

export async function planCommunication(db: Db, req: CommunicationRequest, env: (k: string) => string | undefined = (k) => Deno.env.get(k), now = new Date()): Promise<CommunicationPlan> {
  const { data: rows } = await db.from("fkaios_resource_capabilities")
    .select("capability,resource_ref,provider,tier,credential_ref,lifecycle_state,health_status,unavailable_until,requires_approval,metadata")
    .eq("capability", req.capability);
  let lastInbound: Date | null = null;
  if (req.capability === "send_whatsapp_message") {
    const p = normalisePhone(req.recipient);
    if (p) {
      const { data } = await db.from("whatsapp_inbound_messages").select("created_at").in("phone", [p, p.slice(-10), `+${p}`])
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      lastInbound = data?.created_at ? new Date(data.created_at) : null;
    }
  }
  return planFromRows(req, (rows ?? []) as CommunicationResourceRow[], env, lastInbound, now);
}

export const COMMUNICATION_ACTION = "external_communication";

/** Records the request for the founder's decision. Blocked plans are returned, never queued. */
export async function requestCommunication(db: Db, req: CommunicationRequest, env: (k: string) => string | undefined = (k) => Deno.env.get(k)): Promise<{ status: "awaiting_approval" | "blocked"; plan: CommunicationPlan; approvalId: string | null }> {
  const plan = await planCommunication(db, req, env);
  if (plan.blockers.length) return { status: "blocked", plan, approvalId: null };
  const { data, error } = await db.from("approvals").insert({
    action_type: COMMUNICATION_ACTION, status: "pending", risk_level: "medium", department_code: "EXECUTIVE",
    reason: `${req.capability} to ${plan.recipient}: ${req.purpose}`.slice(0, 500),
    payload: { request: { ...req, recipient: plan.recipient }, plan, requested_at: new Date().toISOString() },
  }).select("id").single();
  if (error) throw new Error(`could not record the approval request: ${error.message}`);
  return { status: "awaiting_approval", plan, approvalId: data.id };
}

// ---- execution of approved requests --------------------------------------

interface SendOutcome { ok: boolean; providerMessageId: string | null; category: string | null; error: string | null; httpStatus: number | null }

async function sendWhatsApp(recipient: string, req: CommunicationRequest, env: (k: string) => string | undefined): Promise<SendOutcome> {
  const token = env("WHATSAPP_ACCESS_TOKEN") ?? "";
  const phoneId = env("WHATSAPP_PHONE_NUMBER_ID") ?? "";
  const body = req.template
    ? { messaging_product: "whatsapp", to: recipient, type: "template", template: { name: req.template.name, language: { code: req.template.language }, ...(req.template.params?.length ? { components: [{ type: "body", parameters: req.template.params.map((t) => ({ type: "text", text: t })) }] } : {}) } }
    : { messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "text", text: { preview_url: false, body: req.content } };
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  } catch (err) {
    return { ok: false, providerMessageId: null, category: "provider_outage", error: (err instanceof Error ? err.message : String(err)).slice(0, 300), httpStatus: null };
  }
  const json = await res.json().catch(() => ({})) as { messages?: Array<{ id: string }>; error?: { message?: string } };
  const id = json.messages?.[0]?.id ?? null;
  if (res.ok && id) return { ok: true, providerMessageId: id, category: null, error: null, httpStatus: res.status };
  const c = classifyLLMFailure({ ok: false, httpStatus: res.status, rawBody: json, latencyMs: Date.now() - started, model: "whatsapp-cloud-api" });
  return { ok: false, providerMessageId: null, category: res.ok ? "invalid_response" : c.category, error: (json.error?.message ?? c.detail).slice(0, 300), httpStatus: res.status };
}

async function send(resourceRef: string, recipient: string, req: CommunicationRequest, env: (k: string) => string | undefined): Promise<SendOutcome> {
  const parsed = parseRef(resourceRef);
  if (req.capability === "send_whatsapp_message" && parsed?.provider === "meta") return await sendWhatsApp(recipient, req, env);
  return { ok: false, providerMessageId: null, category: "invalid_request", error: `no adapter for ${req.capability} on ${resourceRef}`, httpStatus: null };
}

/**
 * Sends every approved, not-yet-executed communication. Each approval is
 * claimed by writing payload.execution first (only one tick can win), the plan
 * is re-checked at send time (credentials, session window), and the outcome
 * with the provider acknowledgement is written back with evidence.
 */
export async function executeApprovedCommunications(db: Db, env: (k: string) => string | undefined = (k) => Deno.env.get(k), limit = 5): Promise<Array<Record<string, unknown>>> {
  const { data: approved } = await db.from("approvals").select("id,payload,decided_by,decided_at")
    .eq("action_type", COMMUNICATION_ACTION).eq("status", "approved").is("payload->execution", null).order("decided_at").limit(limit);
  const out: Array<Record<string, unknown>> = [];
  for (const a of (approved ?? []) as Array<{ id: string; payload: Record<string, unknown>; decided_by: string | null; decided_at: string | null }>) {
    const claimAt = new Date().toISOString();
    const { data: claimed } = await db.from("approvals").update({ payload: { ...a.payload, execution: { state: "sending", claimed_at: claimAt } } })
      .eq("id", a.id).is("payload->execution", null).select("id").maybeSingle();
    if (!claimed) continue;
    const req = (a.payload.request ?? {}) as CommunicationRequest;
    const plan = await planCommunication(db, req, env);
    let outcome: SendOutcome;
    const started = Date.now();
    if (plan.blockers.length || !plan.resource) outcome = { ok: false, providerMessageId: null, category: "invalid_request", error: `blocked at send time: ${plan.blockers.join("; ")}`, httpStatus: null };
    else outcome = await send(plan.resource, plan.recipient, req, env);
    const finishedAt = new Date().toISOString();
    const { data: ev } = await db.from("fkaios_verification_evidence").insert({
      objective_id: req.objectiveId ?? null, requirement_key: `communication:${req.capability}`, evidence_type: "provider_acknowledgement",
      verifier: plan.resource ?? "none", status: outcome.ok ? "passed" : "failed",
      observed_result: { approval_id: a.id, approved_by: a.decided_by, approved_at: a.decided_at, resource: plan.resource, recipient: plan.recipient, provider_message_id: outcome.providerMessageId, http_status: outcome.httpStatus, failure_category: outcome.category, error: outcome.error },
      verification_notes: outcome.ok ? `Provider accepted the message (id ${outcome.providerMessageId}). Delivery/read receipts arrive via webhook.` : `Not sent: ${outcome.error}`,
      verified_at: finishedAt,
    }).select("id").single();
    await db.from("fkaios_execution_steps").insert({
      objective_id: req.objectiveId ?? null, step_kind: "task_execution", task_class: req.capability, resource_ref: plan.resource ?? "tool:fkaios:communications",
      provider: plan.resource ? parseRef(plan.resource)?.provider ?? null : null, tool_ref: plan.resource ?? "tool:fkaios:communications", capability_ref: `capability:${req.capability}`,
      attempt: 1, started_at: new Date(started).toISOString(), finished_at: finishedAt, duration_ms: Date.now() - started, cost_usd: null,
      outcome: outcome.ok ? "completed" : "failed", failure_category: outcome.category, error: outcome.error,
      verification_status: outcome.ok ? "verified" : "rejected", verification_evidence_id: ev?.id ?? null,
    });
    await db.from("approvals").update({ payload: { ...a.payload, execution: { state: outcome.ok ? "sent" : "failed", claimed_at: claimAt, finished_at: finishedAt, provider_message_id: outcome.providerMessageId, error: outcome.error, evidence_id: ev?.id ?? null } } }).eq("id", a.id);
    out.push({ approval: a.id, sent: outcome.ok, provider_message_id: outcome.providerMessageId, error: outcome.error });
  }
  return out;
}
