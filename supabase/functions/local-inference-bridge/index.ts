/// <reference lib="deno.ns" />
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const MAX_REQUEST_BYTES = 1_100_000;
const MAX_RESULT_BYTES = 1_000_000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey",
  "Content-Type": "application/json; charset=utf-8",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function constantTimeEqual(a: string, b: string): boolean {
  // Compare all bytes after accounting for length; do not early-return on a
  // matching prefix. This is a shared-secret check, not a general crypto API.
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = aa.length ^ bb.length;
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function validWorkerId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,119}$/.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const expectedToken = Deno.env.get("FKAIOS_LOCAL_WORKER_TOKEN") ?? "";
  if (expectedToken.length < 32) {
    // Fail closed: no default credential, no permissive development mode.
    return json(503, { error: "local_worker_not_configured" });
  }
  const supplied = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!supplied || !constantTimeEqual(supplied, expectedToken)) {
    return json(401, { error: "unauthorized" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return json(503, { error: "backend_not_configured" });

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_REQUEST_BYTES) return json(413, { error: "request_too_large" });
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return json(400, { error: "invalid_body" });
  }
  if (new TextEncoder().encode(raw).length > MAX_REQUEST_BYTES) return json(413, { error: "request_too_large" });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(400, { error: "invalid_json_object" });
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const workerId = body.worker_id;
  if (!validWorkerId(workerId)) return json(400, { error: "invalid_worker_id" });
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const action = body.action;

  try {
    if (action === "claim") {
      const limit = Number(body.limit ?? 1);
      const leaseSeconds = Number(body.lease_seconds ?? 90);
      if (!Number.isInteger(limit) || limit < 1 || limit > 3) return json(400, { error: "invalid_limit" });
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 300) return json(400, { error: "invalid_lease_seconds" });
      const { data, error } = await db.rpc("fkaios_claim_local_inference_jobs", {
        p_worker_id: workerId, p_limit: limit, p_lease_seconds: leaseSeconds,
      });
      if (error) {
        console.error("local-inference-bridge claim failed", error.message);
        return json(500, { error: "claim_failed" });
      }
      return json(200, { jobs: data ?? [] });
    }

    const jobId = typeof body.job_id === "string" ? body.job_id : "";
    const leaseToken = typeof body.lease_token === "string" ? body.lease_token : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
      return json(400, { error: "invalid_job_id" });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leaseToken)) {
      return json(400, { error: "invalid_lease_token" });
    }

    if (action === "heartbeat") {
      const leaseSeconds = Number(body.lease_seconds ?? 90);
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 300) return json(400, { error: "invalid_lease_seconds" });
      const { data, error } = await db.rpc("fkaios_heartbeat_local_inference_job", {
        p_job_id: jobId, p_worker_id: workerId, p_lease_token: leaseToken, p_lease_seconds: leaseSeconds,
      });
      if (error) {
        console.error("local-inference-bridge heartbeat failed", error.message);
        return json(500, { error: "heartbeat_failed" });
      }
      return json(data?.ok ? 200 : 409, data);
    }

    if (action === "complete" || action === "fail") {
      const resultPayload = action === "complete" ? body.result_payload : null;
      if (action === "complete" && (resultPayload === null || resultPayload === undefined)) {
        return json(400, { error: "result_payload_required" });
      }
      if (resultPayload !== null && resultPayload !== undefined &&
          new TextEncoder().encode(JSON.stringify(resultPayload)).length > MAX_RESULT_BYTES) {
        return json(413, { error: "result_too_large" });
      }
      const { data, error } = await db.rpc("fkaios_complete_local_inference_job", {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_lease_token: leaseToken,
        p_result_payload: resultPayload ?? null,
        p_error_code: action === "fail" ? String(body.error_code ?? "worker_error").slice(0, 120) : null,
        p_error_detail: action === "fail" ? String(body.error_detail ?? "Local worker failed").slice(0, 2000) : null,
      });
      if (error) {
        console.error("local-inference-bridge completion failed", error.message);
        return json(500, { error: "completion_failed" });
      }
      return json(data?.ok ? 200 : 409, data);
    }

    return json(400, { error: "unsupported_action" });
  } catch (error) {
    console.error("local-inference-bridge unexpected failure", error instanceof Error ? error.message : "unknown");
    return json(500, { error: "internal_error" });
  }
});
