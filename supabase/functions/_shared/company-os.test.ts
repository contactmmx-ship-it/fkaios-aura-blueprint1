/// <reference lib="deno.ns" />
// Run: deno test -A supabase/functions/_shared/company-os.test.ts
//
// The fake target below enforces vault-engine's real rule (vault-engine/index.ts):
// `if (secret && provided !== secret) return err('Unauthorized', 401)` where
// provided = req.headers.get('x-vault-secret'). The Authorization bearer is
// ignored by that check, which is why dispatches without the header got 401.
import { buildDispatchHeaders, CAPABILITY_REGISTRY, executeCapability } from "./company-os.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const SECRET = "test-heartbeat-secret";
const realFetch = globalThis.fetch;

// Stands in for vault-engine: 401 unless x-vault-secret matches, otherwise a
// search response in vault-engine's shape (query + match_knowledge_chunks rows).
function installVault(requests: Array<{ url: string; headers: Headers }>) {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    requests.push({ url, headers });
    if (!url.includes("/functions/v1/vault-engine")) return Promise.resolve(new Response("{}", { status: 404 }));
    if (headers.get("x-vault-secret") !== SECRET) {
      return Promise.resolve(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    return Promise.resolve(new Response(JSON.stringify({
      query: body.query,
      matches: [{ id: "chunk-1", document_id: "doc-1", chunk_text: "FKAIOS System Charter ...", similarity: 0.71 }],
    }), { status: 200 }));
  }) as typeof fetch;
}

function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void>) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(values)) {
      saved[k] = Deno.env.get(k);
      if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v);
    }
    try { await fn(); } finally {
      globalThis.fetch = realFetch;
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v); }
    }
  };
}

Deno.test("knowledge.* capabilities declare vault-engine's secret header; others do not", () => {
  for (const name of ["knowledge.search", "knowledge.ingest_document", "knowledge.ingest_all"]) {
    assert(CAPABILITY_REGISTRY[name].secretHeader === "x-vault-secret", `${name} must send x-vault-secret`);
  }
  assert(CAPABILITY_REGISTRY["research.status"].secretHeader === undefined, "research-engine is not changed");
  const h = buildDispatchHeaders(CAPABILITY_REGISTRY["knowledge.search"], "svc", SECRET);
  assert(h.Authorization === "Bearer svc" && h["x-vault-secret"] === SECRET, "bearer and secret both sent");
  const none = buildDispatchHeaders(CAPABILITY_REGISTRY["knowledge.search"], "svc", "");
  assert(!("x-vault-secret" in none), "no secret configured means no header, never a placeholder");
});

Deno.test("authenticated research request succeeds with sourced matches", withEnv(
  { SUPABASE_URL: "http://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "svc", HEARTBEAT_SECRET: SECRET },
  async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    installVault(requests);
    const result = await executeCapability("knowledge.search", { query: "Indian paint distributors" }, undefined, 1);
    assert(result.status === "success", `expected success, got ${result.status}: ${result.error}`);
    const data = result.data as { matches: Array<{ document_id: string }> };
    assert(data.matches[0].document_id === "doc-1", "matches carry their source document id");
    const vaultCall = requests.find((r) => r.url.includes("vault-engine"))!;
    assert(vaultCall.headers.get("x-vault-secret") === SECRET, "secret header was sent");
  },
));

Deno.test("unauthenticated research request is still rejected with 401", withEnv(
  { SUPABASE_URL: "http://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "svc", HEARTBEAT_SECRET: undefined },
  async () => {
    installVault([]);
    const result = await executeCapability("knowledge.search", { query: "Indian paint distributors" }, undefined, 1);
    assert(result.status === "error", "must fail without the secret");
    assert(result.error!.startsWith("HTTP 401"), `expected HTTP 401, got ${result.error}`);
  },
));

Deno.test("a wrong secret is rejected too", withEnv(
  { SUPABASE_URL: "http://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "svc", HEARTBEAT_SECRET: "wrong" },
  async () => {
    installVault([]);
    const result = await executeCapability("knowledge.search", { query: "x" }, undefined, 1);
    assert(result.status === "error" && result.error!.startsWith("HTTP 401"), "wrong secret must be rejected");
  },
));


Deno.test("system.brand_pipeline_audit calls the actual brand audit RPC", withEnv(
  { SUPABASE_URL: "http://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "svc" },
  async () => {
    const requests: string[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      requests.push(url);
      if (url.includes("/rest/v1/rpc/fkaios_brand_pipeline_audit")) {
        return Promise.resolve(new Response(JSON.stringify({
          brand_pipeline_complete: false,
          counts: {
            registered_brands: 10,
            total_leads: 150,
            expected_brand_names_matched: 7,
            missing_brand_registry_entries: 3,
          },
          brand_registry: [
            "Arofur", "Chaat Masters", "Chawla Lab", "Franchise Kart", "Gio Paints",
            "GoMax", "Kids DPS", "Knead & Bake", "Mr. Chick'n", "Turning Point",
          ].map((name, index) => ({ id: `brand-${index + 1}`, name })),
          expected_brand_mapping: [
            { canonical_name: "Franchise Kart", matched_current_name: null, brand_id: null, registry_match: false },
            { canonical_name: "Chawla Lab", matched_current_name: null, brand_id: null, registry_match: false },
            { canonical_name: "Turning Point", matched_current_name: null, brand_id: null, registry_match: false },
          ],
          missing_brand_names: ["Franchise Kart", "Chawla Lab", "Turning Point"],
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (url.includes("/rest/v1/execution_log")) {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ message: "unexpected request" }), { status: 404 }));
    }) as typeof fetch;

    const result = await executeCapability("system.brand_pipeline_audit", {}, undefined, 1);
    assert(result.status === "success", `expected brand audit success, got ${result.status}: ${result.error}`);
    assert(requests.some((url) => url.includes("/rest/v1/rpc/fkaios_brand_pipeline_audit")), "must call the actual migration RPC");
    assert(!requests.some((url) => url.includes("/rest/v1/rpc/fkaios_crm_pipeline_audit")), "must not call the unrelated legacy RPC");
    const data = result.data as {
      counts: { total_leads: number; expected_brand_names_matched: number; missing_brand_registry_entries: number };
      expected_brand_mapping: { registry_match: boolean }[];
      missing_brand_names: string[];
      brand_pipeline_complete: boolean;
    };
    assert(data.counts.total_leads === 150, "returns the live audit result");
    assert(data.counts.expected_brand_names_matched === 10, "matches all ten canonical names from the live registry");
    assert(data.counts.missing_brand_registry_entries === 0, "does not report legacy-name false positives");
    assert(data.expected_brand_mapping.every((item) => item.registry_match), "every canonical brand maps to a real registry row");
    assert(data.missing_brand_names.length === 0, "no canonical registry names remain missing");
    assert(data.brand_pipeline_complete === false, "does not mask genuine CRM pipeline gaps");
  },
));
