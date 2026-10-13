// FKAIOS ai-engine — production-fix pass regression tests.
//
// ai-engine/index.ts instantiates a real Supabase client and calls
// Deno.serve() at module scope (it is an Edge Function entrypoint, not a
// library) — so this file must set fake-but-valid env vars and use a
// dynamic import BEFORE any Deno.test() registration, and each test opts
// out of resource/op sanitization (the module's own Deno.serve listener is
// a real, harmless side effect of import, not a leak this test caused).
// Every function tested below is a pure function with no network or
// database access of its own — the DB-coupled functions (runJobs,
// handleGenerateProposal, handleScheduleMeeting, provider-health read/write)
// are verified instead via live, non-destructive integration checks against
// the deployed project (see the production-fix pass report) rather than
// faked out here, since this module has no dependency-injection seam for a
// mock Supabase client.

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("ANTHROPIC_API_KEY", "test-anthropic-key");

const {
  extractJSONFromText,
  asJSONObject,
  parseAndValidateInvoicePayload,
  normalizeInvoiceLineItems,
  computeInvoiceTotals,
  resultReportsFailure,
  resultLacksLiveInfrastructureEvidence,
  hasServiceRoleAuthorization,
  NonRetryableJobError,
  getHealthTtlMinutes,
} = await import("./index.ts");

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function t(name: string, fn: () => void | Promise<void>) {
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });
}

t("internal queue drain: rejects public anon-key requests", () => {
  const req = new Request("https://example.test/ai-engine/run_jobs", {
    method: "POST",
    headers: { Authorization: "Bearer test-anon-key", apikey: "test-anon-key" },
  });
  assert(!hasServiceRoleAuthorization(req, "test-service-role-key"), "Public anon JWT must not authorize queue execution");
});

t("internal queue drain: requires both service-role authorization and apikey", () => {
  const good = new Request("https://example.test/ai-engine/run_jobs", {
    method: "POST",
    headers: { Authorization: "Bearer test-service-role-key", apikey: "test-service-role-key" },
  });
  const missingApiKey = new Request("https://example.test/ai-engine/run_jobs", {
    method: "POST",
    headers: { Authorization: "Bearer test-service-role-key", apikey: "test-anon-key" },
  });
  assert(hasServiceRoleAuthorization(good, "test-service-role-key"), "Internal service-role caller should be accepted");
  assert(!hasServiceRoleAuthorization(missingApiKey, "test-service-role-key"), "Both internal auth headers must match");
});

t("infrastructure evidence gate: rejects narrative-only infrastructure reports", () => {
  const result = { status: "completed", findings: { assumptions: ["All 175 tables and 26 crons are healthy"], verified_facts: ["All functions work"] }, sources: [{ url: "https://example.com/security-checklist" }] };
  const gap = resultLacksLiveInfrastructureEvidence({ title: "System Connectivity & Infrastructure Verification", description: "Perform an exhaustive audit and connectivity test across production infrastructure." }, result);
  assert(typeof gap === "string" && gap.includes("system.health_check"), "Narrative claims must not satisfy infrastructure verification");
});

t("infrastructure evidence gate: accepts observed HTTP evidence", () => {
  const result = { status: "success", capability: "system.health_check", capability_result: { healthy: true, checks: [{ target: "console", http_status: 200, reachable: true }, { target: "supabase_rest", http_status: 200, reachable: true }] } };
  const gap = resultLacksLiveInfrastructureEvidence({ title: "System Connectivity & Infrastructure Verification", description: "Check connectivity." }, result);
  assert(gap === null, "Observed HTTP evidence should satisfy the live-reachability gate");
});

t("infrastructure evidence gate: leaves unrelated tasks alone", () => {
  const gap = resultLacksLiveInfrastructureEvidence({ title: "Brand strategy research", description: "Summarize positioning options." }, { findings: [] });
  assert(gap === null, "Unrelated research tasks must not be blocked");
});

// ---------------------------------------------------------------------------
// extractJSONFromText — GENERATE_INVOICE JSON failure fix (item 2).
// Regression coverage for the documented live failure: "Unexpected
// non-whitespace character after JSON at position 25 (line 6 column 1)" —
// the model returns valid JSON followed by trailing prose.
// ---------------------------------------------------------------------------

t("extractJSONFromText: parses clean JSON with no surrounding text", () => {
  const result = extractJSONFromText('{"line_items":[{"description":"Setup","quantity":1,"unit_price_inr":5000}]}');
  assert((result as any).line_items.length === 1, "Should parse the clean object as-is");
});

