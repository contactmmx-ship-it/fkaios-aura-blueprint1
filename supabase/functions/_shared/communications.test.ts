/// <reference lib="deno.ns" />
import { executeApprovedCommunications, normalisePhone, planFromRows, type CommunicationRequest, type CommunicationResourceRow } from "./communications.ts";

function assert(condition: boolean, message = "assertion failed"): void {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}\n     got ${a}`);
}

const wa: CommunicationResourceRow = { capability: "send_whatsapp_message", resource_ref: "tool:meta:whatsapp-cloud-api", provider: "meta", tier: "low_cost_external", credential_ref: "WHATSAPP_ACCESS_TOKEN", lifecycle_state: "discovered", health_status: "unknown", unavailable_until: null, requires_approval: true, metadata: { phone_number_ref: "WHATSAPP_PHONE_NUMBER_ID" } };
const req = (over: Partial<CommunicationRequest> = {}): CommunicationRequest => ({ capability: "send_whatsapp_message", recipient: "+91 98765 43210", content: "The meeting is tomorrow at 11.", purpose: "meeting reminder", requestedBy: "test", ...over });
const env = (vars: Record<string, string>) => (k: string) => vars[k];
const configured = env({ WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "p" });
const now = new Date("2026-10-08T12:00:00Z");

Deno.test("communication plan: authorised resource inside the session window needs only approval", () => {
  const plan = planFromRows(req(), [wa], configured, new Date("2026-10-08T09:00:00Z"), now);
  assertEquals(plan.blockers, []);
  assertEquals(plan.resource, "tool:meta:whatsapp-cloud-api");
  assertEquals(plan.recipient, "919876543210");
  assert(plan.requiresApproval);
  assertEquals(plan.sessionOpen, true);
});

Deno.test("communication plan: platform rules and missing authorisation are blockers, never bypassed", () => {
  const outside = planFromRows(req(), [wa], configured, new Date("2026-10-06T09:00:00Z"), now);
  assert(outside.blockers.some((b) => /24 h WhatsApp session/.test(b)), JSON.stringify(outside.blockers));
  assertEquals(planFromRows(req({ template: { name: "meeting_reminder", language: "en" } }), [wa], configured, null, now).blockers, []);
  const unconfigured = planFromRows(req(), [wa], env({ WHATSAPP_ACCESS_TOKEN: "t" }), new Date("2026-10-08T09:00:00Z"), now);
  assert(unconfigured.blockers.some((b) => /WHATSAPP_PHONE_NUMBER_ID unset/.test(b)), JSON.stringify(unconfigured.blockers));
  assert(planFromRows(req({ capability: "send_email", recipient: "john@example.com" }), [wa], configured, null, now).blockers.some((b) => /no resource is registered for send_email/.test(b)));
  assert(planFromRows(req({ recipient: "12" }), [wa], configured, null, now).blockers.some((b) => /valid international phone/.test(b)));
});

Deno.test("phone numbers are normalised to digits", () => {
  assertEquals(normalisePhone("+91 98765-43210"), "919876543210");
  assertEquals(normalisePhone("abc"), null);
});

Deno.test("only an approved, unclaimed request is sent, once, with the provider id as evidence", async () => {
  const writes: Array<{ table: string; op: string; row: Record<string, unknown> }> = [];
  let claimed = false;
  const approval = { id: "ap1", payload: { request: req({ recipient: "919876543210" }) }, decided_by: "founder", decided_at: "2026-10-08T11:00:00Z" };
  const db = { from: (table: string) => {
    let op = "select"; let row: Record<string, unknown> = {};
    const api: Record<string, unknown> = {
      select: () => api, eq: () => api, is: () => api, in: () => api, order: () => api, limit: () => api,
      insert: (r: Record<string, unknown>) => { op = "insert"; row = r; writes.push({ table, op, row: r }); return api; },
      update: (r: Record<string, unknown>) => { op = "update"; row = r; writes.push({ table, op, row: r }); return api; },
      single: () => Promise.resolve({ data: { id: "ev1" } }),
      maybeSingle: () => {
        if (table === "approvals" && op === "update") { const first = !claimed; claimed = true; return Promise.resolve({ data: first ? { id: "ap1" } : null }); }
        if (table === "whatsapp_inbound_messages") return Promise.resolve({ data: { created_at: new Date(Date.now() - 3600_000).toISOString() } });
        return Promise.resolve({ data: null });
      },
      then: (resolve: (v: unknown) => void) => {
        if (table === "approvals" && op === "select") return resolve({ data: [approval] });
        if (table === "fkaios_resource_capabilities") return resolve({ data: [wa] });
        return resolve({ data: null, error: null });
      },
    };
    void row;
    return api;
  } };
  const realFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = (() => { sends++; return Promise.resolve(new Response(JSON.stringify({ messages: [{ id: "wamid.ABC" }] }), { status: 200 })); }) as typeof fetch;
  try {
    const out = await executeApprovedCommunications(db, configured);
    assertEquals(out, [{ approval: "ap1", sent: true, provider_message_id: "wamid.ABC", error: null }]);
    assertEquals(sends, 1);
    const ev = writes.find((w) => w.table === "fkaios_verification_evidence");
    assertEquals(ev?.row.requirement_key, "communication:send_whatsapp_message");
    assertEquals((ev?.row.observed_result as Record<string, unknown>).provider_message_id, "wamid.ABC");
    // a second tick finds it claimed and sends nothing
    const again = await executeApprovedCommunications(db, configured);
    assertEquals(again, []);
    assertEquals(sends, 1);
  } finally { globalThis.fetch = realFetch; }
});
