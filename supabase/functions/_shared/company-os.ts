// ============================================================================
// COMPANY OPERATING SYSTEM — SPRINT 11 (M1-S11)
// ============================================================================
// Founder Brain → Executive Planner → Departments → Work Engine →
// AI Employees → Execution Runtime → COMPANY OS → Business Systems →
// Learning → Founder Brain
//
// This is NOT another AI, another execution engine, or another orchestrator.
// It is a thin capability registry + router + execution log in front of
// business engines that already exist and already work.
//
// TECHNOLOGY INTEGRATION AUDIT (per the permanent Constitution — searched
// FKAIOS itself first, Level 1/2, before considering anything external):
//
// Business capability inventory found in supabase/functions/ (85 edge
// functions total; this list is the founder's own named categories, mapped
// to what actually exists):
//   CRM           -> crm-webhook, lead-capture, lead-discovery,
//                     lead-ingestion-engine, lead-intake
//   WhatsApp      -> whatsapp-engine, whatsapp-outbound, whatsapp-send,
//                     whatsapp-webhook(-v2), whatsapp-template-manager
//   Knowledge     -> vault-engine, knowledge, knowledge-engine,
//                     knowledge-search
//   Research      -> research-engine, market-intelligence, web-crawler
//   Documents     -> document-engine, document-ingest, invoice-pdf
//   Founder Voice -> sales-engine ('speak' action, confirmed Sprint 4)
//   Brain Chat    -> brain-engine (confirmed Sprint 4)
//   Approvals     -> approval-engine, governance-engine
//   Accounting    -> accounting-engine, invoice-engine, payment-engine,
//                     payment-link, finance-engine
//   Sales         -> sales-engine, closer-engine
//   Staff         -> staff-engine (confirmed Sprint 4)
//   Marketing     -> pr-engine, linkedin-outbound, linkedin-webhook,
//                     meta-webhook, meta-linkedin-webhook
//   Operations    -> ops-intelligence, auto-pilot
//   Governance    -> governance-dashboard, governance-engine
//   Reporting     -> reporting-engine, reports, mis-engine, dashboard-engine
//   Automation    -> auto-agents-engine, auto-pilot, job-scheduler,
//                     agent-scheduler
//   Workflows     -> orchestrator-engine, orchestrator, orchestrator-brain
//   Inventory     -> NOT FOUND. No inventory-shaped engine exists in this
//                     ZIP. Not fabricated as present.
//   Email         -> NOT FOUND as a dedicated engine. Not fabricated.
//
// DECISION: REUSE for every capability above — none of them get rebuilt.
// EXTEND: this file adds the ONE thing that doesn't exist anywhere —
// a single registry + dispatcher so Work Engine/AI Employees call ONE
// interface (executeCapability()) instead of every caller needing to know
// which of 85 functions to hit and how.
//
// HONESTY ON VERIFICATION DEPTH: of the ~30 engines above, this sprint
// actually READ the dispatch code (not just the filename) for 7:
// whatsapp-engine, research-engine, vault-engine, document-engine,
// approval-engine, reporting-engine — confirmed real body.action (or
// pathname, for reporting-engine) dispatch with specific action names.
// accounting-engine was inspected and its dispatch style was NOT
// confirmed in the time available. Every other named engine above is
// listed because it EXISTS (grep-confirmed filename/purpose) but its
// exact callable interface was NOT inspected this sprint. The registry
// below marks `verified: true` ONLY for capabilities whose action name
// was read directly in source; everything else is `verified: false` and
// executeCapability() REFUSES to dispatch to an unverified capability
// rather than guess at a payload shape — per the Runtime Honesty Rule,
// this is stated as a real limitation, not glossed over.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

function getClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key);
}

export interface CapabilityDefinition {
  edgeFunction: string;
  action?: string; // body.action value for action-dispatch functions; omitted for path-routed or single-purpose ones
  description: string;
  verified: boolean; // true only if THIS action name was read directly in the target function's source this sprint
}

