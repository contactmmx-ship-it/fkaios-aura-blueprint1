import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return new Response("Server not configured.", { status: 503, headers: CORS });

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const buildId = new URL(req.url).searchParams.get("build_id");

  if (buildId) {
    const { data, error } = await db
      .from("build_projects")
      .select("id,status,build_type,output_html,output_json,error_message")
      .eq("id", buildId)
      .maybeSingle();

    if (error || !data) return new Response("Product not found.", { status: 404, headers: CORS });
    if (data.status !== "complete") return new Response("Product is not ready.", { status: 409, headers: CORS });

    if (data.output_html) {
      return new Response(data.output_html, {
        status: 200,
        headers: { ...CORS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const payload = JSON.stringify(data.output_json ?? {}, null, 2);
    const escaped = payload.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>FKAIOS Product</title></head><body><h1>Product artifact</h1><p>No runnable HTML was generated.</p><pre>${escaped}</pre></body></html>`, {
      status: 200,
      headers: { ...CORS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const { data, error } = await db
    .from("product_library")
    .select("name,category,what_it_does,sellable_as,target_buyer")
    .eq("status", "shipped")
    .order("category");

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ products: data ?? [] }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