t("extractJSONFromText: extracts JSON followed by trailing prose (the documented live failure shape)", () => {
  const raw = '{"line_items":[{"description":"Setup fee","quantity":1,"unit_price_inr":5000}]}\n\nLet me know if you need anything else!';
  const result = extractJSONFromText(raw) as any;
  assert(result.line_items[0].description === "Setup fee", "Should extract the JSON object despite trailing prose");
});

t("extractJSONFromText: extracts JSON preceded by leading prose/markdown fence remnants", () => {
  const raw = 'Here is the invoice:\n{"line_items":[{"description":"Consulting","quantity":2,"unit_price_inr":1000}]}';
  const result = extractJSONFromText(raw) as any;
  assert(result.line_items[0].quantity === 2, "Should extract the JSON object despite leading prose");
});

t("extractJSONFromText: a quoted brace inside a string value never confuses the balance scan", () => {
  const raw = '{"description":"Note: use format {x}","line_items":[]}';
  const result = extractJSONFromText(raw) as any;
  assert(result.description === "Note: use format {x}", "Braces inside string values must not affect balance counting");
});

t("extractJSONFromText: throws a clear error when no JSON object/array exists at all", () => {
  let threw = false;
  try {
    extractJSONFromText("I cannot generate this invoice because no billable data exists.");
  } catch (err) {
    threw = true;
    assert(err instanceof Error && err.message.includes("no balanced JSON"), "Error message should clearly say no JSON was found");
  }
  assert(threw, "Should throw when there is no JSON to extract");
});

t("extractJSONFromText: throws a clear error on mismatched delimiters rather than silently returning garbage", () => {
  let threw = false;
  try {
    extractJSONFromText('{"a": [1, 2}');
  } catch (err) {
    threw = true;
    assert(err instanceof Error, "Should throw an Error instance");
  }
  assert(threw, "Mismatched delimiters must be a reported failure, not a best-effort guess");
});

// ---------------------------------------------------------------------------
// asJSONObject
// ---------------------------------------------------------------------------

t("asJSONObject: accepts a plain object", () => {
  const obj = asJSONObject({ a: 1 }, "test");
  assert(obj.a === 1, "Should pass the object through unchanged");
});

t("asJSONObject: rejects an array with a clear message", () => {
  let threw = false;
  try {
    asJSONObject([1, 2, 3], "test context");
  } catch (err) {
    threw = true;
    assert(err instanceof Error && err.message.includes("array"), "Error should name the actual shape received");
  }
  assert(threw, "Arrays must be rejected — every job type expects an object result");
});

t("asJSONObject: rejects a primitive", () => {
  let threw = false;
  try {
    asJSONObject("just a string", "test context");
  } catch {
    threw = true;
  }
  assert(threw, "Primitives must be rejected");
});

// ---------------------------------------------------------------------------
// parseAndValidateInvoicePayload — structured output preference + schema
// validation. "Extracted JSON alone is not completion."
// ---------------------------------------------------------------------------

t("parseAndValidateInvoicePayload: prefers a structured tool call over text when both are present", () => {
  const toolCall = { line_items: [{ description: "From tool", quantity: 1, unit_price_inr: 100 }] };
  const text = '{"line_items":[{"description":"From text — should be ignored","quantity":1,"unit_price_inr":999}]}';
  const result = parseAndValidateInvoicePayload(toolCall, text);
  assert((result.line_items as any[])[0].description === "From tool", "Tool call must win over free text when both are present");
});

t("parseAndValidateInvoicePayload: falls back to text extraction when no tool call is present", () => {
  const text = '{"line_items":[{"description":"From text","quantity":1,"unit_price_inr":250}]}\nThanks!';
  const result = parseAndValidateInvoicePayload(undefined, text);
  assert((result.line_items as any[])[0].description === "From text", "Should extract from text when toolCall is absent");
});

t("parseAndValidateInvoicePayload: schema validation rejects a parsed object with no valid line items", () => {
  let threw = false;
  try {
    parseAndValidateInvoicePayload(undefined, '{"line_items":[]}');
  } catch (err) {
    threw = true;
    assert(err instanceof Error && err.message.includes("no valid line items"), "Should name the actual validation failure");
  }
  assert(threw, "An empty line_items array must fail validation, not be treated as a usable (if empty) invoice");
});

t("parseAndValidateInvoicePayload: rejects a non-object payload even if it parses as valid JSON", () => {
  let threw = false;
  try {
    parseAndValidateInvoicePayload(undefined, "[1,2,3]");
  } catch {
    threw = true;
  }
  assert(threw, "A JSON array is not a valid invoice payload shape");
});