export const CAPABILITY_REGISTRY: Record<string, CapabilityDefinition> = {
  "whatsapp.send_message": { edgeFunction: "whatsapp-engine", action: "send_message", description: "Send a WhatsApp message", verified: true },
  "whatsapp.mark_replied": { edgeFunction: "whatsapp-engine", action: "mark_replied", description: "Mark a WhatsApp thread as replied", verified: true },
  "research.run": { edgeFunction: "research-engine", action: "run", description: "Run a research task", verified: true },
  "research.status": { edgeFunction: "research-engine", action: "status", description: "Check research task status", verified: true },
  "knowledge.search": { edgeFunction: "vault-engine", action: "search", description: "Search the knowledge vault", verified: true },
  "knowledge.ingest_document": { edgeFunction: "vault-engine", action: "ingest_document", description: "Ingest one document into the knowledge vault", verified: true },
  "knowledge.ingest_all": { edgeFunction: "vault-engine", action: "ingest_all", description: "Bulk-ingest documents into the knowledge vault", verified: true },
  "reporting.daily_briefing": { edgeFunction: "reporting-engine", description: "GET daily briefing (path-routed, not action-dispatch)", verified: true },
  "reporting.weekly_briefing": { edgeFunction: "reporting-engine", description: "GET weekly briefing (path-routed, not action-dispatch)", verified: true },
  // document-engine confirmed to use action-dispatch (switch statement,
  // document-engine/index.ts line ~275) but the specific action names
  // were not individually read this sprint — registered as a category
  // placeholder, not callable until its actions are verified.
  "documents.process": { edgeFunction: "document-engine", description: "Document processing — action-dispatch confirmed, specific actions NOT enumerated this sprint", verified: false },
  // approval-engine's real interface is a POST with
  // {action_type, entity_type, request_data} — confirmed in source — but
  // that's a different shape than the action-dispatch pattern above, and
  // the full response contract wasn't traced end-to-end this sprint.
  "approvals.check": { edgeFunction: "approval-engine", description: "Check whether an action needs approval — body shape confirmed (action_type/entity_type/request_data), response contract not fully traced", verified: false },
  "accounting.record": { edgeFunction: "accounting-engine", description: "Accounting operations — dispatch style not confirmed this sprint", verified: false },
};

export interface ExecutionResult {
  capability: string;
  status: "success" | "error" | "unverified_capability" | "unknown_capability";
  data?: unknown;
  error?: string;
  attempts: number;
}

// ── The one interface callers use instead of knowing which of 85 edge
//    functions to hit. Retries on failure, logs every attempt to
//    execution_log (the SAME table 11+ other engines already write to —
//    not a new execution-tracking table). ──
export async function executeCapability(
  capability: string,
  payload: Record<string, unknown>,
  correlationId?: string,
  maxRetries = 2,
): Promise<ExecutionResult> {
  const def = CAPABILITY_REGISTRY[capability];
  if (!def) {
    await logExecution(capability, "unknown", "error", payload, null, correlationId, `unregistered capability: ${capability}`);
    return { capability, status: "unknown_capability", error: `no such capability registered: ${capability}`, attempts: 0 };
  }
  if (!def.verified) {
    await logExecution(capability, def.edgeFunction, "error", payload, null, correlationId, "capability registered but not verified this sprint — dispatch withheld");
    return { capability, status: "unverified_capability", error: `capability '${capability}' is registered but its interface was not verified this sprint — refusing to guess at a payload shape`, attempts: 0 };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let lastError = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/${def.edgeFunction}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
        body: JSON.stringify(def.action ? { action: def.action, ...payload } : payload),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        await logExecution(capability, def.edgeFunction, "success", payload, data, correlationId);
        return { capability, status: "success", data, attempts: attempt };
      }
      lastError = `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 400)}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  await logExecution(capability, def.edgeFunction, "error", payload, null, correlationId, lastError);
  return { capability, status: "error", error: lastError, attempts: maxRetries };
}

async function logExecution(
  capability: string,
  edgeFunction: string,
  status: "success" | "error",
  input: Record<string, unknown>,
  output: unknown,
  correlationId: string | undefined,
  error?: string,
): Promise<void> {
  try {
    const client = getClient();
    await client.from("execution_log").insert({
      function_name: "company-os",
      department_code: null,
      action: capability,
      status,
      input_summary: `[${edgeFunction}] ${JSON.stringify(input).slice(0, 400)}`,
      output_summary: output ? JSON.stringify(output).slice(0, 400) : null,
      error: error ? error.slice(0, 500) : null,
    });
  } catch { /* logging failure never blocks the caller's result */ }
}

// ── Operational state — real aggregation from execution_log, for the
//    Founder Workspace. "Running/queued" isn't distinguishable from
//    execution_log alone (it only records finished attempts), so this
//    reports what execution_log actually can show honestly: recent
//    success/error counts, average latency is NOT computed here because
//    company-os doesn't record latency_ms yet (a real, stated gap — see
//    module header verification notes), and success rate. ──
export interface OperationalState {
  last24hSuccess: number;
  last24hError: number;
  successRate: number | null;
  recentFailures: Array<{ action: string; error: string | null; created_at: string }>;
}

export async function getOperationalState(): Promise<OperationalState> {
  const client = getClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from("execution_log")
    .select("action, status, error, created_at")
    .eq("function_name", "company-os")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = data ?? [];
  const success = rows.filter((r: { status: string }) => r.status === "success").length;
  const error = rows.filter((r: { status: string }) => r.status === "error").length;
  const total = success + error;

  return {
    last24hSuccess: success,
    last24hError: error,
    successRate: total > 0 ? Math.round((success / total) * 100) : null,
    recentFailures: rows.filter((r: { status: string }) => r.status === "error").slice(0, 5),
  };
}
