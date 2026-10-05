import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new Response("Product renderer is not configured.", { status: 503 });

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db
    .from("build_projects")
    .select("id, status, build_type, output_html, output_json, error_message")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return new Response("Product not found.", { status: 404 });
  if (data.status !== "complete") return new Response("Product is not ready.", { status: 409 });

  if (data.output_html) {
    return new Response(data.output_html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-FKAIOS-Product-ID": data.id,
      },
    });
  }

  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>FKAIOS Product</title><style>body{font-family:system-ui;margin:40px;line-height:1.5}pre{white-space:pre-wrap;background:#f5f5f5;padding:20px;border-radius:12px}</style></head><body><h1>Product artifact</h1><p>This objective produced a software artifact, but no runnable HTML product was generated.</p><pre>${escapeHtml(JSON.stringify(data.output_json, null, 2))}</pre></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