// ---------------------------------------------------------------------------
// normalizeInvoiceLineItems — the three shapes actually observed in
// production, and rejection of garbage.
// ---------------------------------------------------------------------------

t("normalizeInvoiceLineItems: handles the direct line_items shape", () => {
  const items = normalizeInvoiceLineItems({ line_items: [{ description: "A", quantity: 2, unit_price_inr: 500 }] });
  assert(items.length === 1 && items[0].quantity === 2, "Should normalize the direct shape");
});

t("normalizeInvoiceLineItems: handles the GST-style invoice.items shape", () => {
  const items = normalizeInvoiceLineItems({ invoice: { items: [{ description: "GST item", amount: 750 }] } });
  assert(items.length === 1 && items[0].unit_price_inr === 750 && items[0].quantity === 1, "Should map amount->unit_price_inr with quantity 1");
});

t("normalizeInvoiceLineItems: handles the top-level items shape", () => {
  const items = normalizeInvoiceLineItems({ items: [{ description: "Top-level item", amount: 300 }] });
  assert(items.length === 1 && items[0].description === "Top-level item", "Should normalize the top-level items shape");
});

t("normalizeInvoiceLineItems: never invents a line item from garbage input", () => {
  const items = normalizeInvoiceLineItems({ line_items: [{ description: "", quantity: -1, unit_price_inr: "not a number" }] });
  assert(items.length === 0, "Invalid/incomplete line items must be dropped, never coerced into something usable");
});

// ---------------------------------------------------------------------------
// computeInvoiceTotals
// ---------------------------------------------------------------------------

t("computeInvoiceTotals: applies the 18% GST formula", () => {
  const totals = computeInvoiceTotals([{ description: "X", quantity: 2, unit_price_inr: 1000 }]);
  assert(totals.subtotal === 2000, `Expected subtotal 2000, got ${totals.subtotal}`);
  assert(totals.tax === 360, `Expected tax 360, got ${totals.tax}`);
  assert(totals.total === 2360, `Expected total 2360, got ${totals.total}`);
});

// ---------------------------------------------------------------------------
// resultReportsFailure — a result shaped like a failure is a failure, not
// completed work.
// ---------------------------------------------------------------------------

t("resultReportsFailure: detects an {error} shaped result", () => {
  assert(resultReportsFailure({ error: "could not comply" }) === "could not comply", "Should extract the error message");
});

t("resultReportsFailure: detects a {status:'error', message} shaped result", () => {
  assert(resultReportsFailure({ status: "error", message: "no data" }) === "no data", "Should extract the message");
});

t("resultReportsFailure: returns null for a normal-looking success result", () => {
  assert(resultReportsFailure({ line_items: [{ description: "ok", quantity: 1, unit_price_inr: 1 }] }) === null, "A normal result must not be flagged as a failure");
});

// Verification work must not be marked complete when the worker only lists
// evidence it would need, rather than performing the requested check.
t("resultReportsUnperformedVerification: rejects an audit report admitting missing cron logs", async () => {
  const { resultReportsUnperformedVerification } = await import("./index.ts");
  const reason = resultReportsUnperformedVerification(
    { title: "Verify background cron operation and autonomous execution", description: "Check cron logs and execution evidence" },
    { status: "incomplete", report: "Cron logs are unavailable; this does not prove the cron is healthy." },
  );
  assert(typeof reason === "string" && reason.includes("cannot be marked completed"), "A report admitting missing verification evidence must not count as completed work");
});

t("resultReportsUnperformedVerification: catches the live 'Missing exact evidence' failure shape", async () => {
  const { resultReportsUnperformedVerification } = await import("./index.ts");
  const reason = resultReportsUnperformedVerification(
    { title: "Database Schema and Edge Function Health Verification", description: "Perform an exhaustive automated diagnostic sweep across tables, functions and cron routines" },
    { report: "Prior completed task evidence lacks suitable sources. Missing exact evidence: automated diagnostic sweep results, live connectivity logs, and RLS security checks." },
  );
  assert(typeof reason === "string" && reason.includes("cannot be marked completed"), "Missing exact evidence must be rejected as unperformed verification");
});

t("resultReportsUnperformedVerification: leaves ordinary analytical tasks alone", async () => {
  const { resultReportsUnperformedVerification } = await import("./index.ts");
  const reason = resultReportsUnperformedVerification(
    { title: "Research the Indian preschool market", description: "Compare competitors and business models" },
    { summary: "The source evidence is limited; findings are provisional." },
  );
  assert(reason === null, "Non-verification research must not be rejected by this guard");
});

