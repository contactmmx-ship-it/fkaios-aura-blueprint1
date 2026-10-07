// ============================================================================
// brands-public v1 — the ONLY brand data a stranger on the internet may see.
//
// SECURITY REASONING (deliberate, not incidental):
// The `brands` table is RLS-protected to `authenticated` and carries COMMERCIAL
// TERMS — royalty percentages, internal status. A public franchise-enquiry page
// needs brand names and investment ranges, and nothing else.
//
// The lazy fix would be an anon SELECT policy on `brands`. That would be WRONG:
// Postgres RLS is ROW-level, not COLUMN-level, so opening the table to anon
// opens the royalty column to anon — publishing your deal economics to every
// competitor with a browser. Instead this function runs service-role server-side
// and hand-picks the marketing-safe fields. Royalty NEVER crosses this boundary.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "Server not configured" }), { status: 503, headers: CORS });
  }
  const db = createClient(url, key);

  // Hand-picked columns. `royalty` and internal status are NOT selected — they
  // are commercial terms and must never reach an anonymous client.
  const { data, error } = await db
    .from("brands")
    .select("name, vertical, sector, type, investment_range")
    .eq("is_active", true)
    .order("name");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS });
  }
  return new Response(JSON.stringify({ brands: data ?? [] }), { status: 200, headers: CORS });
});
