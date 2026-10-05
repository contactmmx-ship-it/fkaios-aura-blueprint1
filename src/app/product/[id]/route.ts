import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return new Response("Product renderer is not configured.", { status: 503 });

  const endpoint = `${url}/functions/v1/products-public?build_id=${encodeURIComponent(id)}`;
  const response = await fetch(endpoint, { cache: "no-store" });
  const body = await response.text();

  return new Response(body || (response.ok ? "Product is empty." : "Product unavailable."), {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-FKAIOS-Product-ID": id,
    },
  });
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