t("resultReportsUnperformedVerification: allows a verification task with concrete findings", async () => {
  const { resultReportsUnperformedVerification } = await import("./index.ts");
  const reason = resultReportsUnperformedVerification(
    { title: "Verify production deployment and console health", description: "Run endpoint checks and inspect runtime" },
    { status: "verified", http_status: 200, deployment_url: "https://example.test", checks: ["HTTP 200", "console rendered"] },
  );
  assert(reason === null, "A report with concrete findings should pass this narrow guard");
});

Deno.test("performSystemHealthCheck: reports both successful targets", async () => {
  const { performSystemHealthCheck } = await import("./index.ts");
  const result = await performSystemHealthCheck({ consoleUrl: "https://console.example.test", supabaseUrl: "https://project.example.test", serviceRoleKey: "test-secret" }, (async () => new Response("ignored", { status: 200 })) as typeof fetch);
  assert(result.healthy && result.checks.length === 2, "Both successful HTTP checks should yield healthy=true");
  assert(result.checks.every((check) => check.http_status === 200), "Each target must include its observed HTTP status");
  assert(!JSON.stringify(result).includes("test-secret"), "Health evidence must never include credentials");
});
Deno.test("performSystemHealthCheck: reports an unhealthy target instead of claiming success", async () => {
  const { performSystemHealthCheck } = await import("./index.ts");
  const result = await performSystemHealthCheck({ consoleUrl: "https://console.example.test", supabaseUrl: "https://project.example.test", serviceRoleKey: "test-secret" }, (async (input: RequestInfo | URL) => new Response("ignored", { status: String(input).includes("console.example.test") ? 503 : 200 })) as typeof fetch);
  assert(!result.healthy, "Any non-2xx target must make the overall check unhealthy");
  assert(result.checks.some((check) => check.target === "console" && check.http_status === 503), "The failed target and actual status must be preserved");
});
// ---------------------------------------------------------------------------
// NonRetryableJobError — retry behavior classification (item 3).
// ---------------------------------------------------------------------------

t("NonRetryableJobError: carries its disposition and is a real Error", () => {
  const err = new NonRetryableJobError("no lead_id", "INVALID_PAYLOAD");
  assert(err instanceof Error, "Must be a real Error instance (so generic catch blocks still work)");
  assert(err.disposition === "INVALID_PAYLOAD", "Disposition must be preserved for the caller to record as the kernel_disposition");
  assert(err.message === "no lead_id", "Message must be preserved");
});

// ---------------------------------------------------------------------------
// getHealthTtlMinutes — provider availability (item 6): durable failures get
// long suppression windows, transient ones short, content-quality issues
// (invalid_request/invalid_response) get none — and every window is
// env-overridable, never hardcoded per provider name.
// ---------------------------------------------------------------------------

t("getHealthTtlMinutes: durable categories default to a long TTL", () => {
  assert(getHealthTtlMinutes("credit_exhaustion") >= 60, "credit_exhaustion should suppress for a long window by default");
  assert(getHealthTtlMinutes("authentication_failure") >= 60, "authentication_failure should suppress for a long window by default");
});

t("getHealthTtlMinutes: transient categories default to a short TTL", () => {
  assert(getHealthTtlMinutes("rate_limit") > 0 && getHealthTtlMinutes("rate_limit") < 60, "rate_limit should be a short cooldown");
  assert(getHealthTtlMinutes("timeout") > 0 && getHealthTtlMinutes("timeout") < 60, "timeout should be a short cooldown");
});

t("getHealthTtlMinutes: content-quality categories never suppress the provider itself", () => {
  assert(getHealthTtlMinutes("invalid_request") === 0, "invalid_request is about the request, not provider availability");
  assert(getHealthTtlMinutes("invalid_response") === 0, "invalid_response is about content quality, not provider availability");
});

t("getHealthTtlMinutes: is env-overridable per category, not hardcoded", () => {
  const original = Deno.env.get("PROVIDER_HEALTH_TTL_CREDIT_EXHAUSTION_MIN");
  try {
    Deno.env.set("PROVIDER_HEALTH_TTL_CREDIT_EXHAUSTION_MIN", "42");
    assert(getHealthTtlMinutes("credit_exhaustion") === 42, "Should honor the env override exactly");
  } finally {
    if (original === undefined) Deno.env.delete("PROVIDER_HEALTH_TTL_CREDIT_EXHAUSTION_MIN");
    else Deno.env.set("PROVIDER_HEALTH_TTL_CREDIT_EXHAUSTION_MIN", original);
  }
});
