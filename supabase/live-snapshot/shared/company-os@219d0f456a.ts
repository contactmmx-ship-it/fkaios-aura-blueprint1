import { createClient } from "npm:@supabase/supabase-js@2.57.4";

function getClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key);
}

export interface CapabilityDefinition {
  edgeFunction: string;
  action?: string;
  description: string;
  verified: boolean;
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
  "documents.process": { edgeFunction: "document-engine", description: "Document processing — action-dispatch confirmed, specific actions NOT enumerated this sprint", verified: false },
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
  } catch { }
}

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
